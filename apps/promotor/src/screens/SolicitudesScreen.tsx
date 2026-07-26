import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Solicitud } from "../db/models";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { colores, estilos, fmtFecha, fmtMoneda } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";

/**
 * Solicitudes de crédito: las que bajaron del servidor y las creadas en el
 * teléfono, en una sola lista ordenada por fecha. Las locales llevan badge.
 */
export function SolicitudesScreen({ navigation }: Readonly<{ navigation: any }>) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombres = useNombresProductor();

  useEffect(() => {
    const sub = database
      .get<Solicitud>("solicitudes")
      .query(Q.sortBy("fecha", Q.desc))
      .observe()
      .subscribe((rows) => {
        setSolicitudes(rows);
        setCargando(false);
      });
    return () => sub.unsubscribe();
  }, []);

  const sincronizar = async () => {
    if (sincronizando) return;
    setSincronizando(true);
    setError(null);
    try {
      await syncNow();
    } catch (e) {
      setError((e as Error)?.message ?? "Error de sincronización");
    } finally {
      setSincronizando(false);
    }
  };

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
        <Text style={estilos.loadingText}>Cargando solicitudes...</Text>
      </View>
    );
  }

  return (
    <View style={estilos.root}>
      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}
      <FlatList
        data={solicitudes}
        keyExtractor={(s) => s.id}
        // extraData: los badges dependen de syncStatus/pushStatus, que cambian
        // sin que cambie la identidad de la fila. Sin esto la lista no repinta
        // después de un sync (mismo bug que se corrigió en recibos-cr).
        extraData={sincronizando}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={sincronizar} />
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              No hay solicitudes. Deslizá hacia abajo para sincronizar.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.fila}
            onPress={() =>
              navigation.navigate("SolicitudDetail", { solicitudId: item.id })
            }
          >
            <Text style={estilos.filaTitulo}>
              {item.idSocio != null
                ? (nombres.get(item.idSocio) ?? `Socio #${item.idSocio}`)
                : "(sin productor)"}
            </Text>
            <Text style={estilos.filaSubtitulo}>
              {fmtMoneda(item.total)} · {item.cosecha?.trim() || "sin cosecha"} ·{" "}
              {fmtFecha(item.fecha)}
            </Text>
            <EstadoPush fila={item} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
