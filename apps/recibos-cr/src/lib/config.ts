import Constants from "expo-constants";

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
  companyId: 8, // POC hardcoded; al meter selector de empresa lo movemos a state.
  appId: "recibos-cr",
  schemaVersion: 1,
};
