import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor } from "@erp/shared-sync";
import { useAuthStore } from "@erp/shared-api";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { config } from "../lib/config";

/**
 * Fuente de verdad: WMDB local. La UI se subscribe a la collection
 * "productores" y re-rendea cuando hay cambios (post-sync, edits locales,
 * etc.).
 *
 * Flow del usuario:
 *   1. Mount → si la DB local está vacía, dispara sync silencioso.
 *   2. Pull-to-refresh → fuerza sync explícito.
 *   3. Sin internet → sigue mostrando los productores cacheados.
 *
 * El sync errores no bloquean la UI: si offline, mostramos lo que hay
 * en cache + un banner sutil "sin conexión".
 */
export function ProductoresScreen({ onGoRecibos }: { onGoRecibos: () => void }) {
  const [productores, setProductores] = useState<Productor[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  // Subscribe to WMDB collection. Se desuscribe al unmount.
  useEffect(() => {
    const subscription = database
      .get<Productor>("productores")
      .query(Q.sortBy("nombre", Q.asc))
      .observe()
      .subscribe((rows) => {
        setProductores(rows);
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  // Sync inicial al mount (silencioso — UI ya muestra cache si hay).
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
      // Solo mostramos el error si fue gesture del usuario — sync silencioso
      // que falla (boot offline) no debe asustar.
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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Productores</Text>
          <Text style={styles.headerSubtitle}>
            {productores.length} {productores.length === 1 ? "registro" : "registros"}
            {" • "}Empresa {config.companyId}
            {lastSyncAt && ` • Sync: ${formatTime(lastSyncAt)}`}
          </Text>
        </View>
        <TouchableOpacity onPress={onGoRecibos} style={styles.recibosBtn}>
          <Text style={styles.recibosText}>Recibos ›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {user && <Text style={styles.userLine}>Sesión: {user.usuario}</Text>}

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
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: { color: "#f1f5f9", fontSize: 22, fontWeight: "700" },
  headerSubtitle: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  recibosBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#3b82f6",
    borderRadius: 6,
    marginRight: 8,
  },
  recibosText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 6,
  },
  logoutText: { color: "#e2e8f0", fontSize: 13 },
  userLine: {
    color: "#94a3b8",
    fontSize: 11,
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  errorBanner: {
    backgroundColor: "#fef2f2",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#fecaca",
  },
  errorText: { color: "#b91c1c", fontSize: 13 },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
  row: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff" },
  rowName: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  rowMeta: { fontSize: 13, color: "#64748b", marginTop: 2 },
  empty: { padding: 32, alignItems: "center" },
  emptyText: { color: "#94a3b8" },
  emptyHint: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
});
