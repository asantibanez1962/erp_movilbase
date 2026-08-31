import React from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, StyleSheet, Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as SecureStore from "expo-secure-store";
import { useAuthStore, TokenStore } from "@erp/shared-api";

import { cargarUrlServidor, urlServidor } from "./src/lib/servidor";
import { useSesion } from "./src/lib/sesion";
import { useOpciones } from "./src/lib/opciones";
import { useMedidas, Medidas } from "./src/lib/pantalla";
import type { Rutas, Props as PropsRuta } from "./src/lib/rutas";
import { cargarBodegas, cargarEmpresas, Bodega, Empresa } from "./src/lib/bodegaApi";
import { BuscarScreen, mensajeDeError, VERDE } from "./src/screens/BuscarScreen";
import { MenuScreen } from "./src/screens/MenuScreen";
import { MoverScreen } from "./src/screens/MoverScreen";
import { OtScreen } from "./src/screens/OtScreen";
import { OtDetalleScreen } from "./src/screens/OtDetalleScreen";
import { TomaFisicaScreen } from "./src/screens/TomaFisicaScreen";
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
 * Con la bodega ya elegida, la primera pantalla es el MENU y no el cambio de
 * ubicación. Cuesta un toque más, pero es el único lugar donde pueden vivir
 * cerrar sesión —en una bodega se turnan varios operarios en la misma
 * tableta—, cambiar de bodega, y las opciones del legacy que todavía no
 * existen.
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

  const refrescarOpciones = useOpciones((s) => s.refrescar);
  const limpiarOpciones = useOpciones((s) => s.limpiar);
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

  // Los permisos se piden al entrar y se sueltan al salir: el menú de un
  // usuario no puede quedar armado con lo que podía el anterior. En una bodega
  // se turnan varios operarios en la misma tableta.
  React.useEffect(() => {
    if (autenticado) void refrescarOpciones();
    else limpiarOpciones();
  }, [autenticado, refrescarOpciones, limpiarOpciones]);

  if (!urlLista || iniciando || cargandoSesion) {
    return (
      <SafeAreaProvider>
        <View style={base.centro}><ActivityIndicator size="large" color={VERDE} /></View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {/* Iconos oscuros: la barra de estado cruza las dos mitades de la
          pantalla, y sobre el fondo claro del formulario los blancos
          desaparecian. Sobre el verde se leen igual. */}
      <StatusBar style="dark" />
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
              <Stack.Screen name="Menu" component={MenuScreen} options={{ title: "Bodega" }} />
              <Stack.Screen name="Buscar" component={BuscarScreen}
                            options={{ title: "Cambio de ubicación" }} />
              <Stack.Screen name="Mover" component={MoverScreen} options={{ title: "Mover partida" }} />
              <Stack.Screen name="TomaFisica" component={TomaFisicaScreen}
                            options={{ title: "Toma física" }} />
              <Stack.Screen name="Ot" component={OtScreen} options={{ title: "OT" }} />
              <Stack.Screen name="OtDetalle" component={OtDetalleScreen} options={{ title: "OT" }} />
              <Stack.Screen name="Servidor" component={ServidorScreen}
                            options={{ title: "Servidor" }} />
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

  // El panel verde SANGRA hasta el borde y son los textos los que respetan el
  // recorte, no el panel. Acostado, el recorte de la camara queda sobre la
  // franja izquierda: con un SafeAreaView envolviendo todo, el verde arrancaba
  // 57px adentro y se veia una tira clara al costado, como un error de dibujo.
  const bordes = useSafeAreaInsets();

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
    <View style={s.pantalla}>
      <View style={[s.marca, { paddingLeft: m.e(30) + bordes.left }]}>
        <Text style={s.titulo}>Bodega</Text>
        <Text style={s.sub}>Cambios de ubicación</Text>
      </View>

      <View style={[s.formulario, { paddingRight: m.e(28) + bordes.right }]}>
        <Text style={s.etiqueta}>Usuario</Text>
        <TextInput
          style={s.input} value={usuario} onChangeText={setUsuario}
          autoCapitalize="none" autoCorrect={false}
          // En horizontal, Android abre un editor a pantalla completa que tapa
          // la app entera. Esta app es horizontal siempre: va en cada campo.
          disableFullscreenUI
          placeholder="usuario" placeholderTextColor="#94a3b8"
          returnKeyType="next" onSubmitEditing={() => campoClave.current?.focus()}
        />

        <Text style={s.etiqueta}>Contraseña</Text>
        <TextInput
          ref={campoClave}
          style={s.input} value={clave} onChangeText={setClave}
          secureTextEntry placeholder="••••••••" placeholderTextColor="#94a3b8"
          disableFullscreenUI
          returnKeyType="go" onSubmitEditing={entrar}
        />

        <Pressable style={[s.btn, ocupado && s.btnApagado]} onPress={entrar} disabled={ocupado}>
          {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTexto}>Ingresar</Text>}
        </Pressable>

        <Pressable onPress={() => navigation.navigate("Servidor")}>
          <Text style={s.enlace}>Configurar servidor</Text>
        </Pressable>
      </View>
    </View>
  );
}

