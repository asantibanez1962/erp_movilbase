import { create } from "zustand";
import { AuthApi, AuthError } from "./authApi";
import { TokenStore, TOKEN_KEYS } from "./tokenStore";

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

    // Si hay refresh token persistido, intentamos refresh para arrancar logueado.
    const refresh = await tokenStore.get(TOKEN_KEYS.REFRESH);
    if (!refresh) {
      set({ isInitializing: false });
      return;
    }

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
    } catch {
      // Refresh fail = token expirado/revocado. Limpiar y arrancar fresco.
      await tokenStore.remove(TOKEN_KEYS.ACCESS);
      await tokenStore.remove(TOKEN_KEYS.REFRESH);
      await tokenStore.remove(TOKEN_KEYS.USER);
      set({ isInitializing: false });
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
      // Refresh fail → wipe everything → user re-loguea.
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
