import React from "react";
import { View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { useMedidas, Medidas } from "../lib/pantalla";
import { borrarTodoLocal, pendientesLocales } from "../lib/localData";
import type { Props } from "../lib/rutas";
import { VERDE } from "../branding";
import {
  guardarUrlServidor, hayOverride, normalizarUrl, restaurarUrlServidor,
  urlCompilada, urlServidor,
} from "../lib/servidor";

/**
 * Dirección del backend del beneficio.
 *
 * Está a mano y no escondida en el build porque cada cliente corre su servidor
 * en su red: si le cambian la IP, sin esta pantalla habría que recompilar el
 * APK y reinstalarlo tableta por tableta.
 *
 * ⚠ CAMBIAR DE SERVIDOR BORRA LO QUE HAY EN EL APARATO. La toma física y las
 * OT se guardan en archivos locales indexados por id de bodega, y con ids de
 * partidas y de OT adentro. Esos ids pertenecen a UNA base: apuntar la app a
 * otra los deja referenciando filas que allá son otra cosa, o que no existen.
 * Enviarlos escribiría en el documento equivocado, y el servidor no tendría
 * cómo notarlo — los ids serían válidos.
 *
 * Por eso se avisa cuánto trabajo sin enviar se va a perder y se pide
 * confirmación. Es la misma razón por la que la app del promotor rebaja su base
 * al cambiar de servidor.
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
    let url: string;
    try {
      url = normalizarUrl(texto);
    } catch (e: unknown) {
      Alert.alert("Dirección inválida", (e as Error).message);
      return;
    }

    // Apuntar a la MISMA dirección no es un cambio de base: no hay nada que
    // borrar ni por qué asustar a nadie.
    if (url === urlServidor()) {
      await aplicar(url, false);
      return;
    }

    const p = await pendientesLocales();
    const detalle = p.total === 0
      ? "Se borra la toma física y las OT que estén bajadas en este aparato. No hay nada sin enviar."
      : `Hay ${p.conteos} conteo(s) y ${p.ots} OT sin enviar. SE PIERDEN: pertenecen a la base del servidor anterior y no se pueden mandar a otra.`;

    Alert.alert("Cambiar de servidor", detalle, [
      { text: "Cancelar", style: "cancel" },
      {
        text: p.total === 0 ? "Cambiar" : "Cambiar y perderlos",
        style: "destructive",
        onPress: () => { void aplicar(url, true); },
      },
    ]);
  }

  async function aplicar(url: string, limpiar: boolean) {
    try {
      const guardada = await guardarUrlServidor(url);
      if (limpiar) await borrarTodoLocal();
      setTexto(guardada);
      Alert.alert("Servidor guardado", guardada, [
        { text: "Listo", onPress: () => navigation.goBack() },
      ]);
    } catch (e: unknown) {
      Alert.alert("No se pudo guardar", (e as Error).message);
    }
  }

  async function restaurar() {
    // Volver a la del instalador es un cambio de servidor como cualquier otro.
    const destino = urlCompilada();
    if (destino === urlServidor()) { setTexto(destino); return; }

    const p = await pendientesLocales();
    Alert.alert(
      "Volver a la dirección del instalador",
      p.total === 0
        ? `Se apunta a ${destino} y se borra lo bajado en este aparato.`
        : `Hay ${p.conteos} conteo(s) y ${p.ots} OT sin enviar. SE PIERDEN: son de la base del servidor actual.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: p.total === 0 ? "Volver" : "Volver y perderlos",
          style: "destructive",
          onPress: () => {
            void restaurarUrlServidor()
              .then(() => borrarTodoLocal())
              .then(() => { setTexto(destino); });
          },
        },
      ],
    );
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
        <Text style={s.aviso}>
          Cambiar de servidor borra la toma física y las OT que estén en este
          aparato: pertenecen a la base del servidor anterior.
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
    aviso: { fontSize: m.e(13), color: "#b45309", marginTop: m.e(8), lineHeight: m.e(18) },
    btn: {
      height: m.t(52), borderRadius: 10, backgroundColor: VERDE, marginTop: m.e(16),
      alignItems: "center", justifyContent: "center",
    },
    btnTexto: { color: "#fff", fontSize: m.e(17), fontWeight: "700" },
    enlace: { color: VERDE, textAlign: "center", marginTop: m.e(14), fontSize: m.e(14) },
  });
}
