import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { colores } from "../estilos";

/**
 * Campos de formulario. Los tres comparten look para que un form se lea como
 * una sola cosa; el de selección imita al de texto pero abre un PickerModal.
 */

export function CampoTexto({
  etiqueta,
  valor,
  onCambiar,
  placeholder,
  multilinea,
  requerido,
}: Readonly<{
  etiqueta: string;
  valor: string;
  onCambiar: (v: string) => void;
  placeholder?: string;
  multilinea?: boolean;
  requerido?: boolean;
}>) {
  return (
    <View style={s.grupo}>
      <Text style={s.etiqueta}>
        {etiqueta}
        {requerido ? " *" : ""}
      </Text>
      <TextInput
        style={[s.input, multilinea && s.inputMulti]}
        value={valor}
        onChangeText={onCambiar}
        placeholder={placeholder}
        placeholderTextColor={colores.textoTenue}
        multiline={multilinea}
        numberOfLines={multilinea ? 4 : 1}
        textAlignVertical={multilinea ? "top" : "center"}
      />
    </View>
  );
}

/**
 * Numérico. Guarda el texto crudo mientras se escribe (no el número) para no
 * pelearse con el usuario a mitad de tipeo: parsear en cada tecla borra el
 * separador decimal apenas se escribe y hace imposible tipear "1.5".
 *
 * `selectTextOnFocus`: los numéricos arrancan en 0 (así el promotor ve que el
 * campo es un monto y no un texto, y no queda ambiguo entre "cero" y "sin dato").
 * Pero un 0 precargado obliga a borrarlo antes de tipear, y con el pulgar sobre un
 * campo chico eso produce "05000". Seleccionando todo al enfocar, la primera tecla
 * lo reemplaza.
 */
export function CampoNumero({
  etiqueta,
  valor,
  onCambiar,
  placeholder,
}: Readonly<{
  etiqueta: string;
  valor: string;
  onCambiar: (v: string) => void;
  placeholder?: string;
}>) {
  return (
    <View style={s.grupo}>
      <Text style={s.etiqueta}>{etiqueta}</Text>
      <TextInput
        style={s.input}
        value={valor}
        onChangeText={(t) => onCambiar(t.replace(/[^0-9.,]/g, ""))}
        placeholder={placeholder ?? "0"}
        placeholderTextColor={colores.textoTenue}
        keyboardType="decimal-pad"
        selectTextOnFocus
      />
    </View>
  );
}

export function CampoSeleccion({
  etiqueta,
  valorMostrado,
  onAbrir,
  requerido,
  deshabilitado,
}: Readonly<{
  etiqueta: string;
  valorMostrado: string | null;
  onAbrir: () => void;
  requerido?: boolean;
  deshabilitado?: boolean;
}>) {
  return (
    <View style={s.grupo}>
      <Text style={s.etiqueta}>
        {etiqueta}
        {requerido ? " *" : ""}
      </Text>
      <TouchableOpacity
        style={[s.input, s.seleccion, deshabilitado && s.deshabilitado]}
        onPress={onAbrir}
        disabled={deshabilitado}
      >
        <Text
          style={{
            color: valorMostrado ? colores.texto : colores.textoTenue,
            fontSize: 16,
            flexShrink: 1,
          }}
          numberOfLines={1}
        >
          {valorMostrado ?? "Seleccionar..."}
        </Text>
        <Text style={{ color: colores.textoTenue, fontSize: 14 }}>▾</Text>
      </TouchableOpacity>
    </View>
  );
}

export function BotonPrimario({
  texto,
  onPress,
  deshabilitado,
}: Readonly<{ texto: string; onPress: () => void; deshabilitado?: boolean }>) {
  return (
    <TouchableOpacity
      style={[s.boton, deshabilitado && s.botonDeshabilitado]}
      onPress={onPress}
      disabled={deshabilitado}
    >
      <Text style={s.botonTexto}>{texto}</Text>
    </TouchableOpacity>
  );
}

/** Convierte lo tipeado a número. Acepta coma o punto como separador decimal. */
export function aNumero(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

const s = StyleSheet.create({
  grupo: { paddingHorizontal: 16, paddingTop: 14 },
  etiqueta: {
    fontSize: 13,
    fontWeight: "600",
    color: colores.textoTenue,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colores.texto,
    minHeight: 48,
  },
  inputMulti: { minHeight: 96 },
  seleccion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  deshabilitado: { opacity: 0.5 },
  boton: {
    backgroundColor: colores.primario,
    borderRadius: 8,
    paddingVertical: 15,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 28,
    minHeight: 48,
    justifyContent: "center",
  },
  botonDeshabilitado: { opacity: 0.45 },
  botonTexto: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
