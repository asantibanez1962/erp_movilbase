import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor, Recibo } from "@erp/shared-sync";
import { database } from "../lib/db";
import { config } from "../lib/config";

/**
 * Form para crear un recibo nuevo. Todo offline — guarda en WMDB local
 * con push_status=null. Próximo sync lo sube al BE.
 *
 * Campos del POC:
 *   - numero_recibo (texto libre, hasta que metamos reservation)
 *   - productor (picker de productores cacheados)
 *   - fecha (default hoy, editable)
 *   - cantidad (decimal)
 *   - precio (decimal)
 *
 * Validaciones mínimas: todos los campos requeridos, cantidad > 0, precio > 0.
 */
export function NewReciboScreen({ onDone }: { onDone: () => void }) {
  const [numeroRecibo, setNumeroRecibo] = useState("");
  const [productor, setProductor] = useState<Productor | null>(null);
  const [fecha, setFecha] = useState(isoToday());
  const [cantidad, setCantidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const total =
    parseFloat(cantidad || "0") * parseFloat(precio || "0");
  const isValid =
    numeroRecibo.trim().length > 0 &&
    productor !== null &&
    fecha.length > 0 &&
    parseFloat(cantidad) > 0 &&
    parseFloat(precio) > 0;

  const submit = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const collection = database.get<Recibo>("recibos");
      await database.write(async () => {
        await collection.create((r) => {
          r.numeroRecibo = numeroRecibo.trim();
          r.socioId = Number(productor!.id);
          r.fecha = fecha;
          r.cantidad = parseFloat(cantidad);
          r.precio = parseFloat(precio);
          r.compania = config.companyId;
          r.pushStatus = null;
          r.pushError = null;
        });
      });
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Error al guardar el recibo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onDone}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nuevo recibo</Text>
        <TouchableOpacity
          onPress={submit}
          disabled={!isValid || saving}
        >
          <Text style={[styles.saveText, (!isValid || saving) && styles.disabled]}>
            {saving ? "..." : "Guardar"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Número de recibo">
          <TextInput
            style={styles.input}
            value={numeroRecibo}
            onChangeText={setNumeroRecibo}
            placeholder="ej. 001234"
            placeholderTextColor="#cbd5e1"
            editable={!saving}
          />
        </Field>

        <Field label="Productor">
          <TouchableOpacity
            style={styles.pickerBtn}
            onPress={() => setPickerOpen(true)}
            disabled={saving}
          >
            <Text style={productor ? styles.pickerSelected : styles.pickerPlaceholder}>
              {productor ? productor.displayName : "Seleccionar productor..."}
            </Text>
          </TouchableOpacity>
        </Field>

        <Field label="Fecha">
          <TextInput
            style={styles.input}
            value={fecha}
            onChangeText={setFecha}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#cbd5e1"
            editable={!saving}
          />
        </Field>

        <View style={styles.row2}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Field label="Cantidad">
              <TextInput
                style={styles.input}
                value={cantidad}
                onChangeText={setCantidad}
                keyboardType="decimal-pad"
                placeholder="0.000"
                placeholderTextColor="#cbd5e1"
                editable={!saving}
              />
            </Field>
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Field label="Precio">
              <TextInput
                style={styles.input}
                value={precio}
                onChangeText={setPrecio}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#cbd5e1"
                editable={!saving}
              />
            </Field>
          </View>
        </View>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            ₡{isNaN(total) ? "0.00" : total.toFixed(2)}
          </Text>
        </View>

        {error && <Text style={styles.error}>⚠ {error}</Text>}
      </ScrollView>

      <ProductorPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(p) => {
          setProductor(p);
          setPickerOpen(false);
        }}
      />
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ProductorPicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (p: Productor) => void;
}) {
  const [items, setItems] = useState<Productor[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const sub = database
      .get<Productor>("productores")
      .query(Q.sortBy("nombre", Q.asc))
      .observe()
      .subscribe((rows) => {
        setItems(rows);
        setLoading(false);
      });
    return () => sub.unsubscribe();
  }, [visible]);

  const filtered = filter
    ? items.filter((p) =>
        p.displayName.toLowerCase().includes(filter.toLowerCase()) ||
        (p.identificacion ?? "").includes(filter)
      )
    : items;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Productor</Text>
          <View style={{ width: 60 }} />
        </View>

        <TextInput
          style={styles.searchInput}
          value={filter}
          onChangeText={setFilter}
          placeholder="Buscar por nombre o cédula..."
          placeholderTextColor="#94a3b8"
          autoFocus
        />

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color="#3b82f6" />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(p) => p.id}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => onSelect(item)}
              >
                <Text style={styles.pickerRowName}>{item.displayName}</Text>
                {item.identificacion && (
                  <Text style={styles.pickerRowMeta}>
                    Cédula: {item.identificacion}
                  </Text>
                )}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>Sin coincidencias</Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

function isoToday(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#0f172a",
  },
  cancelText: { color: "#cbd5e1", fontSize: 14 },
  saveText: { color: "#3b82f6", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  headerTitle: { color: "#f1f5f9", fontSize: 17, fontWeight: "700" },
  form: { flex: 1, padding: 16 },
  field: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#0f172a",
  },
  pickerBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerSelected: { fontSize: 16, color: "#0f172a" },
  pickerPlaceholder: { fontSize: 16, color: "#cbd5e1" },
  row2: { flexDirection: "row" },
  totalBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1e293b",
    padding: 16,
    borderRadius: 8,
    marginTop: 12,
  },
  totalLabel: { color: "#cbd5e1", fontSize: 14, fontWeight: "600" },
  totalValue: { color: "#f1f5f9", fontSize: 22, fontWeight: "700" },
  error: { color: "#b91c1c", fontSize: 13, marginTop: 12 },
  // Picker modal
  modalRoot: { flex: 1, backgroundColor: "#f8fafc" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: "#0f172a",
  },
  searchInput: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
  },
  separator: { height: 1, backgroundColor: "#e2e8f0" },
  pickerRow: { padding: 16, backgroundColor: "#fff" },
  pickerRowName: { fontSize: 15, fontWeight: "600", color: "#0f172a" },
  pickerRowMeta: { fontSize: 13, color: "#64748b", marginTop: 2 },
  empty: { textAlign: "center", padding: 32, color: "#94a3b8" },
});
