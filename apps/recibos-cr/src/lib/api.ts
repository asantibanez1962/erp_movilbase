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

  syncClient = new SyncApi(httpClient, config.companyId);
}

export function getSyncClient(): SyncApi {
  if (!syncClient) throw new Error("bootstrapApi() no fue llamado todavía");
  return syncClient;
}
