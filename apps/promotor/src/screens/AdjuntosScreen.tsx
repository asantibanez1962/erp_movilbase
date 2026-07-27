import { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  adjuntosDelServidor,
  adjuntosLocalesDe,
  encolarAdjunto,
  flushAdjuntos,
  type AdjuntoServidor,
} from "../lib/adjuntos";
import { abrirAjustesDeLaApp } from "../lib/permisos";
import { PendingUpload } from "../db/models";
import { colores, estilos } from "./estilos";

/**
 * Cámara para adjuntar imágenes a cualquier registro: fotos de una visita, cédula
 * y respaldos de una solicitud.
 *
 * Los adjuntos NO se suben acá: se comprimen y se encolan, y viajan a
 * /attachments/{Entity}/{serverId} cuando el registro dueño ya tiene id de
 * servidor. En campo casi nunca hay red al momento de capturar, así que intentar
 * subir en el acto sólo produciría errores y esperas.
 *
 * Genérica por (coleccion, registroLocalId) — arrancó atada a visitas, pero es el
 * mismo mecanismo y el platform ya guarda los adjuntos por (entidad, registro).
 */
export function AdjuntosScreen({ route }: Readonly<{ route: any }>) {
  const { coleccion, registroLocalId, titulo } = route.params as {
    coleccion: string;
    registroLocalId: string;
    titulo?: string;
  };

  const [permiso, pedirPermiso] = useCameraPermissions();
  const [locales, setLocales] = useState<PendingUpload[]>([]);
  const [enServidor, setEnServidor] = useState<AdjuntoServidor[]>([]);
  const [capturando, setCapturando] = useState(false);
  const camara = useRef<CameraView>(null);

  const refrescar = async () =>
    setLocales(await adjuntosLocalesDe(coleccion, registroLocalId));

  useEffect(() => {
    void refrescar();
    // Los del servidor son los que subió otro dispositivo, o los propios cuya
    // copia local ya purgó. Sin señal devuelve vacío y se muestran sólo los locales.
    adjuntosDelServidor(coleccion, registroLocalId)
      .then(setEnServidor)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coleccion, registroLocalId]);

  // Cuántos del servidor no tienen copia local: existen en el ERP pero acá no se
  // pueden mostrar. Sin decirlo, uno creería que se perdieron.
  const soloEnServidor = Math.max(
    enServidor.length - locales.filter((f) => f.yaSubio).length,
    0
  );

  if (!permiso) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>Verificando permisos de cámara...</Text>
      </View>
    );
  }

  if (!permiso.granted) {
    // Si Android ya no va a mostrar el diálogo (denegado dos veces, o el permiso
    // auto-revocado por desuso), el botón de pedirlo no hace nada y parece que la
    // app está rota. En ese caso el único camino es Ajustes, y hay que decirlo.
    const soloAjustes = !permiso.canAskAgain;
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={[estilos.vacioTexto, { marginBottom: 20 }]}>
          {soloAjustes
            ? 'Android ya no va a preguntar por el permiso de cámara. Hay que activarlo a mano en Ajustes → Permisos → Cámara, eligiendo "Mientras usas la app".'
            : "Necesitamos permiso de cámara para adjuntar imágenes."}
        </Text>
        <TouchableOpacity
          onPress={soloAjustes ? () => void abrirAjustesDeLaApp() : pedirPermiso}
          style={{
            backgroundColor: colores.primario,
            paddingHorizontal: 24,
            paddingVertical: 14,
            borderRadius: 8,
            minHeight: 48,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            {soloAjustes ? "Abrir ajustes" : "Dar permiso"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const tomar = async () => {
    if (capturando) return;
    setCapturando(true);
    try {
      const foto = await camara.current?.takePictureAsync({ quality: 1 });
      if (foto?.uri) {
        await encolarAdjunto(coleccion, registroLocalId, foto.uri);
        await refrescar();
        // Si hay señal y el registro ya subió, el adjunto se va ahora mismo en vez
        // de esperar al próximo sync. Si no, queda en la cola: por eso no se
        // await ni se muestra el error.
        flushAdjuntos()
          .then(refrescar)
          .catch((e) => console.warn("upload inmediato falló", (e as Error)?.message));
      }
    } catch (e) {
      Alert.alert("No se pudo tomar la foto", (e as Error)?.message ?? "Error desconocido");
    } finally {
      setCapturando(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colores.fondoOscuro }}>
      <CameraView ref={camara} style={{ flex: 1 }} facing="back" />

      <View style={{ padding: 16, alignItems: "center" }}>
        <TouchableOpacity
          onPress={tomar}
          disabled={capturando}
          style={{
            backgroundColor: capturando ? colores.textoTenue : colores.primario,
            paddingHorizontal: 32,
            paddingVertical: 16,
            borderRadius: 40,
            minHeight: 56,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            {capturando ? "Guardando..." : `📷 ${titulo ?? "Adjuntar"}`}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: colores.textoTenue, fontSize: 13, marginTop: 12 }}>
          {resumen(locales, soloEnServidor)}
        </Text>
      </View>

      {locales.length > 0 ? (
        <FlatList
          horizontal
          data={locales}
          keyExtractor={(f) => f.id}
          style={{ maxHeight: 110 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item }) => (
            <View style={{ marginRight: 8, alignItems: "center" }}>
              <Image
                source={{ uri: item.fileUri }}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 6,
                  borderWidth: item.status === "error" ? 2 : 0,
                  borderColor: colores.error,
                }}
              />
              {/* Estado explícito: si no, no se distingue un adjunto guardado de
                  uno ya enviado, y se vuelve a capturar por las dudas. */}
              <Text
                style={{ fontSize: 11, marginTop: 3, color: estadoColor(item.status) }}
              >
                {estadoTexto(item.status)}
              </Text>
            </View>
          )}
        />
      ) : null}
    </View>
  );
}

function estadoTexto(status: string): string {
  if (status === "subida") return "enviado";
  if (status === "error") return "error";
  return "en cola";
}

function estadoColor(status: string): string {
  if (status === "subida") return colores.exito;
  if (status === "error") return colores.error;
  return colores.advertencia;
}

/**
 * Menciona aparte los que están en el servidor sin copia local: existen en el ERP
 * pero acá no se pueden mostrar —los subió otro dispositivo, o la purga ya liberó
 * el archivo— y sin decirlo uno creería que se perdieron.
 */
function resumen(locales: PendingUpload[], soloEnServidor: number): string {
  const enCola = locales.filter((f) => !f.yaSubio).length;
  const enviados = locales.length - enCola;

  const partes: string[] = [];
  if (enviados > 0) partes.push(`${enviados} enviado(s)`);
  if (enCola > 0) partes.push(`${enCola} en cola`);
  if (soloEnServidor > 0) partes.push(`${soloEnServidor} en el servidor`);

  return partes.length === 0 ? "Sin adjuntos todavía" : partes.join(" · ");
}