function estilosLogin(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    // paddingLeft y paddingRight los pone el componente, sumando el recorte.
    marca: {
      flex: 1, justifyContent: "center", paddingRight: m.e(30),
      backgroundColor: VERDE,
    },
    titulo: { fontSize: m.e(40), fontWeight: "700", color: "#fff" },
    sub: { fontSize: m.e(17), color: "#dcfce7", marginTop: m.e(4) },
    formulario: { flex: 1, justifyContent: "center", paddingLeft: m.e(28) },
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
 * Elegir empresa y bodega, en ese orden. Con una sola opción no se pregunta:
 * se entra directo. Un operario trabaja en una bodega, y hacerle tocar un
 * botón para confirmar lo único posible es ruido.
 *
 * LA EMPRESA NO SALE DEL USUARIO LOGUEADO. `UserSummary` del store de auth es
 * solo { id, usuario }; la empresa vive en los claims del JWT y la resuelve el
 * servidor en /api/mobile/contexto. Leerla del objeto de usuario con un cast
 * compila igual y devuelve undefined para siempre: esta pantalla se quedaba
 * girando sin pedir nada y sin dar un error. Por eso ahora TODO estado —sin
 * empresas, sin bodegas, error de red— tiene su mensaje en pantalla, y el
 * indicador de carga sale sólo cuando de verdad hay una llamada en curso.
 */
function BodegaScreen() {
  const fijarBodega = useSesion((st) => st.fijarBodega);
  const fijarEmpresa = useSesion((st) => st.fijarEmpresa);
  const companyId = useSesion((st) => st.companyId);

  const m = useMedidas();
  const s = React.useMemo(() => estilosBodega(m), [m]);
  const columnas = m.columnas(m.ancho, 240);

  const [empresas, setEmpresas] = React.useState<Empresa[] | null>(null);
  const [bodegas, setBodegas] = React.useState<Bodega[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (companyId != null) return;
    setError(null);
    cargarEmpresas()
      .then((es) => {
        setEmpresas(es);
        const unica = es.length === 1 ? es[0] : null;
        if (unica) void fijarEmpresa(unica.id);
      })
      .catch((e) => setError(mensajeDeError(e)));
  }, [companyId, fijarEmpresa]);

  React.useEffect(() => {
    if (companyId == null) return;
    setError(null);
    cargarBodegas()
      .then((bs) => {
        setBodegas(bs);
        const unica = bs.length === 1 ? bs[0] : null;
        if (unica) void fijarBodega(unica.id, unica.nombre);
      })
      .catch((e) => setError(mensajeDeError(e)));
  }, [companyId, fijarBodega]);

  if (error) return <Aviso texto={error} />;

  // Paso 1: la empresa.
  if (companyId == null) {
    if (!empresas) return <Cargando />;
    if (empresas.length === 0) {
      return <Aviso texto="Su usuario no tiene empresas asignadas. Avise a la oficina." />;
    }
    return (
      <Rejilla
        s={s} columnas={columnas} titulo="Empresa"
        opciones={empresas}
        alElegir={(e) => fijarEmpresa(e.id)}
      />
    );
  }

  // Paso 2: la bodega.
  if (!bodegas) return <Cargando />;
  if (bodegas.length === 0) {
    return <Aviso texto="No tiene bodegas asignadas. Pida en la oficina que le asignen la suya." />;
  }
  return (
    <Rejilla
      s={s} columnas={columnas} titulo="Bodega"
      opciones={bodegas}
      alElegir={(b) => fijarBodega(b.id, b.nombre)}
    />
  );
}

function Cargando() {
  return <View style={base.centro}><ActivityIndicator size="large" color={VERDE} /></View>;
}

function Aviso({ texto }: { texto: string }) {
  return <View style={base.centro}><Text style={base.error}>{texto}</Text></View>;
}

function Rejilla<T extends { id: number; nombre: string }>(
  { s, columnas, titulo, opciones, alElegir }: {
    s: ReturnType<typeof estilosBodega>;
    columnas: number;
    titulo: string;
    opciones: T[];
    alElegir: (o: T) => void;
  },
) {
  return (
    <ScrollView contentContainerStyle={s.rejilla}>
      <Text style={s.titulo}>{titulo}</Text>
      <View style={s.fila}>
        {opciones.map((o) => (
          <View key={o.id} style={[s.celda, { width: `${100 / columnas}%` }]}>
            <Pressable style={s.bodega} onPress={() => alElegir(o)}>
              <Text style={s.bodegaTexto} numberOfLines={2}>{o.nombre}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function estilosBodega(m: Medidas) {
  return StyleSheet.create({
    rejilla: { padding: m.e(8) },
    titulo: { fontSize: m.e(14), color: "#64748b", marginLeft: m.e(6), marginBottom: m.e(4) },
    fila: { flexDirection: "row", flexWrap: "wrap" },
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
