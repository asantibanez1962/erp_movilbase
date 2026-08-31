import React from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { useMedidas, Medidas } from "../lib/pantalla";
import type { Props } from "../lib/rutas";
import { VERDE } from "../branding";
import {
  guardarUrlServidor, hayOverride, restaurarUrlServidor,
  urlCompilada, urlServidor,
} from "../lib/servidor";

/**
 * Dirección del backend del beneficio.
 *
 * Está a mano y no escondida en el build porque cada cliente corre su servidor
 * en su red: si le cambian la IP, sin esta pantalla habría que recompilar el
 * APK y reinstalarlo tableta por tableta.
 *
 * A DIFERENCIA DE LA APP DEL PROMOTOR, acá cambiar de servidor no borra nada:
 * esta app no guarda datos de negocio en el aparato. Todo se pide al momento,
 * así que apuntar a otra base simplemente muestra los datos de esa base.
 *
 * El formulario va centrado y con ancho tope: en horizontal, un campo de texto
 * de 1000dp de ancho para escribir una IP no ayuda a nadie.
 */
export function ServidorScreen({ navigation }: Readonly<Props<"Servidor">>) {
  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);

  const [texto, setTexto] = React.useState(urlServidor());
  const propia = hayOverride();

  async function guardar() {
    try {
      const url = await guardarUrlServidor(texto);
      setTexto(url);
      Alert.alert("Servidor guardado", url, [
        { text: "Listo", onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      Alert.alert("Dirección inválida", (e as Error).message);
    }
  }

  async function restaurar() {
    setTexto(await restaurarUrlServidor());
    Alert.alert("Restaurado", "Se volvió a la dirección del instalador.");
  }

  return (
    <View style={s.pantalla}>
      <View style={s.tarjeta}>
        <Text style={s.etiqueta}>Dirección del servidor</Text>
        <TextInput
          style={s.input}
          value={texto}
          onChangeText={setTexto}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          disableFullscreenUI
          placeholder="192.168.1.50:5249"
          placeholderTextColor="#94a3b8"
          returnKeyType="done"
          onSubmitEditing={() => void guardar()}
        />
        <Text style={s.ayuda}>
          Si no lleva http:// se asume http. Los servidores son locales y casi
          nunca tienen certificado.
        </Text>

        <Pressable style={s.btn} onPress={() => void guardar()}>
          <Text style={s.btnTexto}>Guardar</Text>
        </Pressable>

        {propia && (
          <Pressable onPress={() => void restaurar()}>
            <Text style={s.enlace}>Volver a la del instalador ({urlCompilada()})</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, alignItems: "center", backgroundColor: "#f8fafc", padding: m.e(16) },
    tarjeta: { width: "100%", maxWidth: 520 },
    etiqueta: { fontSize: m.e(14), color: "#475569", marginBottom: m.e(6) },
    input: {
      height: m.t(50), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(14), fontSize: m.e(17), backgroundColor: "#fff", color: "#0f172a",
    },
    ayuda: { fontSize: m.e(13), color: "#64748b", marginTop: m.e(8), lineHeight: m.e(18) },
    btn: {
      height: m.t(52), borderRadius: 10, backgroundColor: VERDE, marginTop: m.e(16),
      alignItems: "center", justifyContent: "center",
    },
    btnTexto: { color: "#fff", fontSize: m.e(17), fontWeight: "700" },
    enlace: { color: VERDE, textAlign: "center", marginTop: m.e(14), fontSize: m.e(14) },
  });
}
