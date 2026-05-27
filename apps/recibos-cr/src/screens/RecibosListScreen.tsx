import { useEffect, useState } from "react";
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
 * Lista de recibos LOCALES (en SQLite). Los que sincronizaron se
 * eliminan del cache local — esta lista muestra:
 *   - Recibos creados hoy que aún no se sincronizaron (push_status=null)
 *   - Recibos rechazados (push_status='rejected')
 *
 * Para ver el histórico de recibos del server, eventualmente sumamos un
 * tab/view "Sincronizados" con un pull dedicado.
 */
export function RecibosListScreen({
  onNew,
  onBack,
}: Readonly<{
  onNew: () => void;
  onBack: () => void;
}>) {
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

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } catch (e: any) {
      console.warn("sync failed", e?.message);
    } finally {
      setSyncing(false);
    }
  };

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
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Productores</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Recibos</Text>
          <Text style={styles.headerSubtitle}>
            {pending} pendientes
            {rejected > 0 && ` • ${rejected} rechazados`}
          </Text>
        </View>
        <TouchableOpacity onPress={onSync} style={styles.syncBtn}>
          <Text style={styles.syncText}>{syncing ? "..." : "Sync"}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={recibos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 80 }}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={onSync} tintColor="#3b82f6" />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No hay recibos pendientes</Text>
            <Text style={styles.emptyHint}>
              Toca "Nuevo" para crear uno.
            </Text>
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

      <TouchableOpacity style={styles.fab} onPress={onNew}>
        <Text style={styles.fabText}>+ Nuevo</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
  },
  backBtn: { padding: 6 },
  backText: { color: "#cbd5e1", fontSize: 14 },
  headerTitle: { color: "#f1f5f9", fontSize: 18, fontWeight: "700" },
  headerSubtitle: { color: "#94a3b8", fontSize: 11, marginTop: 2 },
  syncBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#475569",
    borderRadius: 6,
  },
  syncText: { color: "#e2e8f0", fontSize: 13 },
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
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#1e293b",
    borderRadius: 6,
  },
  printText: { color: "#f1f5f9", fontSize: 12, fontWeight: "600" },
  empty: { padding: 48, alignItems: "center" },
  emptyText: { color: "#94a3b8", fontSize: 14 },
  emptyHint: { color: "#cbd5e1", fontSize: 12, marginTop: 6 },
  fab: {
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 32,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
