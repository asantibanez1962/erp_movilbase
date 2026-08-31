import React from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, StyleSheet, Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";
import { useAuthStore, TokenStore } from "@erp/shared-api";

import { cargarUrlServidor, urlServidor } from "./src/lib/servidor";
import { useSesion } from "./src/lib/sesion";
import { useMedidas, Medidas } from "./src/lib/pantalla";
import type { Rutas, Props as PropsRuta } from "./src/lib/rutas";
import { cargarBodegas, Bodega } from "./src/lib/bodegaApi";
import { BuscarScreen, mensajeDeError, VERDE } from "./src/screens/BuscarScreen";
import { MoverScreen } from "./src/screens/MoverScreen";
import { ServidorScreen } from "./src/screens/ServidorScreen";

/**
 * App de bodega — cambios de ubicación para el montacarguista.
 *
 * CORRE SIEMPRE EN HORIZONTAL, en una tableta (Galaxy Tab A7 o genérica). El
 * bloqueo está en app.json más el plugin orientacion-horizontal; acá lo que
 * importa es la consecuencia: cada pantalla se maqueta a lo ancho, en dos
 * columnas, y las medidas salen de useMedidas() para que la misma maqueta se
 * pueda probar en un teléfono en horizontal —que tiene el mismo ancho pero la
 * mitad del alto—.
 *
 * Tres estados, en este orden: sin sesión → sin bodega → trabajando. Cada uno
 * es una pantalla completa y no se puede saltar, porque cada paso depende del
 * anterior: sin empresa no se pueden pedir bodegas, y sin bodega no hay
 * partidas que listar.
 *
 * NO HAY MENU LATERAL, a diferencia de las otras apps. El operario hace una
 * sola cosa; esconderla detrás de un menú sería agregarle un toque a cada
 * movimiento sin darle nada a cambio. "Toma Física" y las demás opciones del
 * legacy se agregarán cuando existan, y ahí se verá si hace falta un menú.
 */

const tokenStore: TokenStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

const Stack = createNativeStackNavigator<Rutas>();

