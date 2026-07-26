import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor } from "../db/models";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { colores, estilos } from "./estilos";

/**
 * Lista de productores del cache local. Pull-only: el server manda.
 * Pull-to-refresh dispara un sync completo.
 */
export function ProductoresScreen({ navigation }: Readonly<{ navigation: any }>) {
  const [productores, setProductores] = useState<Productor[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    const sub = database
      .get<Productor>("productores")
      .query(Q.sortBy("nombre", Q.asc))
      .observe()
      .subscribe((rows) => {
        setProductores(rows);
        setLoading(false);
      });
    return () => sub.unsubscribe();
  }, []);

  // Filtro en memoria: el cache local del promotor son cientos de productores,
  // no decenas de miles. Si crece, mover a Q.like sobre una columna indexada.
  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();
    if (!termino) return productores;
    return productores.filter((p) => p.searchBlob.includes(termino));
  }, [productores, busqueda]);

  const sincronizar = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await syncNow();
    } catch (e) {
      setError((e as Error)?.message ?? "Error de sincronización");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
        <Text style={estilos.loadingText}>Cargando productores...</Text>
      </View>
    );
  }

  return (
    <View style={estilos.root}>
      <TextInput
        style={estilos.buscador}
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Buscar por código, nombre o cédula"
        placeholderTextColor={colores.textoTenue}
        autoCorrect={false}
      />
      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      <FlatList
        data={visibles}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={sincronizar} />
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              {busqueda
                ? "Ningún productor coincide con la búsqueda."
                : "No hay productores en el cache. Deslizá hacia abajo para sincronizar."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.fila}
            onPress={() =>
              navigation.navigate("ProductorDetail", { productorId: item.id })
            }
          >
            <Text style={estilos.filaTitulo}>{item.displayName}</Text>
            <Text style={estilos.filaSubtitulo}>
              {[item.codigo?.trim(), item.identificacion?.trim()]
                .filter(Boolean)
                .join(" · ") || "sin código"}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
