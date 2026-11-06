import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore, AuthError } from "@erp/shared-api";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { VERDE } from "../branding";
import { useSesion } from "../lib/sesion";

/**
 * Cambio de clave forzado, cuando el servidor avisa que vencio.
 *
 * El BE evalua el vencimiento en el login pero emite la sesion igual y delega en
 * el cliente forzar el cambio. Sin esta pantalla la politica NO SE APLICA en el
 * aparato: el operario entra, trabaja, y nadie se entera.
 *
 * CUANDO APARECE (ver la puerta en App.tsx)
 * -----------------------------------------
 * Solo con la bodega ya elegida, sin conteos ni OT sin enviar, y habiendo
 * alcanzado el servidor. Perder una toma fisica a medio contar es peor que una
 * clave vencida un dia mas, y exigirsela sin red seria encerrarlo en planta.
 *
 * Horizontal como el resto de la app: el formulario va centrado y con ancho tope
 * —un campo de clave de 1000dp no ayuda a nadie— y todo escala por alto.
 */

const REGLAS: { texto: string; cumple: (s: string) => boolean }[] = [
  { texto: "8 caracteres o más", cumple: (s) => s.length >= 8 },
  { texto: "Una mayúscula", cumple: (s) => /[A-ZÁÉÍÓÚÑ]/.test(s) },
  { texto: "Una minúscula", cumple: (s) => /[a-záéíóúñ]/.test(s) },
  { texto: "Un número", cumple: (s) => /\d/.test(s) },
  { texto: "Un símbolo", cumple: (s) => /[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(s) },
];

export function CambiarClaveScreen() {
  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);

  const [actual, setActual] = React.useState("");
  const [nueva, setNueva] = React.useState("");
  const [repetir, setRepetir] = React.useState("");
  const [cargando, setCargando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const cambiarClave = useAuthStore((st) => st.cambiarClave);

  const coinciden = nueva.length > 0 && nueva === repetir;
  const cumpleTodo = REGLAS.every((r) => r.cumple(nueva));
  const puede = actual.length > 0 && cumpleTodo && coinciden && !cargando;

  async function guardar() {
    setError(null);
    setCargando(true);
    try {
      await cambiarClave(actual, nueva);
      // No se navega: al bajar `passwordExpired` la puerta deja de montar esta
      // pantalla y el operario vuelve al menú, con la misma sesión.
    } catch (e) {
      setError(
        e instanceof AuthError
          ? traducir(e.code, e.message)
          : "No se pudo conectar. Revise la red e intente de nuevo."
      );
    } finally {
      setCargando(false);
    }
  }

  function salir() {
    Alert.alert(
      "Cerrar sesión",
      "Sale sin cambiar la clave. La próxima vez que entre se la vamos a pedir de nuevo.",
      [
        { text: "Volver", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: () => void useSesion.getState().cerrar(),
        },
      ]
    );
  }

  return (
    <ScrollView contentContainerStyle={s.raiz} keyboardShouldPersistTaps="handled">
      <View style={s.panel}>
        <Text style={s.titulo}>Su clave venció</Text>
        <Text style={s.bajada}>
          No tiene trabajo sin enviar. Defina una clave nueva para seguir.
        </Text>

        <Campo etiqueta="Clave actual" valor={actual} onChange={setActual} s={s} editable={!cargando} />
        <Campo etiqueta="Clave nueva" valor={nueva} onChange={setNueva} s={s} editable={!cargando} />

        <View style={s.reglas}>
          {REGLAS.map((r) => {
            const ok = r.cumple(nueva);
            return (
              <Text key={r.texto} style={[s.regla, ok && s.reglaOk]}>
                {ok ? "✓" : "•"} {r.texto}
              </Text>
            );
          })}
        </View>

        <Campo
          etiqueta="Repetir clave nueva"
          valor={repetir}
          onChange={setRepetir}
          s={s}
          editable={!cargando}
          mal={repetir.length > 0 && !coinciden}
        />
        {repetir.length > 0 && !coinciden ? (
          <Text style={s.aviso}>Las dos claves nuevas no son iguales.</Text>
        ) : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[s.boton, !puede && s.botonApagado]}
          onPress={guardar}
          disabled={!puede}
        >
          {cargando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.botonTexto}>Cambiar clave</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={salir} disabled={cargando}>
          <Text style={s.enlace}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
  s,
  editable,
  mal,
}: Readonly<{
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  s: ReturnType<typeof crearEstilos>;
  editable: boolean;
  mal?: boolean;
}>) {
  return (
    <>
      <Text style={s.etiqueta}>{etiqueta}</Text>
      <TextInput
        style={[s.input, mal && s.inputMal]}
        value={valor}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={editable}
        /* En horizontal Android abre un editor a pantalla completa que tapa la
           app entera. Mismo motivo que en el resto de las pantallas. */
        disableFullscreenUI
      />
    </>
  );
}

/**
 * PASSWORD_TOO_SHORT llega como `PASSWORD_TOO_SHORT (min 8)`: el minimo viene
 * interpolado DENTRO del code. Por eso se compara por prefijo — un switch exacto
 * cae al default y le muestra el code crudo al operario.
 */
function traducir(code: string, fallback?: string): string {
  if (code.startsWith("PASSWORD_TOO_SHORT")) return "La clave nueva es muy corta.";
  switch (code) {
    case "CURRENT_PASSWORD_INVALID": return "La clave actual no es correcta.";
    case "PASSWORD_SAME_AS_CURRENT": return "La clave nueva tiene que ser distinta de la actual.";
    case "PASSWORD_IN_HISTORY": return "Ya usó esa clave antes. Elija una que no haya usado.";
    case "PASSWORD_EMPTY": return "Escriba una clave nueva.";
    case "PASSWORD_MISSING_UPPER": return "Falta una mayúscula.";
    case "PASSWORD_MISSING_LOWER": return "Falta una minúscula.";
    case "PASSWORD_MISSING_DIGIT": return "Falta un número.";
    case "PASSWORD_MISSING_SPECIAL": return "Falta un símbolo.";
    case "PASSWORD_NOT_SET": return "Su cuenta no tiene clave configurada. Avise a la oficina.";
    default: return fallback ?? `No se pudo cambiar la clave (${code}).`;
  }
}

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    raiz: {
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      padding: m.e(16),
      backgroundColor: "#f1f5f9",
    },
    panel: {
      width: anchoPanel(m),
      backgroundColor: "#fff",
      borderRadius: 12,
      padding: m.e(20),
    },
    titulo: { fontSize: m.e(22), fontWeight: "700", color: "#0f172a" },
    bajada: { fontSize: m.e(14), color: "#64748b", marginTop: m.e(4), marginBottom: m.e(8) },
    etiqueta: {
      fontSize: m.e(13), fontWeight: "600", color: "#334155",
      marginTop: m.e(12), marginBottom: m.e(6),
    },
    input: {
      height: m.t(48), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(12), fontSize: m.e(16), color: "#0f172a",
      backgroundColor: "#f8fafc",
    },
    inputMal: { borderColor: "#b91c1c" },
    reglas: { marginTop: m.e(10), gap: m.e(2) },
    regla: { fontSize: m.e(13), color: "#64748b" },
    reglaOk: { color: "#15803d" },
    aviso: { color: "#b91c1c", fontSize: m.e(13), marginTop: m.e(6) },
    error: { color: "#b91c1c", fontSize: m.e(14), marginTop: m.e(12) },
    boton: {
      height: m.t(52), borderRadius: 10, backgroundColor: VERDE,
      marginTop: m.e(18), alignItems: "center", justifyContent: "center",
    },
    botonApagado: { opacity: 0.5 },
    botonTexto: { color: "#fff", fontSize: m.e(17), fontWeight: "700" },
    enlace: { color: VERDE, textAlign: "center", marginTop: m.e(14), fontSize: m.e(14) },
  });
}