export default function App() {
  const initAuth = useAuthStore((s) => s.init);
  const autenticado = useAuthStore((s) => s.isAuthenticated);
  const iniciando = useAuthStore((s) => s.isInitializing);

  const restaurar = useSesion((s) => s.restaurar);
  const cargandoSesion = useSesion((s) => s.cargando);
  const idBodega = useSesion((s) => s.idBodega);

  const [urlLista, setUrlLista] = React.useState(false);

  React.useEffect(() => {
    // El override del servidor se lee ANTES de cualquier request. urlServidor()
    // es sincrónica y hasta que esto termine devuelve la dirección compilada:
    // si el login saliera antes, iría al servidor equivocado.
    void (async () => {
      await cargarUrlServidor();
      setUrlLista(true);
      await initAuth({ baseURL: () => urlServidor(), tokenStore });
      await restaurar();
    })();
  }, [initAuth, restaurar]);

  if (!urlLista || iniciando || cargandoSesion) {
    return (
      <SafeAreaProvider>
        <View style={base.centro}><ActivityIndicator size="large" color={VERDE} /></View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: VERDE },
            headerTintColor: "#fff",
            headerTitleStyle: { fontWeight: "700" },
          }}
        >
          {!autenticado ? (
            <>
              <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
              <Stack.Screen name="Servidor" component={ServidorScreen} options={{ title: "Servidor" }} />
            </>
          ) : !idBodega ? (
            <Stack.Screen name="Bodega" component={BodegaScreen} options={{ title: "Elegir bodega" }} />
          ) : (
            <>
              <Stack.Screen name="Buscar" component={BuscarScreen}
                            options={{ title: "Cambio de ubicación" }} />
              <Stack.Screen name="Mover" component={MoverScreen} options={{ title: "Mover partida" }} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/**
 * Login. En horizontal la marca va al lado del formulario, no encima: con el
 * teclado abierto en un teléfono acostado quedan unos 180dp de alto útiles, y
 * apilarlos dejaría los campos debajo del teclado.
 */
function LoginScreen({ navigation }: Readonly<PropsRuta<"Login">>) {
  const login = useAuthStore((st) => st.login);
  const m = useMedidas();
  const s = React.useMemo(() => estilosLogin(m), [m]);

  const [usuario, setUsuario] = React.useState("");
  const [clave, setClave] = React.useState("");
  const [ocupado, setOcupado] = React.useState(false);
  const campoClave = React.useRef<TextInput>(null);

  async function entrar() {
    if (ocupado) return;
    setOcupado(true);
    try {
      await login(usuario.trim(), clave);
    } catch (e: unknown) {
      Alert.alert("No se pudo entrar", mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <SafeAreaView style={s.pantalla}>
      <View style={s.marca}>
        <Text style={s.titulo}>Bodega</Text>
        <Text style={s.sub}>Cambios de ubicación</Text>
      </View>

      <View style={s.formulario}>
        <Text style={s.etiqueta}>Usuario</Text>
        <TextInput
          style={s.input} value={usuario} onChangeText={setUsuario}
          autoCapitalize="none" autoCorrect={false}
          placeholder="usuario" placeholderTextColor="#94a3b8"
          returnKeyType="next" onSubmitEditing={() => campoClave.current?.focus()}
        />

        <Text style={s.etiqueta}>Contraseña</Text>
        <TextInput
          ref={campoClave}
          style={s.input} value={clave} onChangeText={setClave}
          secureTextEntry placeholder="••••••••" placeholderTextColor="#94a3b8"
          returnKeyType="go" onSubmitEditing={entrar}
        />

        <Pressable style={[s.btn, ocupado && s.btnApagado]} onPress={entrar} disabled={ocupado}>
          {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTexto}>Ingresar</Text>}
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Servidor")}>
          <Text style={s.enlace}>Configurar servidor</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function estilosLogin(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    marca: {
      flex: 1, justifyContent: "center", paddingHorizontal: m.e(30),
      backgroundColor: VERDE,
    },
    titulo: { fontSize: m.e(40), fontWeight: "700", color: "#fff" },
    sub: { fontSize: m.e(17), color: "#dcfce7", marginTop: m.e(4) },
    formulario: { flex: 1, justifyContent: "center", paddingHorizontal: m.e(28) },
    etiqueta: { fontSize: m.e(14), color: "#475569", marginTop: m.e(12), marginBottom: m.e(4) },
    input: {
      height: m.t(50), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(14), fontSize: m.e(17), backgroundColor: "#fff", color: "#0f172a",
    },
    btn: {
      height: m.t(54), borderRadius: 10, backgroundColor: VERDE, marginTop: m.e(20),
      alignItems: "center", justifyContent: "center",
    },
    btnApagado: { opacity: 0.6 },
    btnTexto: { color: "#fff", fontSize: m.e(18), fontWeight: "700" },
    enlace: { color: VERDE, textAlign: "center", marginTop: m.e(14), fontSize: m.e(15) },
  });
}

// ─────────────────────────────────────────────────────────────────────────
/**
 * Elegir bodega. Con una sola no se pregunta: se entra directo. Un operario
 * trabaja en una, y hacerle tocar un botón para confirmar lo único posible es
 * ruido.
 */
function BodegaScreen() {
  const fijarBodega = useSesion((st) => st.fijarBodega);
  const fijarEmpresa = useSesion((st) => st.fijarEmpresa);
  const companyId = useSesion((st) => st.companyId);
  const usuario = useAuthStore((st) => st.user);

  const m = useMedidas();
  const s = React.useMemo(() => estilosBodega(m), [m]);
  const columnas = m.columnas(m.ancho, 240);

  const [bodegas, setBodegas] = React.useState<Bodega[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // La compañía sale del usuario logueado. Sin ella el backend rechaza todo
    // con "X-Company-Id header is required".
    const cia = (usuario as { companyId?: number } | null)?.companyId;
    if (cia && companyId !== cia) void fijarEmpresa(cia);
  }, [usuario, companyId, fijarEmpresa]);

  React.useEffect(() => {
    if (companyId == null) return;
    cargarBodegas()
      .then((bs) => {
        setBodegas(bs);
        const unica = bs.length === 1 ? bs[0] : null;
        if (unica) void fijarBodega(unica.id, unica.nombre);
      })
      .catch((e) => setError(mensajeDeError(e)));
  }, [companyId, fijarBodega]);

  if (error) return <View style={base.centro}><Text style={base.error}>{error}</Text></View>;
  if (!bodegas) return <View style={base.centro}><ActivityIndicator size="large" color={VERDE} /></View>;

  if (bodegas.length === 0) {
    return (
      <View style={base.centro}>
        <Text style={base.error}>
          No tiene bodegas asignadas. Pida en la oficina que le asignen la suya.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.rejilla}>
      {bodegas.map((b) => (
        <View key={b.id} style={[s.celda, { width: `${100 / columnas}%` }]}>
          <Pressable style={s.bodega} onPress={() => fijarBodega(b.id, b.nombre)}>
            <Text style={s.bodegaTexto} numberOfLines={2}>{b.nombre}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function estilosBodega(m: Medidas) {
  return StyleSheet.create({
    rejilla: { flexDirection: "row", flexWrap: "wrap", padding: m.e(8) },
    celda: { padding: m.e(6) },
    bodega: {
      minHeight: m.t(80), justifyContent: "center",
      backgroundColor: "#fff", padding: m.e(18), borderRadius: 10,
      borderWidth: 1, borderColor: "#e2e8f0",
    },
    bodegaTexto: { fontSize: m.e(19), fontWeight: "600", color: "#0f172a" },
  });
}

const base = StyleSheet.create({
  centro: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, backgroundColor: "#f8fafc",
  },
  error: { color: "#b91c1c", fontSize: 16, textAlign: "center" },
});
