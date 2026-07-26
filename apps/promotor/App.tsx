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
import { useAuthStore } from "@erp/shared-api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ProductoresScreen } from "./src/screens/ProductoresScreen";
import { ProductorDetailScreen } from "./src/screens/ProductorDetailScreen";
import { SolicitudesScreen } from "./src/screens/SolicitudesScreen";
import { SolicitudDetailScreen } from "./src/screens/SolicitudDetailScreen";
import { NuevaSolicitudScreen } from "./src/screens/NuevaSolicitudScreen";
import { VisitasScreen } from "./src/screens/VisitasScreen";
import { NuevaVisitaScreen } from "./src/screens/NuevaVisitaScreen";
import { FotosVisitaScreen } from "./src/screens/FotosVisitaScreen";
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
        options={{ title: "Nueva solicitud" }}
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
        name="NuevaVisita"
        component={NuevaVisitaScreen}
        options={{ title: "Nueva visita" }}
      />
      <VisitasStack.Screen
        name="FotosVisita"
        component={FotosVisitaScreen}
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

function CustomDrawer(props: DrawerContentComponentProps) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [syncing, setSyncing] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);

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
      </View>

      <DrawerItem
        label={syncing ? "Sincronizando..." : "Sincronizar todo"}
        onPress={handleSync}
        labelStyle={styles.drawerLabel}
      />
      {ultimoError ? <Text style={styles.drawerError}>⚠ {ultimoError}</Text> : null}

      <DrawerItem
        label="Cerrar sesión"
        onPress={logout}
        labelStyle={styles.drawerLabel}
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

  useEffect(() => {
    bootstrapApi()
      .then(() => setBootDone(true))
      .catch((e) => {
        setBootError(e?.message ?? "Error inicializando el app");
        setBootDone(true);
      });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={navTheme}>
          {(() => {
            if (!bootDone || isInitializing) {
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
            if (isAuthenticated) return <AuthenticatedNav />;
            return <LoginScreen />;
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
