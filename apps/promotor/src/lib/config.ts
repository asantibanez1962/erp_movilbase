import { SCHEMA_VERSION } from "../db/schema";
import { urlServidor } from "./servidor";

/**
 * apiBaseUrl la resuelve lib/servidor.ts, que combina cuatro fuentes por precedencia:
 * el override guardado en el teléfono, la del cliente compilado (clientes.json), la
 * env var de dev y el loopback del emulador.
 *
 * Es un GETTER y no un valor fijo porque el override puede cambiar en caliente desde
 * la pantalla de servidor. Con un valor congelado en el import, cambiarlo mostraría
 * la dirección nueva en la UI mientras las requests seguirían yendo a la vieja —
 * exactamente el tipo de discrepancia que hace perder una tarde de diagnóstico.
 *
 * Para forzar por env var en dev:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.50:5249 pnpm start
 */
export const config = {
  get apiBaseUrl(): string {
    return urlServidor();
  },
  // NO hay companyId acá a propósito. La empresa la elige el usuario al entrar y
  // vive en el store de sesión (lib/sesion.ts): las zonas autorizadas son por
  // user × empresa, así que hardcodearla haría que el alcance del sync no
  // corresponda al usuario. Leerla de dos lugares es cómo se desincronizan.
  // Tiene que matchear el AppId de mt.MobileCollections — es lo que el manifest
  // usa para saber qué colecciones le tocan a esta app.
  appId: "promotor",
  schemaVersion: SCHEMA_VERSION,
};
