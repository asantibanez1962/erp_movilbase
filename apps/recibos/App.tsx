import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "./src/branding";
import { bootstrapApi } from "./src/lib/api";
import { useSesion } from "./src/lib/sesion";

/**
 * Andamiaje de la app de recibos.
 *
 * Por ahora sólo arranca el cliente HTTP, hidrata la sesión y muestra en qué estado
 * está. Las pantallas —login, contexto, bitácora, recibo— entran en los pasos
 * siguientes; esto existe para que el proyecto compile y arranque de punta a punta
 * antes de construir nada encima.
 *
 * El chrome usa `cliente.chrome`, el color de marca oscurecido hasta 4.5:1 de contraste
 * contra el texto claro. Ver src/branding.
 */
export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const hidratandoSesion = useSesion((s) => s.hidratando);
  const recibidor = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const hidratarSesion = useSesion((s) => s.hidratar);

  useEffect(() => {
    bootstrapApi()
      .then(() => hidratarSesion())
      .then(() => setBootDone(true))
      .catch((e) => {
        setBootError(e?.message ?? "Error inicializando la app");
        setBootDone(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargando = !bootDone || isInitializing || hidratandoSesion;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={[styles.root, { backgroundColor: cliente.chrome }]}>
          {cargando ? (
            <>
              <ActivityIndicator size="large" color={cliente.acento} />
              <Text style={styles.texto}>Iniciando...</Text>
            </>
          ) : (
            <>
              <Text style={styles.titulo}>{cliente.nombre}</Text>
              {bootError ? (
                <Text style={styles.error}>⚠ {bootError}</Text>
              ) : (
                <Text style={styles.texto}>
                  {isAuthenticated
                    ? `${recibidor ?? "sin recibidor"} · ${cosecha ?? "sin cosecha"}`
                    : "Sin sesión"}
                </Text>
              )}
            </>
          )}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  titulo: { color: "#f1f5f9", fontSize: 22, fontWeight: "700" },
  texto: { color: "#cbd5e1", fontSize: 14 },
  error: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
});
