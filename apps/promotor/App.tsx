import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  NavigationContainer,
  DefaultTheme,
  DrawerActions,
  Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from "@react-navigation/drawer";
import { Alert } from "react-native";
import { useAuthStore } from "@erp/shared-api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ContextoScreen } from "./src/screens/ContextoScreen";
import { useSesion } from "./src/lib/sesion";
import { cambiarCosecha, contarPendientes, HayPendientesError } from "./src/lib/sync";
import { cargarContexto } from "./src/lib/contexto";
import { PickerModal } from "./src/screens/componentes/Picker";
import { usePendientes } from "./src/screens/usePendientes";
import { ProductoresScreen } from "./src/screens/ProductoresScreen";
import { ProductorDetailScreen } from "./src/screens/ProductorDetailScreen";
import { SolicitudesScreen } from "./src/screens/SolicitudesScreen";
import { SolicitudDetailScreen } from "./src/screens/SolicitudDetailScreen";
import { NuevaSolicitudScreen } from "./src/screens/NuevaSolicitudScreen";
import { VisitasScreen } from "./src/screens/VisitasScreen";
import { VisitaDetailScreen } from "./src/screens/VisitaDetailScreen";
import { NuevaVisitaScreen } from "./src/screens/NuevaVisitaScreen";
import { AdjuntosScreen } from "./src/screens/AdjuntosScreen";
import { bootstrapApi } from "./src/lib/api";
import { syncNow } from "./src/lib/sync";

// Mismo tema que recibos-cr — las dos apps se ven como una familia.
const navTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: "#f8fafc",
    card: "#0f172a",
    text: "#f1f5f9",
    primary: "#3b82f6",
    border: "#1e293b",
    notification: "#3b82f6",
  },
  fonts: DefaultTheme.fonts,
};

const stackScreenOptions = {
  headerStyle: { backgroundColor: "#0f172a" },
  headerTintColor: "#f1f5f9",
} as const;

/**
 * Botón hamburguesa que abre el drawer. Se usa como headerLeft de la pantalla
 * raíz de cada Stack (en pantallas profundas el Stack pone el back automático).
 * Carácter unicode para no depender de @expo/vector-icons.
 */
function DrawerMenuButton({ navigation }: Readonly<{ navigation: any }>) {
  return (
    <TouchableOpacity
      onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ color: "#f1f5f9", fontSize: 26, lineHeight: 28 }}>≡</Text>
    </TouchableOpacity>
  );
}

/** "+" del header para crear. Mismo hitSlop generoso que el hamburguesa. */
function BotonNuevo({ onPress }: Readonly<{ onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ color: "#f1f5f9", fontSize: 30, lineHeight: 32 }}>+</Text>
    </TouchableOpacity>
  );
}

// ─── Stacks por tab ──────────────────────────────────────────────────

const ProductoresStack = createNativeStackNavigator();
function ProductoresStackScreens() {
  return (
    <ProductoresStack.Navigator screenOptions={stackScreenOptions}>
      <ProductoresStack.Screen
        name="ProductoresList"
        component={ProductoresScreen}
        options={({ navigation }) => ({
          title: "Productores",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
        })}
      />
      <ProductoresStack.Screen
        name="ProductorDetail"
        component={ProductorDetailScreen}
        options={{ title: "Productor" }}
      />
    </ProductoresStack.Navigator>
  );
}

const SolicitudesStack = createNativeStackNavigator();
function SolicitudesStackScreens() {
  return (
    <SolicitudesStack.Navigator screenOptions={stackScreenOptions}>
      <SolicitudesStack.Screen
        name="SolicitudesList"
        component={SolicitudesScreen}
        options={({ navigation }) => ({
          title: "Solicitudes",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
          headerRight: () => (
            <BotonNuevo onPress={() => navigation.navigate("NuevaSolicitud")} />
          ),
        })}
      />
      <SolicitudesStack.Screen
        name="SolicitudDetail"
        component={SolicitudDetailScreen}
        options={{ title: "Solicitud" }}
      />
      <SolicitudesStack.Screen
        name="NuevaSolicitud"
        component={NuevaSolicitudScreen}
        options={({ route }) => ({
          title: (route.params as { solicitudId?: string })?.solicitudId
            ? "Editar solicitud"
            : "Nueva solicitud",
        })}
      />
      {/* La misma pantalla de adjuntos que en visitas: acá para la cédula y los
          respaldos de la solicitud. */}
      <SolicitudesStack.Screen
        name="Adjuntos"
        component={AdjuntosScreen}
        options={{ title: "Adjuntos de la solicitud" }}
      />
    </SolicitudesStack.Navigator>
  );
}

