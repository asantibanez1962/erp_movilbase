import { runSync } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";

/**
 * Trigger manual de sincronización. Llamado desde:
 *   - bootstrapApi() post-login (sync inicial)
 *   - botón "Sincronizar" en ProductoresScreen
 *   - eventualmente desde FCM hint handler (Phase D)
 */
export async function syncNow(): Promise<void> {
  const api = getSyncClient();
  // El resultado trae `fallos` por colección desde que el sync es resiliente. Acá se
  // ignora a propósito: esta app tiene dos colecciones y todavía no muestra el detalle.
  await runSync(database, {
    api,
    collections: ["productores", "recibos"],
    schemaVersion: 2,
  });
}
