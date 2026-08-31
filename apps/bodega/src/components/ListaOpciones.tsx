import React from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Medidas } from "../lib/pantalla";

/**
 * Lista para elegir UNA opción de muchas: ubicaciones, bodegas, empresas.
 *
 * POR QUE LISTA Y NO BOTONES. Los botones en rejilla se ven bien con seis
 * ubicaciones y se vuelven inmanejables con sesenta: la rejilla crece a lo
 * ancho y a lo largo, el operario tiene que barrer la pantalla con la vista
 * para encontrar un nombre, y en horizontal el alto no da para tantas filas.
 * Una lista de una columna se recorre con el pulgar y siempre se lee en el
 * mismo lugar.
 *
 * EL FILTRO APARECE SOLO CUANDO HACE FALTA. Con pocas opciones un campo de
 * texto es un estorbo —y un teclado que tapa media pantalla en horizontal—;
 * pasado el umbral, buscar a mano es peor. El filtro es "contiene", no
 * "empieza con": el operario recuerda "carril 50", no el prefijo del nombre.
 *
 * Las filas son altas a propósito (44dp de piso, como todo lo tocable de esta
 * app): quien la usa trae guantes.
 */

export interface Opcion {
  id: number;
  nombre: string;
}

interface Props<T extends Opcion> {
  m: Medidas;
  opciones: T[];
  /** id de la opción marcada, o null. */
  seleccionado: number | null;
  alElegir: (o: T) => void;
  /** Fila fija arriba, del tipo "Todas". Sin esto no hay opción de no filtrar. */
  encabezado?: { texto: string; activo: boolean; alTocar: () => void };
  /** A partir de cuántas opciones se muestra el filtro. */
  umbralFiltro?: number;
  vacio?: string;
}

export function ListaOpciones<T extends Opcion>(
  { m, opciones, seleccionado, alElegir, encabezado, umbralFiltro = 8, vacio }: Props<T>,
) {
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const [texto, setTexto] = React.useState("");

  const filtradas = React.useMemo(() => {
    const busca = texto.trim().toLowerCase();
    if (!busca) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(busca));
  }, [opciones, texto]);

  return (
    <View style={s.contenedor}>
      {opciones.length > umbralFiltro && (
        <TextInput
          style={s.filtro}
          value={texto}
          onChangeText={setTexto}
          placeholder="Filtrar…"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      )}

      <ScrollView style={s.scroll} keyboardShouldPersistTaps="handled">
        {encabezado && (
          <Fila s={s} texto={encabezado.texto} activo={encabezado.activo}
                alTocar={encabezado.alTocar} />
        )}
        {filtradas.map((o) => (
          <Fila key={o.id} s={s} texto={o.nombre} activo={seleccionado === o.id}
                alTocar={() => alElegir(o)} />
        ))}
        {filtradas.length === 0 && (
          <Text style={s.vacio}>
            {texto.trim() ? "Ninguna coincide con el filtro." : (vacio ?? "No hay opciones.")}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

function Fila(
  { s, texto, activo, alTocar }:
  { s: Estilos; texto: string; activo: boolean; alTocar: () => void },
) {
  return (
    <Pressable style={[s.fila, activo && s.filaActiva]} onPress={alTocar}>
      <Text style={[s.filaTexto, activo && s.filaTextoActivo]} numberOfLines={2}>{texto}</Text>
      {activo && <Text style={s.marca}>✓</Text>}
    </Pressable>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    contenedor: { flex: 1 },
    filtro: {
      height: m.t(44), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(12), fontSize: m.e(16), backgroundColor: "#fff",
      color: "#0f172a", marginBottom: m.e(6),
    },
    scroll: { flex: 1 },
    fila: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      minHeight: m.t(48), paddingHorizontal: m.e(12), paddingVertical: m.e(8),
      backgroundColor: "#fff",
      borderBottomWidth: 1, borderBottomColor: "#eef2f6",
    },
    filaActiva: { backgroundColor: "#3f8f2e" },
    filaTexto: { flexShrink: 1, fontSize: m.e(16), color: "#334155" },
    filaTextoActivo: { color: "#fff", fontWeight: "700" },
    marca: { color: "#fff", fontSize: m.e(17), fontWeight: "700", marginLeft: m.e(8) },
    vacio: { color: "#64748b", fontSize: m.e(14), padding: m.e(14), textAlign: "center" },
  });
}