const VisitasStack = createNativeStackNavigator();
function VisitasStackScreens() {
  return (
    <VisitasStack.Navigator screenOptions={stackScreenOptions}>
      <VisitasStack.Screen
        name="VisitasList"
        component={VisitasScreen}
        options={({ navigation }) => ({
          title: "Visitas",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
          headerRight: () => (
            <BotonNuevo onPress={() => navigation.navigate("NuevaVisita")} />
          ),
        })}
      />
      <VisitasStack.Screen
        name="VisitaDetail"
        component={VisitaDetailScreen}
        options={{ title: "Visita" }}
      />
      <VisitasStack.Screen
        name="NuevaVisita"
        component={NuevaVisitaScreen}
        // El título depende de si viene con visitaId: la misma pantalla sirve
        // para crear y para editar.
        options={({ route }) => ({
          title: (route.params as { visitaId?: string })?.visitaId
            ? "Editar visita"
            : "Nueva visita",
        })}
      />
      <VisitasStack.Screen
        name="Adjuntos"
        component={AdjuntosScreen}
        options={{ title: "Fotos de la visita" }}
      />
    </VisitasStack.Navigator>
  );
}

// ─── Bottom tabs ─────────────────────────────────────────────────────

const Tabs = createBottomTabNavigator();
function MainTabs() {
  // El inset es el alto de la barra de gestos/navegación del SO. Sin sumarlo,
  // los labels quedan tapados en teléfonos con gesture nav. Misma corrección
  // que se hizo en recibos-cr.
  const insets = useSafeAreaInsets();
  const TAB_BAR_CONTENT_HEIGHT = 56;
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#0f172a",
          borderTopColor: "#1e293b",
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
        tabBarActiveTintColor: "#3b82f6",
        tabBarInactiveTintColor: "#94a3b8",
      }}
    >
      <Tabs.Screen
        name="ProductoresTab"
        component={ProductoresStackScreens}
        options={{ tabBarLabel: "Productores" }}
      />
      <Tabs.Screen
        name="SolicitudesTab"
        component={SolicitudesStackScreens}
        options={{ tabBarLabel: "Solicitudes" }}
      />
      <Tabs.Screen
        name="VisitasTab"
        component={VisitasStackScreens}
        options={{ tabBarLabel: "Visitas" }}
      />
    </Tabs.Navigator>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────

/**
 * Etiqueta del botón de sincronizar.
 *
 * Separa "sin enviar" de "sin cerrar" porque son dos situaciones distintas para el
 * usuario: lo primero se resuelve sincronizando, lo segundo no —esa fila espera un
 * evento de negocio, como imprimir un recibo—. Con un solo número, sincroniza, el
 * contador no baja a cero y no se entiende por qué.
 */
function etiquetaSync(p: { porEnviar: number; retenidas: number; total: number }): string {
  if (p.total === 0) return "Sincronizar todo";
  const partes: string[] = [];
  if (p.porEnviar > 0) partes.push(`${p.porEnviar} sin enviar`);
  if (p.retenidas > 0) partes.push(`${p.retenidas} sin cerrar`);
  return `Sincronizar (${partes.join(" · ")})`;
}

/** Zonas por nombre ("MIRAMAR"), con el código como respaldo si falta el nombre. */
function descripcionZonas(
  todas: boolean,
  codigos: string[],
  nombres: string[]
): string {
  if (todas) return "todas las zonas";
  const etiquetas = nombres.length > 0 ? nombres : codigos;
  return etiquetas.length > 0 ? `zona(s) ${etiquetas.join(", ")}` : "sin zonas";
}

