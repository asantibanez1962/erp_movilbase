import { create } from "zustand";
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

/**
 * ¿Este aparato ya hablo con SU servidor en esta corrida de la app?
 *
 * Lo decide la puerta del cambio de clave vencida: el endpoint para cambiarla es
 * remoto, asi que exigirsela a un operario sin red lo dejaria encerrado afuera de
 * la app, en planta, sin mas salida que desinstalar.
 *
 * Se marca en el interceptor de RESPUESTA y no a mano en cada llamada: cualquier
 * respuesta del servidor —incluso un 404— prueba que se lo alcanza. Puesto a mano
 * habria que acordarse en cada endpoint nuevo, y olvidarse significaria no pedir
 * nunca la clave.
 */
export const useServidorAlcanzado = create<{ ok: boolean; marcar: () => void }>(
  (set) => ({ ok: false, marcar: () => set({ ok: true }) })
);

api.interceptors.response.use(
  (resp) => {
    useServidorAlcanzado.getState().marcar();
    return resp;
  },
  (err) => {
    // Un error CON respuesta tambien prueba que el servidor esta ahi.
    if (err?.response) useServidorAlcanzado.getState().marcar();
    return Promise.reject(err);
  }
);

api.interceptors.request.use((req) => {
  const compania = useSesion.getState().companyId;
  if (compania != null) req.headers.set("X-Company-Id", String(compania));
  return req;
});

export { TOKEN_KEYS };
