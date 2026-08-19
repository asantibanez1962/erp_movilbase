import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "./src/branding";
import { borrarSiEsOtroUsuario } from "./src/lib/alcance";
import { bootstrapApi } from "./src/lib/api";
import { useSesion } from "./src/lib/sesion";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ContextoScreen } from "./src/screens/ContextoScreen";
import { Navegacion } from "./src/screens/Navegacion";

/**
 * Raíz de la app de recibos.
 *
 * Tres puertas antes de trabajar, en este orden y por esta razón:
 *   1. sesión — las credenciales se validan contra el servidor, así que el primer
 *      ingreso de cada usuario en cada teléfono necesita señal. De ahí en adelante no.
 *   2. contexto — empresa, recibidor y cosecha. Sin eso el pull no sabe qué recortar.
 *   3. la app.
 */
export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const hidratandoSesion = useSesion((s) => s.hidratando);
  const reseteando = useSesion((s) => s.reseteando);
  const generacion = useSesion((s) => s.generacion);
  const recibidor = useSesion((s) => s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const hidratarSesion = useSesion((s) => s.hidratar);
  const usuario = useAuthStore((s) => s.user?.usuario ?? null);

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

  /**
   * ⚠️ SI LOS DATOS QUE HAY SON DE OTRO USUARIO, SE BORRAN ANTES DE MOSTRAR NADA.
   *
   * Cerrar sesión ya no borra —el mismo recibidor vuelve y encuentra su trabajo, sin
   * rebajar 12.825 productores— pero entonces hay que impedir que ese trabajo, y los
   * productores y precios de su zona, se le aparezcan al siguiente. El único momento en
   * que se sabe quién es, es acá: cuando ya se autenticó y todavía no vio nada.
   *
   * Corre después del boot para no competir con la hidratación de la sesión.
   */
  useEffect(() => {
    if (!bootDone || !isAuthenticated || !usuario) return;
    void borrarSiEsOtroUsuario(usuario);
  }, [bootDone, isAuthenticated, usuario]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {(() => {
          if (!bootDone || isInitializing || hidratandoSesion) {
            return <Espera texto="Iniciando..." />;
          }
          if (bootError) {
            return (
              <View style={[styles.centro, { backgroundColor: cliente.chrome }]}>
                <Text style={styles.error}>⚠ {bootError}</Text>
              </View>
            );
          }
          // Mientras se borra la base, NADA que consulte WatermelonDB puede estar
          // montado: si quedaran suscripciones vivas, el reset las mata y las pantallas
          // seguirían mostrando datos que ya no existen. Ver lib/alcance.ts.
          if (reseteando) return <Espera texto="Preparando..." />;

          if (!isAuthenticated) return <LoginScreen />;
          if (recibidor == null || !cosecha) return <ContextoScreen />;

          // `key`: después de borrar la base hay que recrear todas las queries contra la
          // base nueva. Remontar el árbol es la forma limpia de lograrlo sin obligar a
          // cerrar y abrir la app.
          return <Navegacion key={generacion} />;
        })()}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Espera({ texto }: Readonly<{ texto: string }>) {
  return (
    <View style={[styles.centro, { backgroundColor: cliente.chrome }]}>
      <ActivityIndicator size="large" color={cliente.acento} />
      <Text style={styles.texto}>{texto}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  texto: { color: "#cbd5e1", fontSize: 14 },
  error: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
});
