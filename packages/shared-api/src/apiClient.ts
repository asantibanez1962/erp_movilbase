import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { TokenStore, TOKEN_KEYS } from "./tokenStore";

/**
 * Configuración del API client compartido. Cada app instancia un cliente
 * pasando su baseURL + tokenStore + handler de refresh (delegado al
 * authApi de cada app para evitar dependencia circular).
 */
export interface ApiClientConfig {
  baseURL: string;
  tokenStore: TokenStore;
  /** Llamada cuando el access token devuelve 401. Debe intentar refresh y
   *  resolver con el nuevo access token, o rechazar para forzar logout. */
  onUnauthorized: () => Promise<string | null>;
  /** Device id (uuid persistente). Se envía como X-Device-Id en cada call sync. */
  getDeviceId: () => Promise<string>;
}

export function createApiClient(config: ApiClientConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseURL,
    timeout: 30_000,
    headers: { "Content-Type": "application/json" },
  });

  // Request: attach Bearer + X-Client-Kind + X-Device-Id (latter solo para sync).
  client.interceptors.request.use(async (req: InternalAxiosRequestConfig) => {
    const access = await config.tokenStore.get(TOKEN_KEYS.ACCESS);
    if (access) {
      req.headers.set("Authorization", `Bearer ${access}`);
    }
    req.headers.set("X-Client-Kind", "mobile");

    // Device-Id solo en endpoints de sync (donde el BE lo requiere).
    const url = req.url ?? "";
    if (url.startsWith("/api/sync") || url.includes("api/sync")) {
      const deviceId = await config.getDeviceId();
      req.headers.set("X-Device-Id", deviceId);
    }
    return req;
  });

  // Response: 401 → intentar refresh una vez antes de fallar definitivo.
  // Flag _retried previene loop infinito si el refresh también devuelve 401.
  let refreshPromise: Promise<string | null> | null = null;
  client.interceptors.response.use(
    (resp) => resp,
    async (err: AxiosError) => {
      const original = err.config as
        | (InternalAxiosRequestConfig & { _retried?: boolean })
        | undefined;
      if (!original || err.response?.status !== 401 || original._retried) {
        return Promise.reject(err);
      }
      original._retried = true;

      // Coalesce: si varias requests fallan simultáneamente, una sola
      // dispara el refresh; las demás esperan al mismo promise.
      if (!refreshPromise) {
        refreshPromise = config.onUnauthorized().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccess = await refreshPromise;
      if (!newAccess) return Promise.reject(err);

      original.headers.set("Authorization", `Bearer ${newAccess}`);
      return client.request(original);
    }
  );

  return client;
}
