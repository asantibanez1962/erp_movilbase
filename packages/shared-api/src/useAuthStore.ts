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

/**
 * Guarda la sesión en el almacenamiento seguro, en orden de IMPORTANCIA.
 *
 * El orden no es cosmético. Antes se guardaba el access token primero, y es el más
 * grande —el JWT de un promotor con muchos permisos ronda los 2048 bytes que
 * SecureStore avisa que puede no poder guardar—. Si esa escritura fallaba, las dos
 * siguientes NO se ejecutaban, y son justamente las que permiten entrar sin señal.
 *
 * El síntoma era desconcertante: el login funcionaba, se podía trabajar y sincronizar
 * toda la sesión —los tokens estaban en memoria— y recién al reabrir la app aparecía
 * la pantalla de login, sin red para poder pasarla, con el trabajo del día adentro.
 *
 * Ahora primero van refresh y user, que son chicos y sostienen el arranque offline, y
 * el access token al final: es el prescindible, porque se repone con un refresh en
 * cuanto haya conexión.
 *
 * Cada escritura va aislada: que falle una no puede costar las otras. Y se loguea,
 * porque un fallo silencioso acá no se manifiesta hasta el próximo arranque.
 */
async function persistirSesion(
  store: TokenStore,
  accessToken: string,
  refreshToken: string,
  user: UserSummary
): Promise<void> {
  const guardar = async (clave: string, valor: string, critico: boolean) => {
    try {
      await store.set(clave, valor);
    } catch (e) {
      console.warn(
        `[auth] no se pudo guardar ${clave} (${valor.length} bytes)` +
          `${critico ? " — CRÍTICO: no va a poder entrar sin señal" : ""}`,
        (e as Error)?.message
      );
    }
  };

  await guardar(TOKEN_KEYS.REFRESH, refreshToken, true);
  await guardar(TOKEN_KEYS.USER, JSON.stringify(user), true);
  await guardar(TOKEN_KEYS.ACCESS, accessToken, false);
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

    // Qué se pudo recuperar de SecureStore. Es diagnóstico deliberado: el arranque
    // offline depende de estas tres claves y, cuando falla, desde afuera se ve
    // simplemente "pide login" — sin forma de saber cuál faltó. El access token ronda
    // el límite de 2048 bytes de SecureStore, así que su ausencia es esperable.
    console.info(
      `[auth] cache: refresh=${refresh ? "si" : "NO"} ` +
        `access=${cachedAccess ? cachedAccess.length + "b" : "NO"} ` +
        `user=${cachedUserRaw ? "si" : "NO"}`
    );

    if (!refresh) {
      // No hay refresh persistido → forzosamente login fresco.
      // OJO: este corte es anterior al camino offline de abajo, así que si el refresh
      // no se guardó, no hay entrada sin red por más que el usuario esté cacheado.
      console.info("[auth] sin refresh token: se exige login");
      set({ isInitializing: false });
      return;
    }

    // Offline-first: si hay sesión cacheada la aplicamos YA, antes de intentar el
    // refresh. Así el usuario entra aunque no haya internet y trabaja con lo que tiene
    // en la base local.
    //
    // La condición NO exige el access token, y eso importa: antes pedía
    // `cachedAccess && cachedUserRaw`, y si el access no estaba, el usuario terminaba
    // en la pantalla de login sin poder pasar —sin red no hay forma de loguearse— con
    // su trabajo del día adentro del teléfono. Es el peor escenario posible para una
    // app cuyo motivo de existir es funcionar sin señal.
    //
    // Y el access token puede FALTAR legítimamente: SecureStore avisa que por encima
    // de ~2048 bytes puede no guardar, y el JWT de un promotor con muchos permisos
    // ronda ese tamaño. O sea que el arranque offline dependía de que el token entrara
    // justo. (Achicar el JWT es el arreglo de fondo, del lado del servidor.)
    //
    // Entrar sin access token es correcto: uno vencido no sirve más que uno ausente
    // —el código ya toleraba el vencido— y el refresh lo repone en cuanto haya red.
    if (cachedUserRaw) {
      try {
        const cachedUser = JSON.parse(cachedUserRaw) as UserSummary;
        set({
          accessToken: cachedAccess ?? null,
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
      await persistirSesion(tokenStore, resp.accessToken, resp.refreshToken, resp.user);
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
    await persistirSesion(_store, resp.accessToken, resp.refreshToken, resp.user);
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