function CustomDrawer(props: DrawerContentComponentProps) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const cosecha = useSesion((s) => s.cosecha);
  const zonas = useSesion((s) => s.zonas);
  const zonasNombres = useSesion((s) => s.zonasNombres);
  const todasLasZonas = useSesion((s) => s.todasLasZonas);
  const companyId = useSesion((s) => s.companyId);
  const pendientes = usePendientes();
  const [syncing, setSyncing] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);
  const [cosechas, setCosechas] = useState<string[]>([]);
  const [pickerCosecha, setPickerCosecha] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  /**
   * Cambiar de cosecha rebaja los datos (ver cambiarCosecha), así que se avisa
   * antes y se bloquea si hay trabajo sin sincronizar en vez de perderlo.
   */
  const abrirCambioCosecha = async () => {
    setUltimoError(null);
    const pendientes = await contarPendientes();
    if (pendientes > 0) {
      Alert.alert(
        "Hay trabajo sin sincronizar",
        `Tenés ${pendientes} registro(s) que todavía no subieron. Sincronizá primero: al cambiar de cosecha se vuelven a bajar los datos y se perderían.`
      );
      return;
    }
    try {
      const { empresas } = await cargarContexto();
      const actual = empresas.find((e) => e.id === companyId);
      setCosechas((actual?.cosechas ?? []).map((c) => c.codigo));
      setPickerCosecha(true);
    } catch {
      setUltimoError(
        "No se pudo traer el catálogo de cosechas; se necesita conexión para cambiarla."
      );
    }
  };

  const aplicarCosecha = async (nueva: string) => {
    if (nueva === cosecha) return;
    setCambiando(true);
    setUltimoError(null);
    try {
      await cambiarCosecha(nueva);
    } catch (e) {
      setUltimoError(
        e instanceof HayPendientesError
          ? e.message
          : ((e as Error)?.message ?? "No se pudo cambiar la cosecha")
      );
    } finally {
      setCambiando(false);
    }
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setUltimoError(null);
    try {
      await syncNow();
    } catch (e) {
      const msg = (e as Error)?.message ?? "Error desconocido";
      console.warn("sync failed", msg);
      setUltimoError(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Promotor</Text>
        {user && <Text style={styles.drawerUser}>{user.usuario}</Text>}
        {/* Contexto siempre visible: sin esto el promotor no sabe por qué no ve
            un productor o una solicitud que espera. */}
        <Text style={styles.drawerUser}>
          Cosecha {cosecha ?? "—"} · {descripcionZonas(todasLasZonas, zonas, zonasNombres)}
        </Text>
      </View>

      <DrawerItem
        label={syncing ? "Sincronizando..." : etiquetaSync(pendientes)}
        onPress={handleSync}
        labelStyle={[
          styles.drawerLabel,
          pendientes.total > 0 ? { color: "#fbbf24", fontWeight: "700" } : null,
        ]}
      />
      <DrawerItem
        label={cambiando ? "Cambiando cosecha..." : "Cambiar cosecha"}
        onPress={abrirCambioCosecha}
        labelStyle={styles.drawerLabel}
      />
      {ultimoError ? <Text style={styles.drawerError}>⚠ {ultimoError}</Text> : null}

      <DrawerItem
        label="Cerrar sesión"
        onPress={logout}
        labelStyle={styles.drawerLabel}
      />

      <PickerModal
        visible={pickerCosecha}
        titulo="Cambiar cosecha"
        opciones={cosechas.map((c) => ({ valor: c, titulo: c }))}
        onSeleccionar={aplicarCosecha}
        onCerrar={() => setPickerCosecha(false)}
      />
    </DrawerContentScrollView>
  );
}

const Drawer = createDrawerNavigator();
function AuthenticatedNav() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        // El header visible es el del Stack interno de cada tab; el drawer no
        // rendera el suyo para no apilar dos. El hamburguesa vive en cada Stack.
        headerShown: false,
        drawerStyle: { backgroundColor: "#0f172a" },
      }}
    >
      <Drawer.Screen name="Main" component={MainTabs} />
    </Drawer.Navigator>
  );
}

// ─── Root ────────────────────────────────────────────────────────────

export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const sesionCompanyId = useSesion((s) => s.companyId);
  const sesionCosecha = useSesion((s) => s.cosecha);
  const hidratandoSesion = useSesion((s) => s.hidratando);
  const hidratarSesion = useSesion((s) => s.hidratar);

  useEffect(() => {
    bootstrapApi()
      .then(() => hidratarSesion())
      .then(() => setBootDone(true))
      .catch((e) => {
        setBootError(e?.message ?? "Error inicializando el app");
        setBootDone(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={navTheme}>
          {(() => {
            if (!bootDone || isInitializing || hidratandoSesion) {
              return (
                <View style={styles.center}>
                  <ActivityIndicator size="large" color="#3b82f6" />
                  <Text style={styles.loadingText}>Iniciando...</Text>
                </View>
              );
            }
            if (bootError) {
              return (
                <View style={styles.center}>
                  <Text style={styles.errorText}>⚠ {bootError}</Text>
                </View>
              );
            }
            if (!isAuthenticated) return <LoginScreen />;
            // Autenticado pero sin contexto de trabajo: el sync está scopeado por
            // empresa y cosecha, así que entrar sin elegirlas no traería nada.
            if (sesionCompanyId == null || !sesionCosecha) return <ContextoScreen />;
            return <AuthenticatedNav />;
          })()}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "#0f172a",
  },
  loadingText: { color: "#94a3b8", marginTop: 12 },
  errorText: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
  drawerContent: { paddingTop: 24 },
  drawerHeader: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    marginBottom: 12,
  },
  drawerTitle: { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  drawerUser: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
  drawerLabel: { color: "#e2e8f0" },
  drawerError: {
    color: "#fca5a5",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
