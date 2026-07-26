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
  // POC hardcoded; al meter selector de empresa se mueve a state (ver "Selector
  // de empresa" en docs/produccion.md).
  //
  // 1, no 8: en sci_altura_2026 hay UNA sola empresa (ge_companias.Id = 1) y todos
  // los datos de RC cuelgan de ella. recibos-cr usa 8 porque se desarrolló contra
  // otra base — no copiar ese valor.
  companyId: 1,
  // Tiene que matchear el AppId de mt.MobileCollections — es lo que el manifest
  // usa para saber qué colecciones le tocan a esta app.
  appId: "promotor",
  schemaVersion: SCHEMA_VERSION,
};
