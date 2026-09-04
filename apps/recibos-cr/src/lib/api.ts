import * as SecureStore from "expo-secure-store";
import {
  createApiClient,
  SecureTokenStore,
  SyncApi,
  useAuthStore,
} from "@erp/shared-api";
import { config } from "./config";
import { getOrCreateDeviceId } from "./deviceId";

/**
 * Wiring entre los packages compartidos y el runtime del app.
 *
 * El TokenStore = SecureStore (encrypted keystore Android). El api client
 * conecta los 3 hooks que necesita: leer access token, refrescar on 401,
 * obtener device id en cada request de sync.
 */

const tokenStore = new SecureTokenStore(SecureStore);

let httpClient: ReturnType<typeof createApiClient> | null = null;
let syncClient: SyncApi | null = null;

export async function bootstrapApi(): Promise<void> {
  // Acá la direccion sale fija del build (no hay override en runtime como en
  // promotor o bodega), pero se deja dicha igual: en un diagnostico a distancia
  // "¿a que servidor le habla este aparato?" es la primera pregunta, y con dos
  // APK del mismo cliente instalados la respuesta no es obvia.
  console.info(`[api] servidor en uso: ${config.apiBaseUrl}`);

  // 1. Hidrata auth store desde SecureStore (refresh token vivo → arrancamos
  //    logueado sin pedir credenciales).
  await useAuthStore.getState().init({
    baseURL: config.apiBaseUrl,
    tokenStore,
  });

  // 2. Crear axios + sync API una sola vez.
  httpClient = createApiClient({
    baseURL: config.apiBaseUrl,
    tokenStore,
    onUnauthorized: () => useAuthStore.getState().refresh(),
    getDeviceId: getOrCreateDeviceId,
  });

  // SyncApi ahora toma el contexto como getter (empresa + cosecha), porque en la
  // app promotor el usuario las elige después del login. Acá la empresa sigue
  // siendo la de config y no hay cosecha, así que el getter es constante.
  syncClient = new SyncApi(httpClient, () => ({ companyId: config.companyId }));
}

export function getSyncClient(): SyncApi {
  if (!syncClient) throw new Error("bootstrapApi() no fue llamado todavía");
  return syncClient;
}
