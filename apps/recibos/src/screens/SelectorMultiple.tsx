import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { cliente } from "../branding";
import { colores, estilos } from "./estilos";
import type { OpcionPicker } from "./Picker";

/**
 * Selector de VARIOS a la vez, con buscador.
 *
 * Hermano de PickerModal, que elige uno solo y cierra al tocar. Acá no puede cerrar en el
 * primer toque: se marcan varios y se confirma. Un camión pasa por 1 a 17 recibidores, y
 * con el selector simple habría que abrirlo y cerrarlo una vez por cada uno.
 *
 * Los ya elegidos suben al principio de la lista. Sin eso, al reabrirlo para agregar el
 * quinto hay que buscar entre 119 recibidores cuáles eran los cuatro que ya iban.
 */
export function SelectorMultiple({
  visible,
  titulo,
  opciones,
  elegidos,
  onListo,
  onCerrar,
}: Readonly<{
  visible: boolean;
  titulo: string;
  opciones: OpcionPicker[];
  elegidos: string[];
  onListo: (valores: string[]) => void;
  onCerrar: () => void;
}>) {
  const [busqueda, setBusqueda] = useState("");
  const [marcados, setMarcados] = useState<string[]>(elegidos);

  // Al reabrirlo se parte de lo que ya había: el estado interno no puede quedarse con la
  // selección de la vez anterior si afuera cambió (por ejemplo, al quitar una ficha).
  useEffect(() => {
    if (visible) {
      setMarcados(elegidos);
      setBusqueda("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    const filtradas = t
      ? opciones.filter((o) =>
          (o.busqueda ?? `${o.titulo} ${o.subtitulo ?? ""}`).toLowerCase().includes(t)
        )
      : opciones;
    // Los marcados primero, conservando el orden dentro de cada grupo.
    return [
      ...filtradas.filter((o) => marcados.includes(o.valor)),
      ...filtradas.filter((o) => !marcados.includes(o.valor)),
    ];
  }, [opciones, busqueda, marcados]);

  const alternar = (valor: string) =>
    setMarcados((xs) => (xs.includes(valor) ? xs.filter((x) => x !== valor) : [...xs, valor]));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <View style={estilos.root}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: cliente.chrome,
            paddingHorizontal: 12,
            paddingVertical: 14,
            gap: 14,
          }}
        >
          <TouchableOpacity onPress={onCerrar} hitSlop={12}>
            <Text style={{ color: colores.textoClaro, fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
          <Text
            style={{ color: colores.textoClaro, fontSize: 17, fontWeight: "700", flex: 1 }}
          >
            {titulo}
          </Text>
          <TouchableOpacity onPress={() => onListo(marcados)} hitSlop={12}>
            <Text style={{ color: colores.textoClaro, fontSize: 15, fontWeight: "700" }}>
              Listo{marcados.length > 0 ? ` (${marcados.length})` : ""}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={estilos.buscador}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar..."
          placeholderTextColor={colores.textoTenue}
          autoCorrect={false}
        />

        <FlatList
          data={visibles}
          keyExtractor={(o) => o.valor}
          renderItem={({ item }) => {
            const marcado = marcados.includes(item.valor);
            return (
              <TouchableOpacity
                onPress={() => alternar(item.valor)}
                style={[
                  estilos.fila,
                  { flexDirection: "row", alignItems: "center", gap: 12 },
                ]}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    borderWidth: 2,
                    borderColor: marcado ? cliente.chrome : colores.borde,
                    backgroundColor: marcado ? cliente.chrome : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {marcado ? (
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 14,
                        fontWeight: "900",
                        lineHeight: 16,
                      }}
                    >
                      ✓
                    </Text>
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={estilos.filaTitulo}>{item.titulo}</Text>
                  {item.subtitulo ? (
                    <Text style={estilos.filaSubtitulo}>{item.subtitulo}</Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
}
