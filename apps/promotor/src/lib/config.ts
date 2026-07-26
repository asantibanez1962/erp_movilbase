import Constants from "expo-constants";
import { SCHEMA_VERSION } from "../db/schema";

/**
 * apiBaseUrl viene de app.json:expo.extra.apiBaseUrl.
 *
 * Defaults:
 *   - Android emulator (AVD)   → http://10.0.2.2:5249    (loopback al host)
 *   - Real Android device WiFi → http://<LAN-IP>:5249    (cambiar en app.json
 *     o setear EXPO_PUBLIC_API_URL al lanzar `expo start`)
 *
 * Para forzar por env var en dev:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.50:5249 pnpm start
 */
export const config = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_URL ??
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    "http://10.0.2.2:5249",
  // NO hay companyId acá a propósito. La empresa la elige el usuario al entrar y
  // vive en el store de sesión (lib/sesion.ts): las zonas autorizadas son por
  // user × empresa, así que hardcodearla haría que el alcance del sync no
  // corresponda al usuario. Leerla de dos lugares es cómo se desincronizan.
  // Tiene que matchear el AppId de mt.MobileCollections — es lo que el manifest
  // usa para saber qué colecciones le tocan a esta app.
  appId: "promotor",
  schemaVersion: SCHEMA_VERSION,
};
