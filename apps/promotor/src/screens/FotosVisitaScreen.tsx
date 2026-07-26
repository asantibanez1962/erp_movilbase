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
import { encolarFoto, fotosPendientesDe } from "../lib/fotos";
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
export function FotosVisitaScreen({ route }: Readonly<{ route: any }>) {
  const { visitaLocalId } = route.params as { visitaLocalId: string };

  const [permiso, pedirPermiso] = useCameraPermissions();
  const [encoladas, setEncoladas] = useState<PendingUpload[]>([]);
  const [capturando, setCapturando] = useState(false);
  const camara = useRef<CameraView>(null);

  const refrescar = async () => setEncoladas(await fotosPendientesDe(visitaLocalId));

  useEffect(() => {
    void refrescar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitaLocalId]);

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
          {encoladas.length === 0
            ? "Sin fotos todavía"
            : `${encoladas.length} foto(s) en cola — se suben al sincronizar`}
        </Text>
      </View>

      {encoladas.length > 0 && (
        <FlatList
          horizontal
          data={encoladas}
          keyExtractor={(f) => f.id}
          style={{ maxHeight: 96 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item }) => (
            <Image
              source={{ uri: item.fileUri }}
              style={{
                width: 72,
                height: 72,
                borderRadius: 6,
                marginRight: 8,
                borderWidth: item.status === "error" ? 2 : 0,
                borderColor: colores.error,
              }}
            />
          )}
        />
      )}
    </View>
  );
}
