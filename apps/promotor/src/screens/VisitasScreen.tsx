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
import { TipoVisita, Visita } from "../db/models";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { colores, estilos, fmtFecha } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";

/** Visitas de campo, más recientes primero. */
export function VisitasScreen({ navigation }: Readonly<{ navigation: any }>) {
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [tipos, setTipos] = useState<Map<number, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombres = useNombresProductor();

  useEffect(() => {
    const subVisitas = database
      .get<Visita>("visitas")
      .query(Q.sortBy("fecha", Q.desc))
      .observe()
      .subscribe((rows) => {
        setVisitas(rows);
        setCargando(false);
      });

    const subTipos = database
      .get<TipoVisita>("tipos_visita")
      .query()
      .observe()
      .subscribe((rows) => {
        const mapa = new Map<number, string>();
        for (const t of rows) {
          const id = Number(t.id);
          if (!Number.isNaN(id)) mapa.set(id, t.nombre ?? `Tipo ${id}`);
        }
        setTipos(mapa);
      });

    return () => {
      subVisitas.unsubscribe();
      subTipos.unsubscribe();
    };
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
        <Text style={estilos.loadingText}>Cargando visitas...</Text>
      </View>
    );
  }

  return (
    <View style={estilos.root}>
      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}
      <FlatList
        data={visitas}
        keyExtractor={(v) => v.id}
        extraData={sincronizando}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={sincronizar} />
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              No hay visitas registradas. Deslizá hacia abajo para sincronizar.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.fila}
            onPress={() =>
              navigation.navigate("FotosVisita", { visitaLocalId: item.id })
            }
          >
            <Text style={estilos.filaTitulo}>
              {item.idSocio != null
                ? (nombres.get(item.idSocio) ?? `Socio #${item.idSocio}`)
                : "(sin productor)"}
            </Text>
            <Text style={estilos.filaSubtitulo}>
              {tipos.get(item.idTipoVisita) ?? `Tipo ${item.idTipoVisita}`} ·{" "}
              {fmtFecha(item.fecha)}
              {item.tieneGps ? " · 📍" : ""}
            </Text>
            {item.observaciones?.trim() ? (
              <Text style={estilos.filaSubtitulo} numberOfLines={2}>
                {item.observaciones.trim()}
              </Text>
            ) : null}
            <EstadoPush fila={item} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
