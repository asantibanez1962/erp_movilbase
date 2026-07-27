import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import {
  Entregador,
  PendingUpload,
  Productor,
  Solicitud,
  TipoDesembolso,
} from "../db/models";
import { database } from "../lib/db";
import { consultarAtv, type ResultadoAtv } from "../lib/atv";
import { crearEntregador, eliminarEntregador } from "../lib/crear";
import { useSesion } from "../lib/sesion";
import { esEditable } from "../lib/politicas";
import {
  colores,
  estadoSolicitud,
  estilos,
  fmtFecha,
  fmtFechaHora,
  fmtMoneda,
} from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";
import { PickerModal } from "./componentes/Picker";
import { useOpcionesProductor } from "./componentes/opciones";
import { etiquetaZona, useNombresZona } from "./useNombresZona";

/**
 * Detalle de una solicitud, en dos pestañas.
 *
 * Las tabs no son decorativas: con los datos y los entregadores en una sola
 * pantalla el scroll se hacía largo justo cuando el promotor está de pie en el
 * campo. Además es el mismo patrón del form web, que ya tiene su tab
 * "Entregadores Solicitud".
 *
 * Los entregadores se buscan por `id_solicitud` = id LOCAL de esta solicitud, que
 * es el mismo valor tanto si bajó del servidor como si nació en el teléfono. Esa
 * uniformidad es lo que compra el esquema de ClientUuid (ver db/schema.ts).
 */
type Pestania = "datos" | "plan" | "entregadores";

