import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "./src/branding";
import { bootstrapApi } from "./src/lib/api";
import { useSesion } from "./src/lib/sesion";
import { syncNow } from "./src/lib/sync";
import { database } from "./src/lib/db";
import { COLLECTIONS } from "./src/db/schema";
import { describirFallos } from "@erp/shared-sync";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ContextoScreen } from "./src/screens/ContextoScreen";

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
          return <Inicio key={generacion} />;
        })()}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Pantalla provisional mientras no existen las de bitácora y recibo.
 *
 * Su única razón de ser es poder disparar el primer sync y ver qué bajó. Es la primera
 * vez que las 21 colecciones registradas en el servidor se ejercitan contra el esquema
 * local, y si algún alias de columna no calza, acá aparece — no dentro de tres pantallas
 * cuando ya haya recibos encima.
 */
function Inicio() {
  const recibidor = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [sincronizando, setSincronizando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const sincronizar = async () => {
    if (sincronizando) return;
    setSincronizando(true);
    setResultado(null);
    try {
      const fallos = await syncNow();
      const conteos: string[] = [];
      for (const nombre of COLLECTIONS) {
        const n = await database.get(nombre).query().fetchCount();
        if (n > 0) conteos.push(`${nombre} ${n}`);
      }
      setResultado(
        (fallos.length > 0 ? `⚠ sin traer: ${describirFallos(fallos)}\n\n` : "") +
          (conteos.length > 0 ? conteos.join("\n") : "no bajó ninguna fila")
      );
    } catch (e) {
      setResultado(`⚠ ${(e as Error)?.message ?? "Error de sincronización"}`);
    } finally {
      setSincronizando(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: cliente.chrome }}
      contentContainerStyle={styles.centro}
    >
      <Text style={styles.titulo}>{cliente.nombre}</Text>
      <Text style={styles.texto}>
        {recibidor} · {cosecha}
      </Text>

      <TouchableOpacity
        onPress={sincronizar}
        disabled={sincronizando}
        style={styles.boton}
      >
        {sincronizando ? (
          <ActivityIndicator color={cliente.chrome} />
        ) : (
          <Text style={styles.botonTexto}>Sincronizar</Text>
        )}
      </TouchableOpacity>

      {resultado ? <Text style={styles.resultado}>{resultado}</Text> : null}
      <Text style={styles.pie}>Las pantallas de bitácora y recibo entran acá.</Text>
    </ScrollView>
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
  titulo: { color: "#f1f5f9", fontSize: 22, fontWeight: "700" },
  texto: { color: "#cbd5e1", fontSize: 14 },
  pie: { color: "#94a3b8", fontSize: 12, marginTop: 12 },
  boton: {
    backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 28,
    minHeight: 48, minWidth: 200, alignItems: "center", justifyContent: "center",
    marginTop: 18,
  },
  botonTexto: { fontWeight: "700", fontSize: 16, color: "#0f172a" },
  resultado: {
    color: "#e2e8f0", fontSize: 12, marginTop: 14, textAlign: "center",
    lineHeight: 18,
  },
  error: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
});
