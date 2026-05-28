import { Q } from "@nozbe/watermelondb";
import { createDatabase, Recibo } from "@erp/shared-sync";

/**
 * Singleton de la WMDB Database del app. Llamado UNA vez al boot del app
 * (en bootstrapApi). Después se importa desde donde se necesite.
 */
export const database = createDatabase({ dbName: "recibos-cr" });

/**
 * TTL para purga de recibos ya sincronizados. Los recibos enviados quedan
 * en cache local para "Enviados" (consulta offline + reimpresión), pero
 * pasados X días se borran silenciosamente al boot para que la DB no
 * crezca sin techo. 30 días cubre auditoría operativa típica (cierre
 * mensual + un par de días de margen). Cambiable si el cliente pide más.
 */
const SYNCED_RECIBOS_TTL_DAYS = 30;

/**
 * Borra silenciosamente los recibos con push_status='synced' cuya
 * syncUpdatedAt sea más vieja que SYNCED_RECIBOS_TTL_DAYS. Llamado UNA
 * vez al boot del app post-bootstrap. No corre durante operación normal
 * para evitar borrar rows que el user acaba de ver/reimprimir.
 *
 * No-op si no hay match — el query es indexed por sync_updated_at así
 * que el costo es despreciable aunque la tabla crezca.
 *
 * Errores se logean y no rompen el boot — la purga es best-effort.
 */
export async function purgeOldSyncedRecibos(): Promise<void> {
  try {
    const cutoffMs = Date.now() - SYNCED_RECIBOS_TTL_DAYS * 24 * 60 * 60 * 1000;
    const old = await database
      .get<Recibo>("recibos")
      .query(
        Q.where("push_status", "synced"),
        Q.where("sync_updated_at", Q.lt(cutoffMs))
      )
      .fetch();

    if (old.length === 0) return;

    await database.write(async () => {
      for (const r of old) {
        await r.destroyPermanently();
      }
    });

    console.log(`[purge] eliminados ${old.length} recibos synced > ${SYNCED_RECIBOS_TTL_DAYS} días`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[purge] failed", msg);
  }
}
