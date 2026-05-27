import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { Productor } from "@erp/shared-types";
import { useAuthStore } from "@erp/shared-api";
import { getSyncClient } from "../lib/api";
import { config } from "../lib/config";

/**
 * POC version: pull all productores into memory on mount + pull-to-refresh.
 *
 * Cuando metamos WatermelonDB (Phase A2), esto cambia a:
 *   - useEffect dispara synchronize() en background.
 *   - data viene de WMDB observable (live updates si se sincroniza mid-screen).
 *   - offline = lo último que se pulleó queda visible.
 *
 * Por ahora data en useState — desaparece al cerrar el app. Suficiente
 * para validar el round-trip.
 */
export function ProductoresScreen() {
  const [data, setData] = useState<Productor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const fetchProductores = useCallback(async () => {
    setError(null);
    try {
      const sync = getSyncClient();
      const resp = await sync.pull("productores", {
        last_pulled_at: null,
        schema_version: config.schemaVersion,
      });
      const rows = (resp.changes.productores?.updated ?? []) as unknown as Productor[];
      setData(rows);
    } catch (e: any) {
      setError(e?.message ?? "Error al cargar productores");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProductores();
  }, [fetchProductores]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchProductores();
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
            {data.length} {data.length === 1 ? "registro" : "registros"} • Empresa {config.companyId}
          </Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {user && (
        <Text style={styles.userLine}>Sesión: {user.usuario}</Text>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠ {error}</Text>
        </View>
      )}

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          !error ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No hay productores en esta empresa.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowName}>
              {item.nombre ?? "(sin nombre)"}
            </Text>
            {item.identificacion && (
              <Text style={styles.rowMeta}>Cédula: {item.identificacion}</Text>
            )}
            {item.telefonos && (
              <Text style={styles.rowMeta}>Tel: {item.telefonos}</Text>
            )}
            {item.email && (
              <Text style={styles.rowMeta}>{item.email}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: "#64748b",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: "#f1f5f9",
    fontSize: 22,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: "#94a3b8",
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 6,
  },
  logoutText: {
    color: "#e2e8f0",
    fontSize: 13,
  },
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
  errorText: {
    color: "#b91c1c",
    fontSize: 13,
  },
  separator: {
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  rowName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  rowMeta: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 2,
  },
  empty: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    color: "#94a3b8",
  },
});
