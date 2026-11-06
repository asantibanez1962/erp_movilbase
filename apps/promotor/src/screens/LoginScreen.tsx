import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore, AuthError } from "@erp/shared-api";
import { asegurarDuenoBase } from "../lib/duenoBase";
import { cliente } from "../branding";
import { ServidorScreen } from "./ServidorScreen";

export function LoginScreen() {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * La pantalla de servidor tiene que ser alcanzable SIN sesión.
   *
   * Vivía sólo en el drawer, que está detrás del login. Si a un beneficio le
   * compilamos una IP equivocada —y hoy las cinco son provisionales— el promotor no
   * puede entrar, y por lo tanto tampoco llegar a la pantalla que existe justamente
   * para corregirla. La única salida habría sido recompilar el APK y reinstalárselo,
   * que es lo que esa pantalla evita.
   *
   * Se muestra en lugar del formulario, sin navegador: acá todavía no hay ninguno
   * montado.
   */
  const [verServidor, setVerServidor] = useState(false);
  const login = useAuthStore((s) => s.login);

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      await login(usuario.trim(), password);

      // Si la base local era de OTRO promotor, se borra acá — antes de que se vea
      // una sola fila. Entrar con otro usuario es un cambio de alcance, y esos no
      // se arreglan sincronizando (ver lib/alcance.ts).
      const id = useAuthStore.getState().user?.id;
      if (id != null) await asegurarDuenoBase(id);
      // NO se sincroniza acá: el pull está scopeado por empresa y cosecha, y en
      // este punto el usuario todavía no las eligió. Antes se llamaba a syncNow()
      // y el BE respondía 400 MISSING_COMPANY. El primer sync lo dispara
      // ContextoScreen cuando ya hay sesión de trabajo.
    } catch (e) {
      if (e instanceof AuthError) {
        setError(translateAuthError(e.code, e.message));
      } else {
        setError("Error de conexión. Verificá la red e intentá de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (verServidor) {
    return (
      <View style={styles.root}>
        <ServidorScreen onVolver={() => setVerServidor(false)} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View style={styles.card}>
        {/* El logo del beneficio en la primera pantalla que se ve. Es también la
            confirmación de que se instaló el APK correcto: con cinco clientes sobre
            el mismo código, el nombre en el launcher es lo único que los distingue
            hasta acá. Sin PNG puesto, cae al nombre del cliente en texto. */}
        {cliente.logo ? (
          <Image
            source={cliente.logo}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={cliente.nombreLargo}
          />
        ) : (
          <Text style={styles.title}>{cliente.nombre}</Text>
        )}
        <Text style={styles.subtitle}>Visitas y solicitudes de crédito</Text>

        <Text style={styles.label}>Usuario</Text>
        <TextInput
          style={styles.input}
          value={usuario}
          onChangeText={setUsuario}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
          placeholder="usuario"
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={submit}
          disabled={loading || !usuario || !password}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Ingresar</Text>
          )}
        </TouchableOpacity>

        {/* Discreto: el 99% de las veces no se toca. Pero cuando la dirección del
            servidor está mal, es la única salida que no pasa por reinstalar el APK. */}
        <TouchableOpacity
          onPress={() => setVerServidor(true)}
          disabled={loading}
          style={styles.enlaceServidor}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.enlaceServidorTexto}>Configurar servidor</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function translateAuthError(code: string, fallback?: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS":
      return "Usuario o contraseña incorrectos.";
    case "ACCOUNT_LOCKED":
      return "Cuenta bloqueada por demasiados intentos. Esperá unos minutos.";
    case "PASSWORD_NOT_SET":
      return "Tu cuenta no tiene contraseña configurada. Coordiná con el admin.";
    case "TOKEN_EXPIRED":
      return "Tu sesión expiró. Ingresá de nuevo.";
    default:
      return fallback ?? `Error: ${code}`;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Sólo el fondo toma el color del cliente; la tarjeta, los campos y el botón
    // quedan como estaban, según se pidió.
    backgroundColor: cliente.chrome,
    justifyContent: "center",
    padding: 24,
  },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: "#f1f5f9", marginBottom: 4 },
  enlaceServidor: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  enlaceServidorTexto: { color: "#94a3b8", fontSize: 13 },
  /** Placa blanca: los logos no tienen transparencia (ver App.tsx drawerLogo). */
  logo: {
    width: "100%",
    height: 96,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    marginBottom: 12,
  },
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 24 },
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
  button: {
    backgroundColor: "#3b82f6",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#fca5a5", fontSize: 13, marginTop: 12 },
});
