/**
 * Token storage abstraction. Provee 2 implementaciones:
 *   - InMemoryTokenStore: para dev / tests (no persiste).
 *   - SecureTokenStore: para producción mobile (usa expo-secure-store
 *     → encrypted keystore en Android, Keychain en iOS).
 *
 * El consumidor decide cuál usar al boot del app (ver useAuthStore.init).
 * Mantenemos el interface chico — solo lo que el flow auth/sync necesita.
 */

export interface TokenStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * SecureStore-backed implementation. Acepta el modulo de expo-secure-store
 * inyectado para no depender de runtime en el package shared.
 *
 * Uso desde apps:
 *   import * as SecureStore from "expo-secure-store";
 *   const store = new SecureTokenStore(SecureStore);
 */
export interface SecureStoreModule {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class SecureTokenStore implements TokenStore {
  constructor(private readonly mod: SecureStoreModule) {}

  async get(key: string): Promise<string | null> {
    return this.mod.getItemAsync(key);
  }
  async set(key: string, value: string): Promise<void> {
    return this.mod.setItemAsync(key, value);
  }
  async remove(key: string): Promise<void> {
    return this.mod.deleteItemAsync(key);
  }
}

export const TOKEN_KEYS = {
  ACCESS: "erp.access_token",
  REFRESH: "erp.refresh_token",
  USER: "erp.user",
  DEVICE_ID: "erp.device_id",
} as const;
