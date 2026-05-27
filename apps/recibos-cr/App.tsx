import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore } from "@erp/shared-api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ProductoresScreen } from "./src/screens/ProductoresScreen";
import { RecibosListScreen } from "./src/screens/RecibosListScreen";
import { NewReciboScreen } from "./src/screens/NewReciboScreen";
import { bootstrapApi } from "./src/lib/api";

type Screen = "productores" | "recibos" | "new-recibo";

export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const [screen, setScreen] = useState<Screen>("productores");
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

  // Reset screen al logout para que el próximo login arranque en productores
  useEffect(() => {
    if (!isAuthenticated) setScreen("productores");
  }, [isAuthenticated]);

  let body: React.ReactNode;
  if (!bootDone || isInitializing) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Iniciando...</Text>
      </View>
    );
  } else if (bootError) {
    body = (
      <View style={styles.center}>
        <Text style={styles.errorText}>⚠ {bootError}</Text>
      </View>
    );
  } else if (!isAuthenticated) {
    body = <LoginScreen />;
  } else if (screen === "productores") {
    body = <ProductoresScreen onGoRecibos={() => setScreen("recibos")} />;
  } else if (screen === "recibos") {
    body = (
      <RecibosListScreen
        onNew={() => setScreen("new-recibo")}
        onBack={() => setScreen("productores")}
      />
    );
  } else {
    body = <NewReciboScreen onDone={() => setScreen("recibos")} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        {body}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0f172a" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  loadingText: { color: "#94a3b8", marginTop: 12 },
  errorText: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
});
