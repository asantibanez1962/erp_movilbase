import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import { RecibosListScreen } from "./src/screens/RecibosListScreen";
import { NewReciboScreen } from "./src/screens/NewReciboScreen";
import { bootstrapApi } from "./src/lib/api";
import { syncNow } from "./src/lib/sync";
import { purgeOldSyncedRecibos } from "./src/lib/db";

// ─────────────────────────────────────────────────────────────
// Theme dark consistente con el resto del app
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// DrawerMenuButton — botón hamburguesa que abre el drawer. Se usa como
// headerLeft de cada Stack interno cuando estamos en la pantalla raíz del
// stack (en pantallas profundas, RN Stack pone el back arrow automático).
// Carácter unicode "≡" para evitar dependencia extra de @expo/vector-icons.
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// Stack para Recibos (lista → form nuevo)
// El Stack maneja el back automático; los screens no necesitan
// onBack callbacks. El headerLeft de la screen raíz es el hamburguesa
// que abre el drawer (sumado acá porque escondimos el header propio del
// drawer en AuthenticatedNav para no apilar 2 headers).
// ─────────────────────────────────────────────────────────────
const RecibosStack = createNativeStackNavigator();
function RecibosStackScreens() {
  return (
    <RecibosStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f1f5f9",
      }}
    >
      <RecibosStack.Screen
        name="RecibosList"
        component={RecibosListScreen}
        options={({ navigation }) => ({
          title: "Recibos",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
        })}
      />
      <RecibosStack.Screen
        name="NewRecibo"
        component={NewReciboScreen}
        options={{ title: "Nuevo recibo", presentation: "modal" }}
      />
    </RecibosStack.Navigator>
  );
}

// Stack para Productores (lista por ahora; mañana sumamos ProductorDetail)
const ProductoresStack = createNativeStackNavigator();
function ProductoresStackScreens() {
  return (
    <ProductoresStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f1f5f9",
      }}
    >
      <ProductoresStack.Screen
        name="ProductoresList"
        component={ProductoresScreen}
        options={({ navigation }) => ({
          title: "Productores",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
        })}
      />
    </ProductoresStack.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────
// Bottom Tabs — las 2 áreas operativas del POC.
// Cuando sumemos Bitácoras / Reportes va otro <Tab.Screen> acá.
// ─────────────────────────────────────────────────────────────
const Tabs = createBottomTabNavigator();
function MainTabs() {
  // Inset.bottom = alto de la barra de gesture/nav del SO (Android: ~24px
  // gesture pill, hardware-buttons device: ~48px; iOS: 34px en notch devices).
  // Sumamos al alto base del tab bar + al paddingBottom para que las labels
  // queden visibles sobre la barra del SO en CUALQUIER dispositivo, no solo
  // en el que probamos. Sin esto, los labels se solapan o se ocultan en
  // tablets/teléfonos con gesture nav.
  const insets = useSafeAreaInsets();
  const TAB_BAR_CONTENT_HEIGHT = 56; // alto util sin contar el inset
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
        options={{ title: "Productores", tabBarLabel: "Productores" }}
      />
      <Tabs.Screen
        name="RecibosTab"
        component={RecibosStackScreens}
        options={{ title: "Recibos", tabBarLabel: "Recibos" }}
      />
    </Tabs.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer custom — items para acciones globales (sync, logout)
// que no son screens. Se abre con swipe desde el borde izquierdo
// o tap en la hamburguesa del header.
// ─────────────────────────────────────────────────────────────
function CustomDrawer(props: DrawerContentComponentProps) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncNow();
    } catch (e) {
      console.warn("sync failed", (e as Error)?.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Recibos CR</Text>
        {user && <Text style={styles.drawerUser}>{user.usuario}</Text>}
      </View>

      <DrawerItem
        label={syncing ? "Sincronizando..." : "Sincronizar todo"}
        onPress={handleSync}
        labelStyle={styles.drawerLabel}
      />
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
        // headerShown=false: el drawer NO rendera su propio header. El header
        // visible viene del Stack interno de cada Tab (Recibos / Productores).
        // Antes teníamos 2 headers apilados (drawer "Operación" + stack
        // "Recibos") y se perdía espacio vertical útil. El botón hamburguesa
        // que abre el drawer ahora vive en cada Stack header como headerLeft.
        headerShown: false,
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f1f5f9",
        drawerStyle: { backgroundColor: "#0f172a" },
      }}
    >
      <Drawer.Screen
        name="Main"
        component={MainTabs}
        options={{ title: "Operación" }}
      />
    </Drawer.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────
// Root App
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);

  useEffect(() => {
    bootstrapApi()
      .then(() => {
        // Purga silenciosa de recibos enviados > 30 días. No bloquea boot —
        // si falla, el app sigue funcionando (el cache crece pero no rompe).
        void purgeOldSyncedRecibos();
        setBootDone(true);
      })
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
  drawerTitle: {
    color: "#f1f5f9",
    fontSize: 20,
    fontWeight: "700",
  },
  drawerUser: {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 4,
  },
  drawerLabel: { color: "#e2e8f0" },
});
