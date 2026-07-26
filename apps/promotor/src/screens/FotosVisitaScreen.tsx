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
  encolarFoto,
  flushPendingUploads,
  fotosDelServidor,
  fotosLocalesDe,
  type FotoServidor,
} from "../lib/fotos";
import { PendingUpload } from "../db/models";
import { colores, estilos } from "./estilos";

/**
 * Cámara para adjuntar fotos a una visita.
 *
 * Las fotos NO se suben acá: se comprimen y se encolan en `pending_uploads`, y
 * viajan a /attachments/Visita/{serverId} después del sync, cuando la visita ya
 * tiene id de servidor. En campo casi nunca hay red al momento de la foto, así
 * que intentar subir en el acto sólo produciría errores y esperas.
 */
function estadoTexto(status: string): string {
  if (status === "subida") return "enviada";
  if (status === "error") return "error";
  return "en cola";
}

function estadoColor(status: string): string {
  if (status === "subida") return colores.exito;
  if (status === "error") return colores.error;
  return colores.advertencia;
}

/**
 * Resumen de arriba. Menciona aparte las que están en el servidor sin copia
 * local: son fotos que existen en el ERP pero que acá no se pueden mostrar —
 * porque las subió otro dispositivo o porque la purga ya liberó el archivo— y sin
 * decirlo el promotor creería que se perdieron.
 */
function resumen(locales: PendingUpload[], soloEnServidor: number): string {
  const enCola = locales.filter((f) => !f.yaSubio).length;
  const enviadas = locales.length - enCola;

  const partes: string[] = [];
  if (enviadas > 0) partes.push(`${enviadas} enviada(s)`);
  if (enCola > 0) partes.push(`${enCola} en cola`);
  if (soloEnServidor > 0) partes.push(`${soloEnServidor} en el servidor`);

  return partes.length === 0 ? "Sin fotos todavía" : partes.join(" · ");
}

export function FotosVisitaScreen({ route }: Readonly<{ route: any }>) {
  const { visitaLocalId } = route.params as { visitaLocalId: string };

  const [permiso, pedirPermiso] = useCameraPermissions();
  const [locales, setLocales] = useState<PendingUpload[]>([]);
  const [enServidor, setEnServidor] = useState<FotoServidor[]>([]);
  const [capturando, setCapturando] = useState(false);
  const camara = useRef<CameraView>(null);

  const refrescar = async () => setLocales(await fotosLocalesDe(visitaLocalId));

  useEffect(() => {
    void refrescar();
    // Las del servidor son las que subió otro dispositivo, o las propias cuya
    // copia local ya purgó por antigüedad. Sin señal devuelve vacío y se muestran
    // sólo las locales.
    fotosDelServidor(visitaLocalId).then(setEnServidor).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitaLocalId]);

  // Cuántas del servidor no tienen copia local: son las que el promotor no puede
  // ver acá pero sí existen en el ERP.
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
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={[estilos.vacioTexto, { marginBottom: 20 }]}>
          Necesitamos permiso de cámara para adjuntar fotos a la visita.
        </Text>
        <TouchableOpacity
          onPress={pedirPermiso}
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
            Dar permiso
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
        await encolarFoto(visitaLocalId, foto.uri);
        await refrescar();
        // Si hay señal y la visita ya subió, la foto se va ahora mismo en vez de
        // esperar al próximo sync. Si no, queda en la cola: por eso no se await
        // ni se muestra el error.
        flushPendingUploads()
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
            {capturando ? "Guardando..." : "📷 Tomar foto"}
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
              {/* Estado explícito: si no, el promotor no distingue una foto
                  guardada de una ya enviada, y vuelve a sacarla por las dudas. */}
              <Text
                style={{
                  fontSize: 11,
                  marginTop: 3,
                  color: estadoColor(item.status),
                }}
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
