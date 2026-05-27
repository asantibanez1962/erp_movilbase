import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useAuthStore } from "@erp/shared-api";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ProductoresScreen } from "./src/screens/ProductoresScreen";
import { bootstrapApi } from "./src/lib/api";

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
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
        {(!bootDone || isInitializing) ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <Text style={styles.loadingText}>Iniciando...</Text>
          </View>
        ) : bootError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>⚠ {bootError}</Text>
          </View>
        ) : isAuthenticated ? (
          <ProductoresScreen />
        ) : (
          <LoginScreen />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    color: "#94a3b8",
    marginTop: 12,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    textAlign: "center",
  },
});
