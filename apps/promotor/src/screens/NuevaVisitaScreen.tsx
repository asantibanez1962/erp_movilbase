import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { crearVisita } from "../lib/crear";
import { obtenerPunto, type Punto } from "../lib/gps";
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
export function NuevaVisitaScreen({ navigation }: Readonly<{ navigation: any }>) {
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
  const [gpsEstado, setGpsEstado] = useState<"buscando" | "listo" | "sin-senal">(
    "buscando"
  );

  useEffect(() => {
    let cancelado = false;
    obtenerPunto().then((p) => {
      if (cancelado) return;
      setPunto(p);
      setGpsEstado(p ? "listo" : "sin-senal");
    });
    return () => {
      cancelado = true;
    };
  }, []);

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

  // Cambiar de productor invalida finca y solicitud: pertenecen al anterior.
  useEffect(() => {
    setFincaId(null);
    setSolicitudId(null);
  }, [productorId]);

  // Cambiar de tipo puede cambiar el destino: lo elegido para el destino viejo
  // ya no aplica y arrastrarlo guardaría, por ejemplo, un recibidor en una
  // visita a finca.
  useEffect(() => {
    if (!exigeProductor) setProductorId(null);
    if (!exigeRecibidor) setRecibidorCodigo(null);
    if (!exigeFinca) setFincaId(null);
    if (!exigeSolicitud) setSolicitudId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoId]);

  const puedeGuardar =
    tipoId != null &&
    (!exigeProductor || productorId != null) &&
    (!exigeRecibidor || recibidorCodigo != null) &&
    (!exigeFinca || fincaId != null) &&
    (!exigeSolicitud || solicitudId != null) &&
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

      await crearVisita({
        idTipoVisita: tipoNum,
        idSocio: socio,
        recibidor: exigeRecibidor ? recibidorCodigo : null,
        idFinca: fincaId != null ? Number(fincaId) : null,
        idSolicitudLocal: solicitudId,
        observaciones: observaciones.trim() || null,
        prodEstimadaPromotor: aNumero(prodEstimada),
        gpsLat: punto?.lat ?? null,
        gpsLng: punto?.lng ?? null,
      });

      // Sin sync automático, igual que en solicitudes: el promotor todavía tiene
      // que sacarle las fotos a esta visita. Sincroniza desde el drawer al
      // terminar la captura.
      navigation.goBack();
    } catch (e) {
      Alert.alert("No se pudo guardar", (e as Error)?.message ?? "Error desconocido");
      setGuardando(false);
    }
  };

  const reintentarGps = async () => {
    setGpsEstado("buscando");
    const p = await obtenerPunto();
    setPunto(p);
    setGpsEstado(p ? "listo" : "sin-senal");
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
            {gpsEstado === "listo" && punto
              ? `📍 ${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` +
                (punto.precisionM ? ` (±${Math.round(punto.precisionM)} m)` : "")
              : gpsEstado === "buscando"
                ? "Buscando señal..."
                : "Sin señal — tocá para reintentar"}
          </Text>
        </TouchableOpacity>

        <BotonPrimario
          texto={guardando ? "Guardando..." : "Guardar visita"}
          onPress={guardar}
          deshabilitado={!puedeGuardar}
        />
        {gpsEstado === "sin-senal" && (
          <Text style={[estilos.vacioTexto, { paddingTop: 10 }]}>
            Se puede guardar sin GPS; la visita queda sin coordenadas.
          </Text>
        )}
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
