import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { colores, estilos } from "./estilos";

export interface OpcionPicker {
  valor: string;
  titulo: string;
  subtitulo?: string;
  /** Texto contra el que filtra el buscador. Default: titulo + subtitulo. */
  busqueda?: string;
}

/**
 * Selector modal con buscador. Se usa para productor, tipo de visita, finca y
 * solicitud — todas listas que en campo pueden tener miles de filas
 * (12 825 productores), así que el buscador no es opcional.
 *
 * Es modal y no un <Picker> nativo a propósito: el nativo de Android no filtra
 * y obliga a scrollear miles de items con el pulgar.
 */
export function PickerModal({
  visible,
  titulo,
  opciones,
  conBuscador = true,
  onSeleccionar,
  onCerrar,
}: Readonly<{
  visible: boolean;
  titulo: string;
  opciones: OpcionPicker[];
  /**
   * El buscador viene prendido porque la mayoría de estas listas son enormes.
   *
   * Se apaga para las cortas —las cosechas son ocho— donde estorba más de lo que ayuda:
   * tiene `autoFocus`, así que abre el teclado y tapa media pantalla para elegir entre
   * ocho renglones que ya se ven completos.
   */
  conBuscador?: boolean;
  onSeleccionar: (valor: string) => void;
  onCerrar: () => void;
}>) {
  const [busqueda, setBusqueda] = useState("");

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return opciones;
    return opciones.filter((o) =>
      (o.busqueda ?? `${o.titulo} ${o.subtitulo ?? ""}`).toLowerCase().includes(t)
    );
  }, [opciones, busqueda]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <View style={estilos.root}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colores.fondoOscuro,
            paddingHorizontal: 12,
            paddingVertical: 14,
          }}
        >
          <TouchableOpacity
            onPress={onCerrar}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ color: colores.textoClaro, fontSize: 22 }}>✕</Text>
          </TouchableOpacity>
          <Text
            style={{
              color: colores.textoClaro,
              fontSize: 17,
              fontWeight: "700",
              marginLeft: 16,
            }}
          >
            {titulo}
          </Text>
        </View>

        {conBuscador ? (
          <TextInput
            style={estilos.buscador}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar..."
            placeholderTextColor={colores.textoTenue}
            autoCorrect={false}
            autoFocus
          />
        ) : null}

        <FlatList
          data={visibles}
          keyExtractor={(o) => o.valor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>Sin coincidencias.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={estilos.fila}
              onPress={() => {
                onSeleccionar(item.valor);
                setBusqueda("");
                onCerrar();
              }}
            >
              <Text style={estilos.filaTitulo}>{item.titulo}</Text>
              {item.subtitulo ? (
                <Text style={estilos.filaSubtitulo}>{item.subtitulo}</Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}
