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
import { Entregador, Productor, Solicitud, TipoDesembolso } from "../db/models";
import { database } from "../lib/db";
import { crearEntregador, eliminarEntregador } from "../lib/crear";
import { colores, estilos, fmtFecha, fmtMoneda } from "./estilos";
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
  const [cargando, setCargando] = useState(true);
  const [pickerAbierto, setPickerAbierto] = useState(false);
  const [pestania, setPestania] = useState<Pestania>("datos");
  const nombres = useNombresProductor();
  const nombresZona = useNombresZona();
  const productores = useOpcionesProductor();

  useEffect(() => {
    let cancelado = false;
    database
      .get<Solicitud>("solicitudes")
      .find(solicitudId)
      .then((s) => {
        if (cancelado) return;
        setSolicitud(s);
        setCargando(false);
      })
      .catch(() => !cancelado && setCargando(false));

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

    return () => {
      cancelado = true;
      subEnt.unsubscribe();
      subTipos.unsubscribe();
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

      {/* Editar sólo mientras no subió: una vez sincronizada, el push del BE
          rechaza `updated` y la corrección va por la web. */}
      {s.esLocal ? (
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

          <Text style={estilos.seccion}>Crédito</Text>
          <Dato etiqueta="Tipo" valor={tipoNombre} />
          <Dato etiqueta="Total" valor={fmtMoneda(s.total)} />
          <Dato etiqueta="Aprobado" valor={fmtMoneda(s.aprobado)} />

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

function Dato({
  etiqueta,
  valor,
}: Readonly<{ etiqueta: string; valor?: string | null }>) {
  return (
    <View style={estilos.detalleFila}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.detalleValor}>{valor || "—"}</Text>
    </View>
  );
}
