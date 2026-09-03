import * as SecureStore from "expo-secure-store";
import {
  createApiClient,
  SecureTokenStore,
  SyncApi,
  useAuthStore,
} from "@erp/shared-api";
import { config } from "./config";
import { getOrCreateDeviceId } from "./deviceId";
import { cargarUrlServidor } from "./servidor";
import { contextoActual } from "./sesion";

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
  // 0. La dirección del servidor ANTES que nada: el auth store y el cliente axios
  //    la resuelven en cada llamada, así que esto es sólo para que la primera request
  //    no tenga que esperar a SecureStore.
  const url = await cargarUrlServidor();

  // Se deja dicho en el log a proposito. "¿A que servidor esta hablando este
  // telefono?" es la primera pregunta de cualquier diagnostico en campo, y hasta
  // ahora habia que ir a buscarla a una pantalla — o adivinarla, que ya costo dos
  // vueltas de pruebas creyendo que la app fallaba cuando le hablaba a otra base.
  console.info(`[api] servidor en uso: ${url}`);

  // 1. Hidrata auth store desde SecureStore (refresh token vivo → arrancamos
  //    logueado sin pedir credenciales).
  //    ⚠️ La dirección va como FUNCIÓN, no como valor. Con el valor, cambiar de servidor
  //    desde el drawer mostraba la dirección nueva en pantalla mientras las requests
  //    seguían yendo a la vieja, hasta reiniciar la app.
  await useAuthStore.getState().init({
    baseURL: () => config.apiBaseUrl,
    tokenStore,
  });

  // 2. Crear axios + sync API una sola vez.
  httpClient = createApiClient({
    baseURL: () => config.apiBaseUrl,
    tokenStore,
    onUnauthorized: () => useAuthStore.getState().refresh(),
    getDeviceId: getOrCreateDeviceId,
  });

  // Contexto como getter: empresa y cosecha las elige el usuario después del
  // login y puede cambiarlas sin reconstruir el cliente.
  syncClient = new SyncApi(httpClient, contextoActual);
}

export function getSyncClient(): SyncApi {
  if (!syncClient) throw new Error("bootstrapApi() no fue llamado todavía");
  return syncClient;
}

/**
 * El axios crudo, para lo que no pasa por el contrato de sync — hoy solo el
 * upload de fotos a /attachments (multipart, no JSON).
 */
export function getHttpClient(): ReturnType<typeof createApiClient> {
  if (!httpClient) throw new Error("bootstrapApi() no fue llamado todavía");
  return httpClient;
}
