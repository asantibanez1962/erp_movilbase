import axios from "axios";
import { create } from "zustand";
import { AuthApi, AuthError } from "./authApi";
import { TokenStore, TOKEN_KEYS } from "./tokenStore";

/**
 * "Network error" = no llegamos al server. Axios sin response object,
 * o codes específicos (ECONNREFUSED, ETIMEDOUT, etc.). Distinto a
 * "auth error" = el server respondió pero rechazó el token.
 */
function isNetworkError(e: unknown): boolean {
  if (axios.isAxiosError(e)) {
    return !e.response; // no response = no llegó al server
  }
  // AuthError tiene code de auth — NO es network
  if (e instanceof AuthError) return false;
  return false;
}

/**
 * Estado de auth global. Mantiene el access token + user en memoria para
 * decisión sincrónica (¿está logueado?), y el refresh token solo en
 * SecureStore (nunca en memoria de UI).
 *
 * Uso típico desde el app:
 *   await useAuthStore.getState().init({ baseURL, tokenStore });
 *   await useAuthStore.getState().login(usuario, password);
 *
 * El init hidrata el state desde SecureStore al boot — si hay refresh
 * token vivo, queda autenticado sin pedir credenciales.
 */

interface UserSummary {
  id: number;
  usuario: string;
}

interface AuthState {
  accessToken: string | null;
  user: UserSummary | null;
  passwordExpired: boolean;
  isAuthenticated: boolean;
  isInitializing: boolean;

  // Wired al init() — el store los necesita para llamar refresh + persistir.
  _api: AuthApi | null;
  _store: TokenStore | null;

  init: (cfg: { baseURL: string; tokenStore: TokenStore }) => Promise<void>;
  login: (usuario: string, password: string) => Promise<void>;
  refresh: () => Promise<string | null>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  passwordExpired: false,
  isAuthenticated: false,
  isInitializing: true,
  _api: null,
  _store: null,

  async init({ baseURL, tokenStore }) {
    const api = new AuthApi(baseURL);
    set({ _api: api, _store: tokenStore });

    const refresh = await tokenStore.get(TOKEN_KEYS.REFRESH);
    const cachedAccess = await tokenStore.get(TOKEN_KEYS.ACCESS);
    const cachedUserRaw = await tokenStore.get(TOKEN_KEYS.USER);

    if (!refresh) {
      // No hay refresh persistido → forzosamente login fresco
      set({ isInitializing: false });
      return;
    }

    // Offline-first: si hay tokens cacheados los aplicamos YA antes de
    // intentar el refresh. Así el user entra a la app aunque esté sin
    // internet, viendo data cacheada (productores en WMDB local).
    if (cachedAccess && cachedUserRaw) {
      try {
        const cachedUser = JSON.parse(cachedUserRaw) as UserSummary;
        set({
          accessToken: cachedAccess,
          user: cachedUser,
          isAuthenticated: true,
        });
      } catch {
        // raw inválido — ignoramos y dejamos que el refresh decida
      }
    }

    // Intentamos refresh para conseguir tokens frescos. Si falla:
    //   - Network error (offline) → mantenemos estado cacheado, no wipe.
    //     Cuando vuelva el internet, el próximo 401-retry en apiClient
    //     dispara un refresh real; mientras tanto el access cacheado
    //     puede estar vencido pero el user al menos ve sus datos.
    //   - Auth error (token revocado/expirado del lado server) → wipe.
    try {
      const resp = await api.refresh({ refreshToken: refresh });
      await tokenStore.set(TOKEN_KEYS.ACCESS, resp.accessToken);
      await tokenStore.set(TOKEN_KEYS.REFRESH, resp.refreshToken);
      await tokenStore.set(TOKEN_KEYS.USER, JSON.stringify(resp.user));
      set({
        accessToken: resp.accessToken,
        user: resp.user,
        passwordExpired: resp.passwordExpired,
        isAuthenticated: true,
        isInitializing: false,
      });
    } catch (e) {
      if (isNetworkError(e)) {
        // Offline — mantener estado cacheado (si lo aplicamos arriba).
        set({ isInitializing: false });
      } else {
        // Auth error real → wipe.
        await tokenStore.remove(TOKEN_KEYS.ACCESS);
        await tokenStore.remove(TOKEN_KEYS.REFRESH);
        await tokenStore.remove(TOKEN_KEYS.USER);
        set({
          accessToken: null,
          user: null,
          isAuthenticated: false,
          isInitializing: false,
        });
      }
    }
  },

  async login(usuario, password) {
    const { _api, _store } = get();
    if (!_api || !_store) throw new Error("AuthStore no inicializado");

    const resp = await _api.login({ usuario, password });
    await _store.set(TOKEN_KEYS.ACCESS, resp.accessToken);
    await _store.set(TOKEN_KEYS.REFRESH, resp.refreshToken);
    await _store.set(TOKEN_KEYS.USER, JSON.stringify(resp.user));
    set({
      accessToken: resp.accessToken,
      user: resp.user,
      passwordExpired: resp.passwordExpired,
      isAuthenticated: true,
    });
  },

  async refresh() {
    const { _api, _store } = get();
    if (!_api || !_store) return null;

    const refresh = await _store.get(TOKEN_KEYS.REFRESH);
    if (!refresh) return null;

    try {
      const resp = await _api.refresh({ refreshToken: refresh });
      await _store.set(TOKEN_KEYS.ACCESS, resp.accessToken);
      await _store.set(TOKEN_KEYS.REFRESH, resp.refreshToken);
      set({
        accessToken: resp.accessToken,
        user: resp.user,
        passwordExpired: resp.passwordExpired,
        isAuthenticated: true,
      });
      return resp.accessToken;
    } catch (e) {
      // Network error → no wipe, user sigue offline con tokens viejos.
      // El próximo call HTTP fallará con 401, el apiClient lo capturará
      // y eventualmente le devolverá el error al UI para mostrar "sin conexión".
      if (isNetworkError(e)) return null;
      // Auth error real (server rechazó) → wipe.
      await get().logout();
      if (e instanceof AuthError) throw e;
      return null;
    }
  },

  async logout() {
    const { _store } = get();
    if (_store) {
      await _store.remove(TOKEN_KEYS.ACCESS);
      await _store.remove(TOKEN_KEYS.REFRESH);
      await _store.remove(TOKEN_KEYS.USER);
    }
    set({
      accessToken: null,
      user: null,
      passwordExpired: false,
      isAuthenticated: false,
    });
  },
}));
