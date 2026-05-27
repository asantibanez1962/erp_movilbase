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
 * Post-push cleanup (importante):
 *   El BE asigna su propio bigint ID a cada created row (IDENTITY). El
 *   row local en WMDB sigue con su local id (UUID-like). Si dejamos el
 *   row local, el próximo pull traería la versión del server como "nueva"
 *   y nos quedaríamos con duplicados.
 *
 *   Solución POC: después del synchronize, eliminamos los local rows
 *   que el BE aceptó. El próximo pull los trae con server id. Los
 *   rejected se marcan con sync_status="rejected" + sync_error para
 *   que la UI los muestre al user.
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

  // Post-sync cleanup. WMDB ya marcó los rows como _status='synced'
  // internamente, pero nuestros local rows tienen id local distinto al
  // server id. Para evitar duplicados en el próximo pull:
  //   - accepted → destroyPermanently (server tiene la versión canonical)
  //   - rejected → mark sync_status='rejected' para que UI los muestre
  await db.write(async () => {
    for (const [collName, resp] of Object.entries(pushResponses)) {
      const accepted = resp.accepted?.[collName] ?? [];
      const rejected = resp.rejected?.[collName] ?? [];

      for (const acc of accepted) {
        const row = await safeFind(db, collName, acc.local_id);
        if (row) await row.destroyPermanently();
      }

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
