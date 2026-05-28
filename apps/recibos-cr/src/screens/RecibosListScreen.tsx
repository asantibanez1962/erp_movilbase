import { useEffect, useMemo, useState, useLayoutEffect, useCallback } from "react";
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
 * Lista de recibos locales con filtro 3-vías:
 *   - Pendientes (default): null + rejected (lo no-cerrado, lo accionable)
 *   - Enviados: synced (consulta + reimpresión sin red)
 *   - Todos: todo lo que vive en cache
 *
 * Default arranca en Pendientes porque es lo operativo (lo que el user
 * tiene que mandar al backend). Enviados queda accesible para reimprimir
 * desde campo si el cliente perdió el ticket. La purga al boot mantiene
 * Enviados bounded a 30 días — más viejo se borra silencioso.
 *
 * Header Sync vive en headerRight del Stack (setOptions).
 */

type FilterMode = "pendientes" | "enviados" | "todos";

export function RecibosListScreen({ navigation }: { navigation: any }) {
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [productorById, setProductorById] = useState<Map<number, string>>(new Map());
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("pendientes");

  // Observamos TODA la collection — filtrar en JS es más simple que armar
  // queries por mode + observe múltiples. Volumen esperado <500 rows, no
  // hay riesgo perf en este target.
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

  // Counters globales (sobre todo el cache, no el filter activo) para
  // mostrar el badge en cada chip. El user ve "Pendientes 3 / Enviados 12"
  // sin tener que tappear cada filtro.
  const counts = useMemo(() => {
    let pendientes = 0;
    let enviados = 0;
    for (const r of recibos) {
      if (r.pushStatus === "synced") enviados++;
      else pendientes++; // null + 'rejected' caen acá (ambos son "abiertos")
    }
    return { pendientes, enviados, todos: recibos.length };
  }, [recibos]);

  // Filter aplicado a la lista visible.
  const visible = useMemo(() => {
    switch (filter) {
      case "pendientes":
        return recibos.filter((r) => r.pushStatus !== "synced");
      case "enviados":
        return recibos.filter((r) => r.pushStatus === "synced");
      case "todos":
      default:
        return recibos;
    }
  }, [recibos, filter]);

  // Rejected solo se cuenta dentro de pendientes para hint en el summary.
  const rejectedInPendientes = useMemo(
    () => recibos.filter((r) => r.pushStatus === "rejected").length,
    [recibos]
  );

  return (
    <View style={styles.root}>
      <FilterChips active={filter} counts={counts} onChange={setFilter} />

      {filter === "pendientes" && rejectedInPendientes > 0 && (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            ⚠ {rejectedInPendientes} rechazado(s) — revisar y reintentar
          </Text>
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={syncing} onRefresh={onSync} tintColor="#3b82f6" />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyLabelFor(filter)}</Text>
            {filter === "pendientes" && (
              <Text style={styles.emptyHint}>Tap "+ Nuevo" para crear uno.</Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const productorName = productorById.get(item.socioId) ?? `Socio ${item.socioId}`;
          const isRejected = item.pushStatus === "rejected";
          const isSynced = item.pushStatus === "synced";
          return (
            <View
              style={[
                styles.row,
                isRejected && styles.rowRejected,
                isSynced && styles.rowSynced,
              ]}
            >
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
              {isSynced && (
                <Text style={styles.rowSyncedLabel}>✓ Enviado</Text>
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

function emptyLabelFor(filter: FilterMode): string {
  switch (filter) {
    case "pendientes":
      return "No hay recibos pendientes";
    case "enviados":
      return "Sin recibos enviados (últimos 30 días)";
    case "todos":
    default:
      return "No hay recibos";
  }
}

// ─────────────────────────────────────────────────────────────
// Filter chips — segmento horizontal arriba de la lista.
// Text bumpeado a 15pt para legibilidad en usuarios mayores (default
// chips de RN ~13pt sentíamos chico).
// ─────────────────────────────────────────────────────────────
function FilterChips({
  active,
  counts,
  onChange,
}: Readonly<{
  active: FilterMode;
  counts: { pendientes: number; enviados: number; todos: number };
  onChange: (mode: FilterMode) => void;
}>) {
  return (
    <View style={chipStyles.bar}>
      <Chip
        label="Pendientes"
        count={counts.pendientes}
        active={active === "pendientes"}
        onPress={() => onChange("pendientes")}
      />
      <Chip
        label="Enviados"
        count={counts.enviados}
        active={active === "enviados"}
        onPress={() => onChange("enviados")}
      />
      <Chip
        label="Todos"
        count={counts.todos}
        active={active === "todos"}
        onPress={() => onChange("todos")}
      />
    </View>
  );
}

function Chip({
  label,
  count,
  active,
  onPress,
}: Readonly<{
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[chipStyles.chip, active && chipStyles.chipActive]}
    >
      <Text style={[chipStyles.chipText, active && chipStyles.chipTextActive]}>
        {label}
      </Text>
      <Text style={[chipStyles.chipCount, active && chipStyles.chipCountActive]}>
        {count}
      </Text>
    </TouchableOpacity>
  );
}

const chipStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 6,
  },
  chipActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  chipText: { fontSize: 15, fontWeight: "600", color: "#475569" },
  chipTextActive: { color: "#fff" },
  chipCount: {
    fontSize: 13,
    fontWeight: "700",
    color: "#94a3b8",
    backgroundColor: "#fff",
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden",
    minWidth: 22,
    textAlign: "center",
  },
  chipCountActive: {
    color: "#3b82f6",
    backgroundColor: "#fff",
  },
});

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
    backgroundColor: "#fef3c7",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  summaryText: { color: "#92400e", fontSize: 13, fontWeight: "600" },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
  row: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#fff" },
  rowRejected: { backgroundColor: "#fef2f2" },
  rowSynced: { backgroundColor: "#f0fdf4" },
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
  rowSyncedLabel: { fontSize: 12, color: "#15803d", fontWeight: "600", marginTop: 4 },
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
