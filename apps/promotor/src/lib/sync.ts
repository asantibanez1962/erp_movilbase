import { runSync } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";
import { config } from "./config";
import { COLLECTIONS } from "../db/schema";
import { flushPendingUploads } from "./fotos";

/**
 * Trigger manual de sincronización. Llamado desde:
 *   - bootstrapApi() post-login (sync inicial)
 *   - botón "Sincronizar" del drawer
 *   - al guardar una visita/solicitud si hay conexión
 *
 * El orden de COLLECTIONS importa: el push respeta ese orden para que
 * `solicitudes` suba antes que `entregadores` y `visitas`, que la referencian.
 * Ver el comentario en syncEngine.pushChanges.
 *
 * Las fotos NO viajan por acá (el contrato de sync es JSON): se suben después,
 * cuando las visitas ya tienen id de servidor.
 */
export async function syncNow(): Promise<void> {
  const api = getSyncClient();

  const pushResponses = await runSync(database, {
    api,
    collections: [...COLLECTIONS],
    schemaVersion: config.schemaVersion,
  });

  // Best-effort: si falla, las fotos quedan encoladas para el próximo sync.
  // No propagamos — el sync de datos ya fue exitoso y el usuario no puede
  // hacer nada distinto con el error.
  try {
    await flushPendingUploads(pushResponses);
  } catch (err) {
    console.warn("flushPendingUploads falló; las fotos siguen encoladas", err);
  }
}
