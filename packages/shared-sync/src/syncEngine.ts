import { Database, Model } from "@nozbe/watermelondb";
import { synchronize } from "@nozbe/watermelondb/sync";
import type { SyncApi } from "@erp/shared-api";
import type { PushResponse } from "@erp/shared-types";

/**
 * Bridge entre el SyncApi (HTTP contra BE) y WMDB synchronize().
 *
 * WMDB.synchronize() llama:
 *   - pullChanges(lastPulledAt, schemaVersion, migration) → ChangeSet
 *   - pushChanges(changes, lastPulledAt) → void (cuando hay cambios locales)
 *
 * Mapping:
 *   - El shape ChangeSet { table: { created, updated, deleted } } matchea
 *     directo el CollectionChanges del BE — una sola línea de pasaje.
 *   - WMDB espera que la response de pull tenga TODAS las tablas del
 *     schema, aunque vengan vacías — normalize las rellena.
 *
 * Post-push cleanup:
 *   Colecciones push-only (ej. recibos):
 *
 *   ACEPTADOS: NO se mutan localmente. Por qué: cualquier write desde código
 *   de app (incluido row.update({ pushStatus: 'synced' })) le indica a WMDB
 *   "cambio local pendiente" → flippea _status de 'synced' → 'updated'. En
 *   el próximo sync, WMDB lo re-pushea pensando que tiene cambios — el BE no
 *   tiene idempotency key por local_id y crea fila duplicada. Solución:
 *   dejar al WMDB manejar su propio _status='synced' que ya sale automático
 *   post-pushChanges. La UI distingue "Enviados" usando r.syncStatus directo
 *   (no necesitamos un campo custom paralelo).
 *
 *   RECHAZADOS: push_status='rejected' + push_error con motivo. Esto sí
 *   flippea _status a 'updated' — DESEADO: queremos que WMDB lo reintente
 *   en el próximo sync (no hay row en BE → no hay duplicado).
 */

export interface SyncOptions {
  collections: string[];
  api: SyncApi;
  schemaVersion: number;
}

type ChangeBucket = {
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  deleted: string[];
};

export async function runSync(
  db: Database,
  opts: SyncOptions
): Promise<void> {
  // Captura responses de pushChanges para procesar accepted/rejected
  // post-synchronize. WMDB no nos deja devolverlas directo (pushChanges
  // espera void), pero el closure las acumula sin problema.
  const pushResponses: Record<string, PushResponse> = {};

  await synchronize({
    database: db,

    pullChanges: async ({ lastPulledAt }) => {
      // WMDB usa null/undefined al primer sync; el BE acepta last_pulled_at
      // null como "traeme cualquier cambio". Convertimos undefined → null.
      const lastPulledAtMs = lastPulledAt ?? null;

      // Una request por collection. En paralelo — el BE las maneja
      // independientes (no hay tx cross-collection en pull).
      const responses = await Promise.all(
        opts.collections.map(async (name) => {
          const resp = await opts.api.pull(name, {
            last_pulled_at: lastPulledAtMs,
            schema_version: opts.schemaVersion,
          });
          return { name, resp };
        })
      );

      // Reduce a un único ChangeSet { table: changes }. Cualquier table
      // que NO vino en la response queda como empty (WMDB lo exige).
      // Casteamos a Record<string, any> porque WMDB tipea TableName como
      // string-template específica y armamos el shape dinámicamente.
      const changes: Record<string, ChangeBucket> = {};
      for (const c of opts.collections) {
        changes[c] = { created: [], updated: [], deleted: [] };
      }
      for (const { name, resp } of responses) {
        const collChanges = resp.changes[name];
        if (collChanges) {
          changes[name] = {
            created: collChanges.created,
            updated: collChanges.updated,
            deleted: collChanges.deleted,
          };
        }
      }

      const timestamp = responses.at(-1)?.resp.timestamp ?? Date.now();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { changes: changes as any, timestamp };
    },

    pushChanges: async ({ changes, lastPulledAt }) => {
      const buckets = changes as unknown as Record<string, ChangeBucket>;

      for (const [collName, bucket] of Object.entries(buckets)) {
        const isEmpty =
          bucket.created.length === 0 &&
          bucket.updated.length === 0 &&
          bucket.deleted.length === 0;
        if (isEmpty) continue;

        const resp = await opts.api.push(collName, {
          changes: { [collName]: bucket },
          last_pulled_at: lastPulledAt,
        });
        pushResponses[collName] = resp;
      }
    },

    sendCreatedAsUpdated: true,
  });

  // Post-sync cleanup para colecciones push-only:
  //   - ACCEPTED: nada. WMDB ya marcó _status='synced' automáticamente al
  //     resolver pushChanges sin error. NO escribimos a campos custom porque
  //     eso flipparía _status → 'updated' → loop de re-push + duplicados.
  //   - REJECTED: marcamos push_status='rejected' + push_error. El flip a
  //     _status='updated' es deseado (queremos retry en próximo sync; no
  //     hay row en BE → no hay duplicado).
  await db.write(async () => {
    for (const [collName, resp] of Object.entries(pushResponses)) {
      const rejected = resp.rejected?.[collName] ?? [];
      for (const rej of rejected) {
        const row = await safeFind(db, collName, rej.local_id);
        if (row) {
          await row.update((rec: Model & { pushStatus?: string | null; pushError?: string | null }) => {
            rec.pushStatus = "rejected";
            rec.pushError = `${rej.reason}: ${rej.message}`;
          });
        }
      }
    }
  });
}

async function safeFind(
  db: Database,
  collection: string,
  id: string
): Promise<Model | null> {
  try {
    return await db.get(collection).find(id);
  } catch {
    return null;
  }
}
