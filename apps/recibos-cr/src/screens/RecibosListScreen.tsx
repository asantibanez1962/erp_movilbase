import { useEffect, useState, useLayoutEffect, useCallback } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor, Recibo } from "@erp/shared-sync";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { printRecibo } from "../lib/print";

/**
 * Lista de recibos locales (pendientes / rechazados). Los que sincronizaron
 * se eliminan del cache local. Header lo provee el Stack — acá agregamos
 * un botón "Sync" en headerRight via setOptions.
 */
export function RecibosListScreen({ navigation }: { navigation: any }) {
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [productorById, setProductorById] = useState<Map<number, string>>(new Map());
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const sub = database
      .get<Recibo>("recibos")
      .query(Q.sortBy("sync_updated_at", Q.desc))
      .observe()
      .subscribe(setRecibos);
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    const sub = database
      .get<Productor>("productores")
      .query()
      .observe()
      .subscribe((rows) => {
        const map = new Map<number, string>();
        for (const p of rows) {
          map.set(Number(p.id), p.displayName);
        }
        setProductorById(map);
      });
    return () => sub.unsubscribe();
  }, []);

  const onSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } catch (e: any) {
      console.warn("sync failed", e?.message);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // Botón "Sync" en headerRight del Stack. useLayoutEffect para que
  // esté ANTES del primer paint (sino flickea).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={onSync} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>{syncing ? "..." : "Sync"}</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation, onSync, syncing]);

  const onPrint = async (recibo: Recibo) => {
    const productorName = productorById.get(recibo.socioId) ?? `Socio ${recibo.socioId}`;
    try {
      await printRecibo(recibo, productorName);
    } catch (e: any) {
      console.warn("print failed", e?.message);
    }
  };

  const pending = recibos.filter((r) => r.pushStatus !== "rejected").length;
  const rejected = recibos.filter((r) => r.pushStatus === "rejected").length;

  return (
    <View style={styles.root}>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {pending} pendientes
          {rejected > 0 && ` • ${rejected} rechazados`}
        </Text>
      </View>

      <FlatList
        data={recibos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={onSync} tintColor="#3b82f6" />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No hay recibos pendientes</Text>
            <Text style={styles.emptyHint}>Tap "+ Nuevo" para crear uno.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const productorName = productorById.get(item.socioId) ?? `Socio ${item.socioId}`;
          const isRejected = item.pushStatus === "rejected";
          return (
            <View style={[styles.row, isRejected && styles.rowRejected]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowNumero}>{item.numeroRecibo}</Text>
                <Text style={styles.rowTotal}>₡{item.total.toFixed(2)}</Text>
              </View>
              <Text style={styles.rowProductor}>{productorName}</Text>
              <Text style={styles.rowMeta}>
                {item.cantidad} × ₡{item.precio.toFixed(2)} • {item.fecha}
              </Text>
              {isRejected && item.pushError && (
                <Text style={styles.rowError}>⚠ {item.pushError}</Text>
              )}
              <TouchableOpacity onPress={() => onPrint(item)} style={styles.printBtn}>
                <Text style={styles.printText}>🖨 Imprimir</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate("NewRecibo")}
      >
        <Text style={styles.fabText}>+ Nuevo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  headerBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 4,
  },
  headerBtnText: {
    color: "#3b82f6",
    fontSize: 16,
    fontWeight: "600",
  },
  summary: {
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  summaryText: { color: "#475569", fontSize: 12 },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
  row: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff" },
  rowRejected: { backgroundColor: "#fef2f2" },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowNumero: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowTotal: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowProductor: { fontSize: 14, color: "#334155", marginTop: 2 },
  rowMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  rowError: { fontSize: 12, color: "#b91c1c", marginTop: 4 },
  printBtn: {
    alignSelf: "flex-end",
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#1e293b",
    borderRadius: 6,
  },
  printText: { color: "#f1f5f9", fontSize: 14, fontWeight: "600" },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  emptyHint: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 24,
    backgroundColor: "#3b82f6",
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 32,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  fabText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
