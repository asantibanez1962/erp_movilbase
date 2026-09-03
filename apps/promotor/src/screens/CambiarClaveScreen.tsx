import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore, AuthError } from "@erp/shared-api";
import { cliente } from "../branding";

/**
 * Cambio de clave forzado, cuando el servidor avisa que vencio.
 *
 * POR QUE EXISTE
 * --------------
 * El BE evalua el vencimiento en el login Y en el refresh, pero emite la sesion
 * igual y delega en el cliente forzar el cambio ("El cliente debe forzar
 * change", AuthService). La web ya lo hace con un modal bloqueante; el movil no
 * lo hacia, asi que en el telefono la politica simplemente NO SE APLICABA: el
 * promotor entraba, trabajaba, y nadie se enteraba de que su clave estaba
 * vencida. Sin error, sin aviso.
 *
 * CUANDO APARECE
 * --------------
 * No apenas vence: recien cuando no queda trabajo POR ENVIAR. Ver la nota en
 * App.tsx — perder una jornada de campo es peor que una clave vencida un dia
 * mas.
 *
 * LA SALIDA
 * ---------
 * Cambiar la clave, o cerrar sesion. No hay tercera. Si hubiera un "despues",
 * seria siempre despues.
 */

/**
 * La politica REAL vive en el servidor (Security:Password:*) y es configurable,
 * asi que esto es una guia, no la autoridad: el 422 con su code sigue mandando.
 * Se muestra igual porque la alternativa es que el promotor pruebe claves a
 * ciegas contra un error seco, parado en una finca.
 */
const REGLAS: { texto: string; cumple: (s: string) => boolean }[] = [
  { texto: "Al menos 8 caracteres", cumple: (s) => s.length >= 8 },
  { texto: "Una mayúscula", cumple: (s) => /[A-ZÁÉÍÓÚÑ]/.test(s) },
  { texto: "Una minúscula", cumple: (s) => /[a-záéíóúñ]/.test(s) },
  { texto: "Un número", cumple: (s) => /\d/.test(s) },
  { texto: "Un símbolo", cumple: (s) => /[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(s) },
];

export function CambiarClaveScreen() {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetir, setRepetir] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cambiarClave = useAuthStore((s) => s.cambiarClave);
  const logout = useAuthStore((s) => s.logout);

  const coinciden = nueva.length > 0 && nueva === repetir;
  const cumpleTodo = REGLAS.every((r) => r.cumple(nueva));
  const puedeEnviar = actual.length > 0 && cumpleTodo && coinciden && !loading;

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await cambiarClave(actual, nueva);
      // No se navega ni se re-loguea: al bajar `passwordExpired` el gate de
      // App.tsx deja de montar esta pantalla y el promotor vuelve a lo suyo,
      // con la misma sesion.
    } catch (e) {
      if (e instanceof AuthError) {
        setError(traducirError(e.code, e.message));
      } else {
        setError("No se pudo conectar. Verificá la red e intentá de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  const salir = () => {
    Alert.alert(
      "Cerrar sesión",
      "Vas a salir sin cambiar la clave. La próxima vez que entres te la vamos a pedir de nuevo.",
      [
        { text: "Volver", style: "cancel" },
        { text: "Cerrar sesión", style: "destructive", onPress: () => void logout() },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>Tu clave venció</Text>
          <Text style={styles.subtitle}>
            Ya enviaste todo tu trabajo. Para seguir usando la app, definí una clave nueva.
          </Text>

          <Text style={styles.label}>Clave actual</Text>
          <TextInput
            style={styles.input}
            value={actual}
            onChangeText={setActual}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
          />

          <Text style={styles.label}>Clave nueva</Text>
          <TextInput
            style={styles.input}
            value={nueva}
            onChangeText={setNueva}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
          />

          <View style={styles.reglas}>
            {REGLAS.map((r) => {
              const ok = r.cumple(nueva);
              return (
                <Text key={r.texto} style={[styles.regla, ok && styles.reglaOk]}>
                  {ok ? "✓" : "•"} {r.texto}
                </Text>
              );
            })}
          </View>

          <Text style={styles.label}>Repetir clave nueva</Text>
          <TextInput
            style={[
              styles.input,
              repetir.length > 0 && !coinciden && styles.inputMal,
            ]}
            value={repetir}
            onChangeText={setRepetir}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
            placeholder="••••••••"
            placeholderTextColor="#94a3b8"
          />
          {repetir.length > 0 && !coinciden ? (
            <Text style={styles.aviso}>Las dos claves nuevas no son iguales.</Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, !puedeEnviar && styles.buttonDisabled]}
            onPress={submit}
            disabled={!puedeEnviar}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Cambiar clave</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={salir}
            disabled={loading}
            style={styles.enlaceSalir}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.enlaceSalirTexto}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * PASSWORD_TOO_SHORT llega como `PASSWORD_TOO_SHORT (min 8)` — el minimo viene
 * pegado dentro del code, porque del lado del BE se arma interpolando la
 * configuracion. Por eso se compara por PREFIJO y no por igualdad: un switch
 * exacto cae siempre al default y le muestra al promotor el code crudo.
 */
function traducirError(code: string, fallback?: string): string {
  if (code.startsWith("PASSWORD_TOO_SHORT")) return "La clave nueva es muy corta.";
  switch (code) {
    case "CURRENT_PASSWORD_INVALID":
      return "La clave actual no es correcta.";
    case "PASSWORD_SAME_AS_CURRENT":
      return "La clave nueva tiene que ser distinta de la actual.";
    case "PASSWORD_IN_HISTORY":
      return "Ya usaste esa clave antes. Elegí una que no hayas usado.";
    case "PASSWORD_EMPTY":
      return "Escribí una clave nueva.";
    case "PASSWORD_MISSING_UPPER":
      return "Falta una mayúscula.";
    case "PASSWORD_MISSING_LOWER":
      return "Falta una minúscula.";
    case "PASSWORD_MISSING_DIGIT":
      return "Falta un número.";
    case "PASSWORD_MISSING_SPECIAL":
      return "Falta un símbolo.";
    case "PASSWORD_NOT_SET":
      return "Tu cuenta no tiene clave configurada. Coordiná con el admin.";
    default:
      return fallback ?? `No se pudo cambiar la clave (${code}).`;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: cliente.chrome },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#f1f5f9", marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 12 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#cbd5e1",
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#0f172a",
    color: "#f1f5f9",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  inputMal: { borderColor: "#b91c1c" },
  reglas: { marginTop: 10, gap: 2 },
  regla: { fontSize: 13, color: "#94a3b8" },
  reglaOk: { color: "#4ade80" },
  aviso: { color: "#fca5a5", fontSize: 13, marginTop: 6 },
  error: { color: "#fca5a5", fontSize: 14, marginTop: 14 },
  button: {
    backgroundColor: "#3b82f6",
    borderRadius: 8,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  enlaceSalir: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  enlaceSalirTexto: { color: "#94a3b8", fontSize: 13 },
});
