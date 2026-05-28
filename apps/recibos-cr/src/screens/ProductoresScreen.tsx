import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor } from "@erp/shared-sync";
import { useAuthStore } from "@erp/shared-api";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { config } from "../lib/config";

/**
 * Lista de productores cacheados localmente en WMDB. Pull-to-refresh
 * dispara sync. Header lo provee el Stack (no más custom header acá).
 * Logout y "Sincronizar todo" viven en el drawer (≡ swipe izquierdo).
 */
export function ProductoresScreen() {
  const [productores, setProductores] = useState<Productor[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const user = useAuthStore((s) => s.user);

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

  useEffect(() => {
    triggerSync(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSync = async (userInitiated: boolean) => {
    if (syncing) return;
    setSyncing(true);
    if (userInitiated) setError(null);
    try {
      await syncNow();
      setLastSyncAt(new Date());
      setError(null);
    } catch (e: any) {
      const msg = e?.message ?? "Error de sincronización";
      if (userInitiated) setError(msg);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Cargando productores...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {productores.length} {productores.length === 1 ? "registro" : "registros"}
          {" • "}Empresa {config.companyId}
          {user && ` • ${user.usuario}`}
          {lastSyncAt && ` • Sync ${formatTime(lastSyncAt)}`}
        </Text>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      <FlatList
        data={productores}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => triggerSync(true)}
            tintColor="#3b82f6"
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          error ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No hay productores en esta empresa.
              </Text>
              <Text style={styles.emptyHint}>
                Arrastrá hacia abajo para sincronizar.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowName}>{item.displayName}</Text>
            {item.identificacion && (
              <Text style={styles.rowMeta}>Cédula: {item.identificacion}</Text>
            )}
            {item.telefonos && (
              <Text style={styles.rowMeta}>Tel: {item.telefonos}</Text>
            )}
            {item.email && <Text style={styles.rowMeta}>{item.email}</Text>}
          </View>
        )}
      />
    </View>
  );
}

function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, color: "#64748b" },
  summary: {
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  summaryText: { color: "#475569", fontSize: 12 },
  errorBanner: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorText: { color: "#b91c1c", fontSize: 13 },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
  row: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#fff" },
  rowName: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  rowMeta: { fontSize: 13, color: "#64748b", marginTop: 2 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { color: "#94a3b8" },
  emptyHint: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
});
