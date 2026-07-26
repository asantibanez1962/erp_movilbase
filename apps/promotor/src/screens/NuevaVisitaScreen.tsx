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
import { syncNow } from "../lib/sync";
import { obtenerPunto, type Punto } from "../lib/gps";
import { colores, estilos } from "./estilos";
import { PickerModal } from "./componentes/Picker";
import {
  useOpcionesFinca,
  useOpcionesProductor,
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

type PickerAbierto = "tipo" | "productor" | "finca" | "solicitud" | null;

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
  const { opciones: tiposOpciones, tipos } = useOpcionesTipoVisita();

  const [tipoId, setTipoId] = useState<string | null>(null);
  const [productorId, setProductorId] = useState<string | null>(null);
  const [fincaId, setFincaId] = useState<string | null>(null);
  const [solicitudId, setSolicitudId] = useState<string | null>(null);
  const [cosecha, setCosecha] = useState("");
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
  const exigeFinca = tipo?.exigeFinca ?? false;
  const exigeSolicitud = tipo?.exigeSolicitud ?? false;

  // Cambiar de productor invalida finca y solicitud: pertenecen al anterior.
  useEffect(() => {
    setFincaId(null);
    setSolicitudId(null);
  }, [productorId]);

  const puedeGuardar =
    tipoId != null &&
    productorId != null &&
    (!exigeFinca || fincaId != null) &&
    (!exigeSolicitud || solicitudId != null) &&
    !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const socio = Number(productorId);
      const tipoNum = Number(tipoId);
      if (Number.isNaN(socio) || Number.isNaN(tipoNum)) {
        throw new Error("Productor o tipo de visita inválidos.");
      }

      await crearVisita({
        idTipoVisita: tipoNum,
        idSocio: socio,
        cosecha: cosecha.trim() || null,
        idFinca: fincaId != null ? Number(fincaId) : null,
        idSolicitudLocal: solicitudId,
        observaciones: observaciones.trim() || null,
        prodEstimadaPromotor: aNumero(prodEstimada),
        gpsLat: punto?.lat ?? null,
        gpsLng: punto?.lng ?? null,
      });

      syncNow().catch((e) =>
        console.warn("sync tras crear visita", (e as Error)?.message)
      );

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
        <CampoSeleccion
          etiqueta="Productor"
          requerido
          valorMostrado={productores.find((p) => p.valor === productorId)?.titulo ?? null}
          onAbrir={() => setAbierto("productor")}
        />
        <CampoTexto etiqueta="Cosecha" valor={cosecha} onCambiar={setCosecha} placeholder="2526" />

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
