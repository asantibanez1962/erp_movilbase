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
  await runSync(database, {
    api,
    collections: ["productores", "recibos"],
    schemaVersion: 2,
  });
}
