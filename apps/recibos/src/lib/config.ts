import { SCHEMA_VERSION } from "../db/schema";
import { urlServidor } from "./servidor";

/**
 * `apiBaseUrl` la resuelve lib/servidor.ts combinando cuatro fuentes por precedencia:
 * el override guardado en el teléfono, la env var de dev, la del cliente compilado y el
 * loopback del emulador.
 *
 * Es un GETTER y no un valor fijo porque el override puede cambiar en caliente. Con un
 * valor congelado en el import, cambiarlo mostraría la dirección nueva en la UI mientras
 * las requests seguirían yendo a la vieja.
 */
export const config = {
  get apiBaseUrl(): string {
    return urlServidor();
  },
  /**
   * Tiene que coincidir con el AppId de mt.MobileCollections: es lo que el manifest usa
   * para saber qué colecciones le tocan a esta app. Con el valor equivocado el teléfono
   * bajaría las de promotor.
   */
  appId: "recibos",
  schemaVersion: SCHEMA_VERSION,
};
