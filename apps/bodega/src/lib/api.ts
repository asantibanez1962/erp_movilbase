import { createApiClient, TokenStore, TOKEN_KEYS } from "@erp/shared-api";
import * as SecureStore from "expo-secure-store";
import { urlServidor } from "./servidor";
import { getOrCreateDeviceId } from "./deviceId";
import { useSesion } from "./sesion";

/**
 * Cliente HTTP de la app de bodega.
 *
 * X-Company-Id VA EN EL INTERCEPTOR, no en cada llamada. Todo lo que consulta
 * esta app está scopeado por compañía —bodegas, ubicaciones, partidas— y el
 * backend rechaza con "X-Company-Id header is required" cualquier request que
 * no lo traiga. En la app del promotor se pone llamada por llamada y es fácil
 * olvidarlo en una nueva; acá se pone una vez y no hay forma de saltárselo.
 */

const tokenStore: TokenStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

export const api = createApiClient({
  baseURL: () => urlServidor(),
  tokenStore,
  getDeviceId: getOrCreateDeviceId,
  onUnauthorized: async () => {
    // Sin refresh: la sesión de bodega es corta y el operario está en planta.
    // Que vuelva a entrar es más simple y más claro que un refresh silencioso
    // que puede fallar a mitad de un movimiento.
    await useSesion.getState().cerrar();
    return null;
  },
});

api.interceptors.request.use((req) => {
  const compania = useSesion.getState().companyId;
  if (compania != null) req.headers.set("X-Company-Id", String(compania));
  return req;
});

export { TOKEN_KEYS };
