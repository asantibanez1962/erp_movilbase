import * as SecureStore from "expo-secure-store";
import { TOKEN_KEYS } from "@erp/shared-api";

/**
 * UUID estable por instalación del app. Generado la primera vez que se
 * abre + persistido en SecureStore. Se manda como X-Device-Id en cada
 * call de sync (BE lo guarda en mt.MobileSyncLog para troubleshooting).
 *
 * crypto.randomUUID() está disponible en React Native 0.85+ vía polyfill
 * de expo. Fallback manual por las dudas.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(TOKEN_KEYS.DEVICE_ID);
  if (existing) return existing;

  const uuid = randomUUID();
  await SecureStore.setItemAsync(TOKEN_KEYS.DEVICE_ID, uuid);
  return uuid;
}

function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC4122 v4 fallback manual.
  const rnd = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
  return `${rnd(8)}-${rnd(4)}-4${rnd(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${rnd(3)}-${rnd(12)}`;
}
