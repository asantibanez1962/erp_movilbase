import { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { actualizarVisita, crearVisita } from "../lib/crear";
import { Visita } from "../db/models";
import { database } from "../lib/db";
import { obtenerPunto, type Punto } from "../lib/gps";
import { abrirAjustesDeLaApp, permisoUbicacion } from "../lib/permisos";
import { useSesion } from "../lib/sesion";
import { colores, estilos } from "./estilos";
import { PickerModal } from "./componentes/Picker";
import {
  useOpcionesFinca,
  useOpcionesProductor,
  useOpcionesRecibidor,
  useOpcionesSolicitud,
  useOpcionesTipoVisita,
} from "./componentes/opciones";
import {
  aNumero,
  BotonPrimario,
  CampoNumero,
  CampoSeleccion,
  CampoTexto,
} from "./componentes/Campos";

type PickerAbierto =
  | "tipo"
  | "productor"
  | "finca"
  | "solicitud"
  | "recibidor"
  | null;

/**
 * Alta de visita de campo.
 *
 * El tipo de visita gobierna el form (igual que en el ERP web): si el tipo
 * exige finca aparece el picker de fincas del productor, y si exige solicitud
 * —el tipo "Validación de Crédito"— aparece el de solicitudes y el campo de
 * producción estimada, que es el que el hook del BE copia a la solicitud.
 *
 * El GPS se pide apenas abre la pantalla, no al guardar: enganchar el fix bajo
 * sombra de cafetal tarda, y arrancarlo temprano hace que casi siempre esté
 * listo cuando el promotor termina de escribir.
 */
export function NuevaVisitaScreen({
  navigation,
  route,
}: Readonly<{ navigation: any; route?: any }>) {
  // Con visitaId el form entra en modo edición. Se reusa la misma pantalla para
  // no mantener dos listas de campos que se desincronizan.
  const visitaId: string | undefined = route?.params?.visitaId;
  const [editando, setEditando] = useState<Visita | null>(null);
  const productores = useOpcionesProductor();
  const recibidores = useOpcionesRecibidor();
  const { opciones: tiposOpciones, tipos } = useOpcionesTipoVisita();

  const [tipoId, setTipoId] = useState<string | null>(null);
  const [productorId, setProductorId] = useState<string | null>(null);
  const [recibidorCodigo, setRecibidorCodigo] = useState<string | null>(null);
  const [fincaId, setFincaId] = useState<string | null>(null);
  const [solicitudId, setSolicitudId] = useState<string | null>(null);
  const cosechaSesion = useSesion((s) => s.cosecha);
  const [observaciones, setObservaciones] = useState("");
  const [prodEstimada, setProdEstimada] = useState("");
  const [abierto, setAbierto] = useState<PickerAbierto>(null);
  const [guardando, setGuardando] = useState(false);

  const [punto, setPunto] = useState<Punto | null>(null);
  const [gpsEstado, setGpsEstado] = useState<
    "buscando" | "listo" | "sin-senal" | "sin-permiso"
  >("buscando");

  useEffect(() => {
    let cancelado = false;
    // Sin pedir permiso: acá el fix se busca solo, y un diálogo de sistema al abrir
    // la pantalla interrumpe la captura. Si falta el permiso se dice en la fila del
    // GPS y se pide cuando el promotor la toca.
    obtenerPunto().then((r) => {
      if (cancelado) return;
      setPunto(r.punto);
      setGpsEstado(r.punto ? "listo" : (r.motivo ?? "sin-senal"));
    });
    return () => {
      cancelado = true;
    };
  }, []);

  // Modo edición: precargar la visita existente.
  useEffect(() => {
    if (!visitaId) return;
    let cancelado = false;
    database
      .get<Visita>("visitas")
      .find(visitaId)
      .then((v) => {
        if (cancelado) return;
        setEditando(v);
        setTipoId(String(v.idTipoVisita));
        setProductorId(v.idSocio != null ? String(v.idSocio) : null);
        setRecibidorCodigo(v.recibidor?.trim() ?? null);
        setFincaId(v.idFinca != null ? String(v.idFinca) : null);
        setSolicitudId(v.idSolicitud ?? null);
        setObservaciones(v.observaciones ?? "");
        setProdEstimada(
          v.prodEstimadaPromotor != null ? String(v.prodEstimadaPromotor) : ""
        );
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [visitaId]);

  const idSocio = productorId != null ? Number(productorId) : null;
  const fincas = useOpcionesFinca(Number.isNaN(idSocio) ? null : idSocio);
  const solicitudes = useOpcionesSolicitud(Number.isNaN(idSocio) ? null : idSocio);

  const tipo = tipoId ? tipos.get(tipoId) : undefined;
  // El destino sale de `requierefinca`, que pese al nombre tiene tres valores:
  // 0 recibidor, 1 finca, 2 productor (ver TipoVisita.destino).
  const exigeProductor = tipo?.exigeProductor ?? false;
  const exigeFinca = tipo?.exigeFinca ?? false;
  const exigeRecibidor = tipo?.exigeRecibidor ?? false;
  const exigeSolicitud = tipo?.exigeSolicitud ?? false;
  // El tipo exige punto GPS (v1.53/RC/57). "Exige" y no "obliga": ver la nota de
  // `omitirGps` más abajo.
  const exigeGps = tipo?.exigeGps ?? false;

  // Los dos efectos de limpieza reaccionan sólo a cambios HECHOS POR EL USUARIO.
  // Sin los refs se disparaban también en el primer render y al precargar en modo
  // edición, borrando justo lo que se acababa de cargar — y peor: al precargar, el
  // catálogo de tipos puede no haber bajado aún, así que `tipo` era undefined,
  // todos los exige* daban false y se limpiaba todo.
  const productorAnterior = useRef<string | null | undefined>(undefined);
  const tipoAnterior = useRef<string | null | undefined>(undefined);

  // Cambiar de productor invalida finca y solicitud: pertenecen al anterior.
  useEffect(() => {
    const cambioReal =
      productorAnterior.current !== undefined &&
      productorAnterior.current !== productorId;
    productorAnterior.current = productorId;
    if (!cambioReal) return;
    setFincaId(null);
    setSolicitudId(null);
  }, [productorId]);

  // Cambiar de tipo puede cambiar el destino: lo elegido para el destino viejo
  // ya no aplica y arrastrarlo guardaría, por ejemplo, un recibidor en una
  // visita a finca.
  useEffect(() => {
    const cambioReal =
      tipoAnterior.current !== undefined && tipoAnterior.current !== tipoId;
    tipoAnterior.current = tipoId;
    if (!cambioReal) return;
    if (!exigeProductor) setProductorId(null);
    if (!exigeRecibidor) setRecibidorCodigo(null);
    if (!exigeFinca) setFincaId(null);
    if (!exigeSolicitud) setSolicitudId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoId]);

  /**
   * El promotor confirmó que no hay señal GPS y guarda igual.
   *
   * POR QUÉ EXISTE ESTA VÁLVULA
   * El legacy rechaza una visita sin GPS. Replicarlo tal cual acá le costaría la visita
   * entera: bajo sombra de cafetal el fix puede tardar minutos o no llegar, y perder el
   * registro es peor que perder el punto. Así que la app INSISTE —guardar deshabilitado,
   * reintento a la vista— pero deja una salida explícita, y la marca en `gps_omitido`
   * para que la oficina distinga "no se pudo" de "nadie se ocupó". Eso último es
   * justamente lo que el legacy pierde al rechazar.
   *
   * Se resetea si cambia el tipo: la confirmación fue para ESTE tipo de visita.
   */
  const [omitirGps, setOmitirGps] = useState(false);
  useEffect(() => setOmitirGps(false), [tipoId]);

  const faltaGps = exigeGps && punto == null && !omitirGps;

  const puedeGuardar =
    tipoId != null &&
    (!exigeProductor || productorId != null) &&
    (!exigeRecibidor || recibidorCodigo != null) &&
    (!exigeFinca || fincaId != null) &&
    (!exigeSolicitud || solicitudId != null) &&
    !faltaGps &&
    !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const tipoNum = Number(tipoId);
      if (Number.isNaN(tipoNum)) throw new Error("Tipo de visita inválido.");

      // En destino 'recibidor' no hay productor: la visita va contra el recibidor.
      const socio = exigeProductor ? Number(productorId) : null;
      if (socio != null && Number.isNaN(socio)) {
        throw new Error("Productor inválido.");
      }

      const datos = {
        idTipoVisita: tipoNum,
        idSocio: socio,
        recibidor: exigeRecibidor ? recibidorCodigo : null,
        idFinca: exigeFinca && fincaId != null ? Number(fincaId) : null,
        idSolicitudLocal: exigeSolicitud ? solicitudId : null,
        observaciones: observaciones.trim() || null,
        prodEstimadaPromotor: aNumero(prodEstimada),
        gpsLat: punto?.lat ?? null,
        gpsLng: punto?.lng ?? null,
        // Sólo cuenta como omisión si el tipo lo exigía y de verdad no hay punto.
        gpsOmitido: exigeGps && punto == null,
      };

      if (editando) {
        await actualizarVisita(editando, datos);
        navigation.goBack();
        return;
      }

      await crearVisita(datos);

      // Sin sync automático, igual que en solicitudes: el promotor todavía tiene
      // que sacarle las fotos a esta visita. Sincroniza desde el drawer al
      // terminar la captura.
      navigation.goBack();
    } catch (e) {
      Alert.alert("No se pudo guardar", (e as Error)?.message ?? "Error desconocido");
      setGuardando(false);
    }
  };

  /**
   * Reintento explícito. Acá SÍ se pide el permiso si falta: el promotor tocó la
   * fila, así que el diálogo es la respuesta a algo que él pidió. Y si Android ya no
   * lo va a mostrar (denegado dos veces, o auto-revocado), se lo manda a Ajustes en
   * vez de dejarlo tocando un botón que no hace nada.
   */
  /**
   * Confirma la omisión del GPS. Con diálogo y no con un toggle silencioso: es una
   * decisión que queda registrada en el expediente de la visita, así que el promotor
   * tiene que enterarse de que la está tomando.
   */
  const confirmarOmitirGps = () => {
    Alert.alert(
      "Guardar sin GPS",
      "Este tipo de visita necesita el punto. Si no hay señal se puede guardar igual, " +
        "pero queda registrado que la visita no tiene coordenadas. ¿Continuar?",
      [
        { text: "Seguir intentando", style: "cancel" },
        { text: "Guardar sin GPS", style: "destructive", onPress: () => setOmitirGps(true) },
      ]
    );
  };

  const reintentarGps = async () => {
    if (gpsEstado === "sin-permiso") {
      const permiso = await permisoUbicacion(true);
      if (!permiso.concedido) {
        if (!permiso.puedeVolverAPreguntar) {
          Alert.alert(
            "Permiso de ubicación bloqueado",
            "Android ya no va a preguntar por este permiso. Hay que activarlo a mano en Ajustes → Permisos → Ubicación, eligiendo \"Mientras usas la app\".",
            [
              { text: "Después", style: "cancel" },
              { text: "Abrir ajustes", onPress: () => void abrirAjustesDeLaApp() },
            ]
          );
        }
        return;
      }
    }

    setGpsEstado("buscando");
    const r = await obtenerPunto(true);
    setPunto(r.punto);
    setGpsEstado(r.punto ? "listo" : (r.motivo ?? "sin-senal"));
  };

  return (
    <KeyboardAvoidingView
      style={estilos.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={estilos.seccion}>Visita</Text>
        <CampoSeleccion
          etiqueta="Tipo de visita"
          requerido
          valorMostrado={tipo?.nombre ?? null}
          onAbrir={() => setAbierto("tipo")}
        />
        {/* Qué se pide depende del destino del tipo, igual que en el legacy:
            recibidor → combo recibidor; productor → sólo productor;
            finca → productor + finca. */}
        {exigeProductor ? (
          <CampoSeleccion
            etiqueta="Productor"
            requerido
            valorMostrado={
              productores.find((p) => p.valor === productorId)?.titulo ?? null
            }
            onAbrir={() => setAbierto("productor")}
          />
        ) : null}

        {exigeRecibidor ? (
          <CampoSeleccion
            etiqueta="Recibidor"
            requerido
            valorMostrado={
              recibidores.find((r) => r.valor === recibidorCodigo)?.titulo ?? null
            }
            onAbrir={() => setAbierto("recibidor")}
          />
        ) : null}
        {/* Heredada de la sesión, igual que en la solicitud. */}
        <View style={estilos.detalleFila}>
          <Text style={estilos.detalleEtiqueta}>Cosecha</Text>
          <Text style={estilos.detalleValor}>{cosechaSesion ?? "—"}</Text>
        </View>

        {exigeFinca && (
          <CampoSeleccion
            etiqueta="Finca"
            requerido
            deshabilitado={productorId == null}
            valorMostrado={fincas.find((f) => f.valor === fincaId)?.titulo ?? null}
            onAbrir={() => setAbierto("finca")}
          />
        )}

        {exigeSolicitud && (
          <>
            <CampoSeleccion
              etiqueta="Solicitud de crédito"
              requerido
              deshabilitado={productorId == null}
              valorMostrado={
                solicitudes.find((s) => s.valor === solicitudId)?.titulo ?? null
              }
              onAbrir={() => setAbierto("solicitud")}
            />
            <CampoNumero
              etiqueta="Producción estimada por el promotor"
              valor={prodEstimada}
              onCambiar={setProdEstimada}
            />
            <Text style={[estilos.vacioTexto, { paddingHorizontal: 16, paddingTop: 6, textAlign: "left" }]}>
              Este valor se copia a la solicitud y marca su inspección de campo.
            </Text>
          </>
        )}

        <CampoTexto
          etiqueta="Observaciones"
          valor={observaciones}
          onCambiar={setObservaciones}
          multilinea
        />

        <Text style={estilos.seccion}>Ubicación</Text>
        <TouchableOpacity style={estilos.detalleFila} onPress={reintentarGps}>
          <Text style={estilos.detalleEtiqueta}>GPS</Text>
          <Text
            style={[
              estilos.detalleValor,
              {
                color:
                  gpsEstado === "listo"
                    ? colores.exito
                    : gpsEstado === "buscando"
                      ? colores.advertencia
                      : colores.error,
              },
            ]}
          >
            {textoGps(gpsEstado, punto)}
          </Text>
        </TouchableOpacity>

        <BotonPrimario
          texto={guardando ? "Guardando..." : "Guardar visita"}
          onPress={guardar}
          deshabilitado={!puedeGuardar}
        />
        {/* Sin GPS, el mensaje y las opciones dependen de si el tipo lo exige. */}
        {punto == null && (gpsEstado === "sin-senal" || gpsEstado === "sin-permiso") ? (
          exigeGps ? (
            <>
              <Text
                style={[
                  estilos.vacioTexto,
                  { paddingTop: 10, paddingHorizontal: 16, color: colores.advertencia },
                ]}
              >
                Este tipo de visita necesita el punto GPS. Tocá la fila de arriba para
                reintentar; a veces hay que salir de debajo de los árboles.
              </Text>
              {/* La salida explícita. No se ofrece de entrada —aparece recién cuando el
                  GPS ya falló— para que sea la última opción y no la primera. */}
              {omitirGps ? (
                <Text
                  style={[
                    estilos.vacioTexto,
                    { paddingTop: 10, paddingHorizontal: 16, color: colores.error },
                  ]}
                >
                  Se va a guardar SIN coordenadas, y queda marcado como GPS omitido.
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={confirmarOmitirGps}
                  style={{ paddingVertical: 14, paddingHorizontal: 16, alignItems: "center" }}
                >
                  <Text
                    style={{ color: colores.error, fontSize: 15, fontWeight: "700" }}
                  >
                    Guardar sin GPS
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={[estilos.vacioTexto, { paddingTop: 10 }]}>
              Se puede guardar sin GPS; la visita queda sin coordenadas.
            </Text>
          )
        ) : null}
        <View style={{ height: 40 }} />
      </ScrollView>

      <PickerModal
        visible={abierto === "tipo"}
        titulo="Tipo de visita"
        opciones={tiposOpciones}
        onSeleccionar={setTipoId}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "productor"}
        titulo="Elegir productor"
        opciones={productores}
        onSeleccionar={setProductorId}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "recibidor"}
        titulo="Elegir recibidor"
        opciones={recibidores}
        onSeleccionar={setRecibidorCodigo}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "finca"}
        titulo="Elegir finca"
        opciones={fincas}
        onSeleccionar={setFincaId}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "solicitud"}
        titulo="Elegir solicitud"
        opciones={solicitudes}
        onSeleccionar={setSolicitudId}
        onCerrar={() => setAbierto(null)}
      />
    </KeyboardAvoidingView>
  );
}

type EstadoGps = "buscando" | "listo" | "sin-senal" | "sin-permiso";

/**
 * "Sin permiso" y "sin señal" se dicen distinto porque se arreglan distinto:
 * mostrarlos igual manda a caminar buscando señal a alguien que sólo tiene que
 * tocar un botón.
 */
function textoGps(estado: EstadoGps, punto: Punto | null): string {
  if (estado === "listo" && punto) {
    const precision = punto.precisionM ? ` (±${Math.round(punto.precisionM)} m)` : "";
    return `📍 ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}${precision}`;
  }
  if (estado === "buscando") return "Buscando señal...";
  if (estado === "sin-permiso") return "Falta el permiso — tocá para darlo";
  return "Sin señal — tocá para reintentar";
}