export function SolicitudDetailScreen({
  route,
  navigation,
}: Readonly<{ route: any; navigation: any }>) {
  const { solicitudId } = route.params as { solicitudId: string };

  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  const [entregadores, setEntregadores] = useState<Entregador[]>([]);
  const [tipos, setTipos] = useState<TipoDesembolso[]>([]);
  const [adjuntos, setAdjuntos] = useState<PendingUpload[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pickerAbierto, setPickerAbierto] = useState(false);
  const [pestania, setPestania] = useState<Pestania>("datos");
  const [consultandoAtv, setConsultandoAtv] = useState(false);
  const [atv, setAtv] = useState<ResultadoAtv | null>(null);
  const nombres = useNombresProductor();
  const nombresZona = useNombresZona();
  const politicas = useSesion((s) => s.politicas);
  const productores = useOpcionesProductor();

  useEffect(() => {
    // findAndObserve y no find: la fila cambia por debajo cuando entra un sync —
    // el veredicto de Hacienda que escribió el BE, o el estado que resolvió la
    // oficina. Con un find único la pantalla quedaba congelada en el momento en que
    // se abrió y parecía que el dato no había llegado.
    const subSol = database
      .get<Solicitud>("solicitudes")
      .findAndObserve(solicitudId)
      .subscribe({
        next: (s) => {
          setSolicitud(s);
          setCargando(false);
        },
        // La fila puede desaparecer del cache (cambio de cosecha, purga).
        error: () => setCargando(false),
      });

    const subEnt = database
      .get<Entregador>("entregadores")
      .query(Q.where("id_solicitud", solicitudId))
      .observe()
      .subscribe(setEntregadores);

    const subTipos = database
      .get<TipoDesembolso>("tipos_desembolso")
      .query()
      .observe()
      .subscribe(setTipos);

    const subAdj = database
      .get<PendingUpload>("pending_uploads")
      .query(
        Q.where("coleccion", "solicitudes"),
        Q.where("registro_local_id", solicitudId)
      )
      .observe()
      .subscribe(setAdjuntos);

    return () => {
      subSol.unsubscribe();
      subEnt.unsubscribe();
      subTipos.unsubscribe();
      subAdj.unsubscribe();
    };
  }, [solicitudId]);

  /**
   * El picker devuelve el id local del productor, que ES su IdSocio. De ahí salen
   * las dos cosas que guarda el entregador: idsocio (la relación real) y rc_codigo
   * (denormalizado para el legacy).
   *
   * El código se lee del record y no del subtítulo del picker porque rc_codigo y
   * codigo son columnas distintas de ge_Socio y difieren en cientos de socios
   * (ver v1.53/RC/06).
   */
  const agregarEntregador = async (productorLocalId: string) => {
    try {
      const productor = await database
        .get<Productor>("productores")
        .find(productorLocalId);

      const idSocio = Number(productor.id);
      if (Number.isNaN(idSocio)) throw new Error("Productor con id inválido.");

      const codigo = productor.rcCodigo?.trim();
      if (!codigo) {
        Alert.alert(
          "Productor sin código RC",
          `${productor.displayName} no tiene rc_codigo asignado, así que no puede figurar como entregador. Hay que cargarlo en el ERP.`
        );
        return;
      }

      // Sin sync automático: subir la solicitud la vuelve de solo lectura, y el
      // promotor todavía puede estar agregando entregadores. Sincroniza él desde
      // el drawer cuando terminó.
      await crearEntregador(solicitudId, idSocio, codigo);
    } catch (e) {
      Alert.alert("No se pudo agregar", (e as Error)?.message ?? "Error desconocido");
    }
  };

  const quitarEntregador = (entregador: Entregador) => {
    Alert.alert(
      "Quitar entregador",
      `¿Sacar a ${entregador.codigo?.trim() ?? "este entregador"} de la solicitud?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar",
          style: "destructive",
          onPress: () => {
            eliminarEntregador(entregador).catch((e) =>
              Alert.alert(
                "No se pudo quitar",
                (e as Error)?.message ?? "Error desconocido"
              )
            );
          },
        },
      ]
    );
  };

  /**
   * Consulta a Hacienda. El veredicto se guarda en la fila local —que la pantalla
   * observa en vivo— y queda pendiente de sincronizar como cualquier otro cambio.
   *
   * `atv` guarda además la respuesta para poder mostrar el MENSAJE, que es texto que
   * arma el servidor ("inscrito y con actividad de café") y no está en la fila: ahí
   * viven sólo el código y la fecha.
   */
  const consultarHacienda = async () => {
    if (!solicitud || consultandoAtv) return;
    setConsultandoAtv(true);
    try {
      const resultado = await consultarAtv(solicitud);
      setAtv(resultado);
      Alert.alert("Hacienda", resultado.mensaje);

      // NO se sincroniza acá a propósito, aunque en este momento haya señal garantizada
      // (la consulta a Hacienda acaba de funcionar).
      //
      // La razón es la uniformidad: todo lo que el promotor hace en el teléfono queda
      // pendiente y lo envía él. Con el auto-sync, el veredicto era el único cambio que
      // se iba solo, y el contador de pendientes aparecía y desaparecía en un segundo —
      // así que el promotor nunca veía que había algo por enviar y no podía confiar en
      // ese número como estado real de su trabajo.
      //
      // El costo asumido: si consulta y se va sin sincronizar, el veredicto se queda en
      // el teléfono. El contador está justamente para que eso se vea.
    } catch (e) {
      Alert.alert(
        "No se pudo consultar",
        (e as Error)?.message ?? "Error desconocido"
      );
    } finally {
      setConsultandoAtv(false);
    }
  };

  const tipoCredito = solicitud?.tipoCredito;
  const tipoNombre = useMemo(() => {
    if (tipoCredito == null) return null;
    return tipos.find((t) => t.idTipoDesembolso === tipoCredito)?.nombre ?? null;
  }, [tipos, tipoCredito]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (!solicitud) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>
          La solicitud ya no está en el cache local.
        </Text>
      </View>
    );
  }

  const s = solicitud;
  const est = estadoSolicitud(s.estado);
  // Las solicitudes viejas usan la variante de rubros sueltos; sólo se muestran
  // esos campos si de verdad traen algo, para no llenar la pantalla de ceros.
  const tieneRubros =
    (s.efectivo ?? 0) + (s.insumos ?? 0) + (s.almacigo ?? 0) +
      (s.formalizacion ?? 0) + (s.otros ?? 0) > 0;

  return (
    <View style={estilos.root}>
      {/* Tres pestañas y no dos: los campos largos (plan de inversión, motivo,
          estimados) hacían que "Datos" pidiera scroll justo cuando el promotor
          está de pie en el campo. */}
      <View style={{ flexDirection: "row", backgroundColor: colores.superficie }}>
        <Tab
          texto="Datos"
          activa={pestania === "datos"}
          onPress={() => setPestania("datos")}
        />
        <Tab
          texto="Plan"
          activa={pestania === "plan"}
          onPress={() => setPestania("plan")}
        />
        <Tab
          texto={`Entregadores (${entregadores.length})`}
          activa={pestania === "entregadores"}
          onPress={() => setPestania("entregadores")}
        />
      </View>

      {/* Si se puede editar lo decide la POLÍTICA de la colección, no el código:
          hoy `solicitudes` es hasta-sync (editable mientras no subió), pero eso
          es configuración del servidor y puede cambiar sin tocar la app. */}
      {esEditable(politicas, "solicitudes", s) ? (
        <TouchableOpacity
          style={{
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: colores.superficie,
            borderBottomWidth: 1,
            borderBottomColor: colores.borde,
          }}
          onPress={() =>
            navigation.navigate("NuevaSolicitud", { solicitudId: s.id })
          }
        >
          <Text style={{ color: colores.primario, fontWeight: "700", fontSize: 15 }}>
            ✎ Editar solicitud
          </Text>
        </TouchableOpacity>
      ) : null}

      {/* Adjuntos: cédula del productor y respaldos del crédito. Disponibles
          siempre, sincronizada o no — suben contra el id de servidor de la
          solicitud y no la modifican. */}
      <TouchableOpacity
        style={{
          paddingVertical: 12,
          alignItems: "center",
          backgroundColor: colores.superficie,
          borderBottomWidth: 1,
          borderBottomColor: colores.borde,
        }}
        onPress={() =>
          navigation.navigate("Adjuntos", {
            coleccion: "solicitudes",
            registroLocalId: s.id,
            titulo: "Adjuntar documento",
          })
        }
      >
        <Text style={{ color: colores.primario, fontWeight: "700", fontSize: 15 }}>
          {adjuntos.length === 0
            ? "📎 Adjuntar cédula o respaldos"
            : `📎 Adjuntos (${adjuntos.filter((a) => a.yaSubio).length} enviado(s), ${adjuntos.filter((a) => !a.yaSubio).length} en cola)`}
        </Text>
      </TouchableOpacity>

      {pestania === "datos" ? (
        <ScrollView>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <EstadoPush fila={s} />
          </View>

          <Text style={estilos.seccion}>Encabezado</Text>
          <Dato
            etiqueta="Productor"
            valor={
              s.idSocio != null
                ? (nombres.get(s.idSocio) ?? `Socio #${s.idSocio}`)
                : null
            }
          />
          <Dato etiqueta="Código" valor={s.codigo?.trim()} />
          <Dato etiqueta="Fecha" valor={fmtFecha(s.fecha)} />
          <Dato etiqueta="Cosecha" valor={s.cosecha?.trim()} />
          <Dato etiqueta="Zona" valor={etiquetaZona(nombresZona, s.zona)} />
          {/* Lo resuelve la oficina desde la web; acá es sólo lectura. Verde
              aprobada, rojo rechazada, negro pendiente. */}
          <Dato etiqueta="Estado" valor={est.texto} color={est.color} />

          <Text style={estilos.seccion}>Crédito</Text>
          <Dato etiqueta="Tipo" valor={tipoNombre} />
          <Dato etiqueta="Total" valor={fmtMoneda(s.total)} />
          <Dato etiqueta="Aprobado" valor={fmtMoneda(s.aprobado)} />

          {/* ── Hacienda (ATV) ─────────────────────────────────────────────
              Los dos campos no se editan nunca: sólo los mueve la consulta. El
              botón necesita internet, así que es un acto explícito del promotor
              cuando ve que tiene señal — nunca automático, para no interrumpir la
              captura ni gastar la poca batería en reintentos. */}
          <Text style={estilos.seccion}>Hacienda (ATV)</Text>
          <Dato
            etiqueta="Resultado"
            valor={atv?.mensaje ?? s.resultadoAtvTexto}
            color={colorAtv(atv?.resultadoAtv ?? s.resultadoAtv, s.consultadoAtv)}
          />
          <Dato
            etiqueta="Consultado"
            valor={
              atv != null
                ? fmtFechaHora(atv.consultadoAtv)
                : s.consultadoAtv != null
                  ? fmtFechaHora(s.consultadoAtv)
                  : null
            }
          />
          {/* Sólo mientras está pendiente: el BE rechaza la consulta en una
              solicitud ya resuelta (NO_PENDIENTE), así que ofrecer el botón sería
              prometer algo que va a fallar. */}
          {s.estaPendiente ? (
            <TouchableOpacity
              style={[estilos.fila, { alignItems: "center" }]}
              onPress={consultarHacienda}
              disabled={consultandoAtv}
            >
              <Text
                style={{
                  color: consultandoAtv ? colores.textoTenue : colores.primario,
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                {consultandoAtv
                  ? "Consultando Hacienda..."
                  : s.consultadoAtv != null
                    ? "🔄 Volver a consultar Hacienda"
                    : "🔍 Consultar Hacienda (necesita internet)"}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* El veredicto queda guardado en el teléfono y sube con el sync. Se dice
              explícitamente porque, al no cambiar nada visible más que estos dos campos,
              sin el aviso parece que la consulta no hizo nada. */}
          {atv != null ? (
            <Text style={[estilos.vacioTexto, { paddingHorizontal: 16, paddingTop: 8 }]}>
              Guardado en el teléfono. Queda pendiente de sincronizar.
            </Text>
          ) : null}

          {tieneRubros ? (
            <>
              <Text style={estilos.seccion}>Rubros (solicitud histórica)</Text>
              <Dato etiqueta="Efectivo" valor={fmtMoneda(s.efectivo)} />
              <Dato etiqueta="Insumos" valor={fmtMoneda(s.insumos)} />
              <Dato etiqueta="Almácigo" valor={fmtMoneda(s.almacigo)} />
              <Dato etiqueta="Formalización" valor={fmtMoneda(s.formalizacion)} />
              <Dato etiqueta="Otros" valor={fmtMoneda(s.otros)} />
            </>
          ) : null}

          <View style={{ height: 32 }} />
        </ScrollView>
      ) : null}

      {pestania === "plan" ? (
        <ScrollView>
          <Text style={estilos.seccion}>Plan y estimados</Text>
          <Dato etiqueta="Plan de inversión" valor={s.planInversion?.trim()} />
          <Dato etiqueta="Motivo" valor={s.motivo?.trim()} />
          <Dato
            etiqueta="Entrega estimada"
            valor={s.entregaEstimada != null ? String(s.entregaEstimada) : null}
          />
          <Dato
            etiqueta="Prod. estimada"
            valor={s.prodEstimada != null ? String(s.prodEstimada) : null}
          />
          {/* Los dos siguientes los escribe el BE desde la visita de validación de
              crédito — acá son informativos, igual que en el form web. */}
          <Dato
            etiqueta="Prod. estimada promotor"
            valor={
              s.prodEstimadaPromotor != null ? String(s.prodEstimadaPromotor) : null
            }
          />
          <Dato
            etiqueta="Inspección de campo"
            valor={s.inspeccionCampo === 1 ? "Sí" : "No"}
          />
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : null}

      {pestania === "entregadores" ? (
        <ScrollView>
          {entregadores.length === 0 ? (
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>Sin entregadores.</Text>
            </View>
          ) : (
            entregadores.map((e) => (
              <View
                key={e.id}
                style={[
                  estilos.fila,
                  { flexDirection: "row", alignItems: "center" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={estilos.filaTitulo}>
                    {e.idSocio != null
                      ? (nombres.get(e.idSocio) ?? `Socio #${e.idSocio}`)
                      : (e.codigo?.trim() || "(sin productor)")}
                  </Text>
                  {/* El código sigue visible: es lo que se reconoce del ERP y de
                      los papeles del legacy. */}
                  <Text style={estilos.filaSubtitulo}>
                    {e.codigo?.trim() || "sin código"}
                  </Text>
                  <EstadoPush fila={e} />
                </View>

                {/* Quitar sólo si ese entregador no subió todavía. Uno ya
                    sincronizado se saca desde la web: el push del BE no acepta
                    deletes. */}
                {e.syncStatus === "created" ? (
                  <TouchableOpacity
                    onPress={() => quitarEntregador(e)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text style={{ color: colores.error, fontSize: 22 }}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}

          <TouchableOpacity
            style={[estilos.fila, { alignItems: "center" }]}
            onPress={() => setPickerAbierto(true)}
          >
            <Text style={{ color: colores.primario, fontSize: 16, fontWeight: "700" }}>
              + Agregar entregador
            </Text>
          </TouchableOpacity>
          <View style={{ height: 32 }} />
        </ScrollView>
      ) : null}

      <PickerModal
        visible={pickerAbierto}
        titulo="Elegir entregador"
        opciones={productores}
        onSeleccionar={agregarEntregador}
        onCerrar={() => setPickerAbierto(false)}
      />
    </View>
  );
}

function Tab({
  texto,
  activa,
  onPress,
}: Readonly<{ texto: string; activa: boolean; onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 14,
        alignItems: "center",
        borderBottomWidth: 2,
        borderBottomColor: activa ? colores.primario : "transparent",
        minHeight: 48,
      }}
    >
      <Text
        style={{
          color: activa ? colores.primario : colores.textoTenue,
          fontWeight: activa ? "700" : "600",
          fontSize: 15,
        }}
      >
        {texto}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Color del veredicto ATV. No usa la misma escala que el estado de la solicitud a
 * propósito: acá nada es "rechazado" — que un productor no tenga la actividad de café
 * registrada es un dato para la oficina, no un veto del promotor. De ahí que 1 y 2
 * sean advertencia (ámbar) y no rojo.
 *
 *   3 = inscrito con café      → verde, es lo que se espera
 *   1 = no inscrito
 *   2 = inscrito sin café      → ámbar, hay algo que revisar
 *   0 = no se pudo consultar   → tenue, no dice nada del productor
 */
function colorAtv(
  resultado: number | null | undefined,
  consultado: number | null | undefined
): string | undefined {
  if (consultado == null && resultado == null) return undefined;
  if (resultado === 3) return colores.exito;
  if (resultado === 1 || resultado === 2) return colores.advertencia;
  return colores.textoTenue;
}

function Dato({
  etiqueta,
  valor,
  color,
}: Readonly<{ etiqueta: string; valor?: string | null; color?: string }>) {
  return (
    <View style={estilos.detalleFila}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={[estilos.detalleValor, color ? { color } : null]}>
        {valor || "—"}
      </Text>
    </View>
  );
}
