import { Database, Model } from "@nozbe/watermelondb";
import { synchronize } from "@nozbe/watermelondb/sync";
import type { SyncApi } from "@erp/shared-api";
import type { PullResponse, PushResponse } from "@erp/shared-types";

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
 *   RECHAZADOS: se devuelven en experimentalRejectedIds para que WMDB NO los
 *   marque como sincronizados, y además se les escribe push_status/push_error
 *   para que la UI muestre el motivo.
 *
 *   Antes se confiaba sólo en ese write: al escribirle a una fila ya marcada
 *   como synced, _status volteaba a 'updated' y WMDB la reintentaba. Pero
 *   entonces viajaba en changes.updated, que el BE rechaza con NOT_SUPPORTED —
 *   la fila quedaba reintentándose para siempre sin poder crearse nunca. Con
 *   experimentalRejectedIds se queda en 'created' y se reintenta como corresponde.
 */

export interface SyncOptions {
  collections: string[];
  api: SyncApi;
  schemaVersion: number;
  /**
   * Retención por colección: decide si una fila creada localmente ya puede
   * enviarse. Devolver false la deja en el teléfono para el próximo intento.
   *
   * Existe por las colecciones con política `hasta-evento`: un recibo de café se
   * puede corregir mientras no se imprime, y recién al imprimirse queda firme y
   * puede subir. WatermelonDB no sabe de eso — empuja todo lo que tenga
   * _status != 'synced' — así que la retención tiene que hacerse acá.
   *
   * Sin la función, se envía todo (comportamiento de `automatica` y `hasta-sync`).
   */
  puedeEnviar?: (coleccion: string, fila: Record<string, unknown>) => boolean;
}

type ChangeBucket = {
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  deleted: string[];
};

/**
 * Devuelve las responses del push por colección. Quien llame puede necesitar los
 * `accepted[]` para trabajo que depende del id del servidor — hoy, subir las
 * fotos de una visita a /attachments/Visita/{serverId}.
 *
 * Se devuelven en vez de escribir el server id en la fila local a propósito:
 * cualquier write sobre una fila ya sincronizada la marca como 'updated' y WMDB
 * la re-pushea en el sync siguiente (ver la nota larga arriba).
 */
export async function runSync(
  db: Database,
  opts: SyncOptions
): Promise<Record<string, PushResponse>> {
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
      //
      // allSettled y no all: con `all`, el primer rechazo aborta y el error que sale
      // no dice QUÉ colección falló. Un permiso faltante en un catálogo de 11 filas
      // se veía como "Error de sincronización" a secas, en las tres pantallas, sin
      // forma de diagnosticarlo desde el teléfono — hubo que ir a leer el log del
      // servidor.
      //
      // Se sigue tirando si alguna falla: `synchronize()` es atómico a propósito y
      // devolver las que sí anduvieron haría avanzar el checkpoint GLOBAL, incluido
      // el de la que falló — y sus filas no volverían nunca. Pérdida silenciosa, peor
      // que el fallo ruidoso. El sync parcial de verdad necesita checkpoints por
      // colección; es la etapa siguiente.
      const resultados = await Promise.allSettled(
        opts.collections.map(async (name) => {
          const resp = await opts.api.pull(name, {
            last_pulled_at: lastPulledAtMs,
            schema_version: opts.schemaVersion,
          });
          return { name, resp };
        })
      );

      const fallos: FalloPull[] = [];
      const responses: Array<{ name: string; resp: PullResponse }> = [];
      resultados.forEach((r, i) => {
        if (r.status === "fulfilled") responses.push(r.value);
        else fallos.push(describirFallo(opts.collections[i] ?? "?", r.reason));
      });

      if (fallos.length > 0) {
        for (const f of fallos) {
          console.info(`[sync] pull ${f.coleccion}: ${f.codigo} — ${f.mensaje}`);
        }
        throw new PullFallidoError(fallos);
      }

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

      /**
       * Ids que WMDB NO debe marcar como sincronizados. Dos motivos:
       *
       *  - RETENIDAS: filas que todavía no pueden salir (política hasta-evento,
       *    ej. recibo sin imprimir). Nunca se enviaron.
       *  - RECHAZADAS: el BE las devolvió en rejected[]. No existen en el servidor.
       *
       * Sin esto WMDB marca como synced TODO lo que pasó por pushChanges, y las
       * retenidas se perderían para siempre. Antes los rechazos se manejaban
       * escribiéndoles push_status, lo que volteaba la fila de 'created' a
       * 'updated' — y como el BE rechaza 'updated' con NOT_SUPPORTED, esa fila
       * quedaba reintentándose eternamente sin poder crearse. Con
       * experimentalRejectedIds se quedan en 'created' y se reintentan bien.
       */
      const noMarcarComoSincronizadas: Record<string, string[]> = {};
      const retener = (coleccion: string, id: string) => {
        (noMarcarComoSincronizadas[coleccion] ??= []).push(id);
      };

      // Orden de push = orden de opts.collections, NO el de Object.entries.
      // Importa cuando una colección es hija de otra (entregadores → solicitudes):
      // el BE resuelve la FK del hijo contra mt.MobileIdMap, que sólo tiene la
      // entrada del padre si el padre ya subió. Con el orden del objeto, un hijo
      // podía viajar primero y volver como UNRESOLVED_PARENT — se recuperaba en el
      // sync siguiente, pero mostrándole al usuario un rechazo que no existía.
      //
      // SÓLO se pushea lo declarado en opts.collections.
      //
      // WMDB reporta cambios de TODAS las tablas del schema local, y una app puede
      // tener tablas que a propósito no se sincronizan (acá `pending_uploads`, la
      // cola de fotos, y `server_ids`, el mapeo localId→serverId). Una versión
      // anterior empujaba también las no declaradas "para no perder cambios si el
      // schema se adelanta a la config": el resultado fue un POST a
      // /api/sync/server_ids/push que devolvía 404 COLLECTION_NOT_FOUND y hacía
      // fallar el sync entero.
      //
      // Una tabla que no está en opts.collections no es sincronizable por
      // definición. Si falta una que debería estar, el warning lo deja ver sin
      // romper el sync.
      // Qué trae WMDB para pushear. Si esto sale vacío, el problema está antes del
      // push: no hay cambios locales pendientes que WMDB reconozca.
      const conCambios = Object.entries(buckets)
        .filter(([, b]) => b.created.length + b.updated.length + b.deleted.length > 0)
        .map(([c, b]) => `${c}(${b.created.length}c/${b.updated.length}u/${b.deleted.length}d)`);
      console.info(
        `[sync] cambios locales: ${conCambios.length > 0 ? conCambios.join(" ") : "ninguno"}`
      );

      const declared = opts.collections.filter((c) => c in buckets);
      const noDeclaradas = Object.keys(buckets).filter(
        (c) =>
          !opts.collections.includes(c) &&
          (buckets[c]!.created.length > 0 ||
            buckets[c]!.updated.length > 0 ||
            buckets[c]!.deleted.length > 0)
      );
      if (noDeclaradas.length > 0) {
        console.info(
          `[sync] tablas locales con cambios que NO se pushean: ${noDeclaradas.join(", ")}`
        );
      }

      for (const collName of declared) {
        const bucketCrudo = buckets[collName];
        // Sólo por el índice tipado: la lista sale de claves que existen.
        if (!bucketCrudo) continue;

        // Retención: las filas que todavía no pueden enviarse se quedan. No es un
        // error ni un rechazo — simplemente no les llegó el momento (ej. un recibo
        // sin imprimir). Vuelven a evaluarse en cada sync.
        let bucket = bucketCrudo;
        if (opts.puedeEnviar) {
          const pasa = (f: Record<string, unknown>) => {
            const ok = opts.puedeEnviar!(collName, f);
            if (!ok) retener(collName, String(f.id));
            return ok;
          };
          bucket = {
            created: bucketCrudo.created.filter(pasa),
            updated: bucketCrudo.updated.filter(pasa),
            deleted: bucketCrudo.deleted,
          };
        }

        const isEmpty =
          bucket.created.length === 0 &&
          bucket.updated.length === 0 &&
          bucket.deleted.length === 0;
        if (isEmpty) continue;

        const resp = await opts.api.push(collName, {
          changes: {
            [collName]: {
              // Los creados van completos: la fila no existe en el servidor, así que
              // todo lo que trae es información nueva.
              created: bucket.created.map((f) => limpiarMetadatos(f)),
              // Los modificados van MÍNIMOS — sólo lo que cambió. Ver soloLoCambiado.
              updated: bucket.updated.map((f) => soloLoCambiado(f)),
              deleted: bucket.deleted,
            },
          },
          last_pulled_at: lastPulledAt,
        });
        pushResponses[collName] = resp;

        // Lo que el BE rechazó tampoco se marca como sincronizado: no existe allá.
        const rechazadas = resp.rejected?.[collName] ?? [];
        for (const rej of rechazadas) {
          retener(collName, rej.local_id);
        }

        // El push era una caja negra: no había forma de saber desde afuera si una
        // fila salió, si volvió aceptada o si quedó retenida. Diagnosticar sin
        // esto obligaba a adivinar.
        const aceptadas = resp.accepted?.[collName]?.length ?? 0;
        console.info(
          `[sync] push ${collName}: enviadas=${bucket.created.length}+${bucket.updated.length} ` +
            `aceptadas=${aceptadas} rechazadas=${rechazadas.length}`
        );
        for (const rej of rechazadas) {
          console.info(`[sync]   rechazo ${collName}: ${rej.reason} — ${rej.message}`);
        }
      }

      const retenidasTotal = Object.values(noMarcarComoSincronizadas).flat().length;
      if (retenidasTotal > 0) {
        console.info(
          `[sync] ${retenidasTotal} fila(s) NO se marcan como sincronizadas ` +
            `(retenidas o rechazadas)`
        );
      }

      return { experimentalRejectedIds: noMarcarComoSincronizadas };
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

  return pushResponses;
}

/**
 * Una colección cuyo pull falló, con el motivo ya legible.
 *
 * El punto es que el mensaje sirva SIN acceso al servidor: el promotor está en el
 * campo y quien lo atiende por teléfono necesita saber cuál colección y por qué, no
 * "Error de sincronización".
 */
export interface FalloPull {
  coleccion: string;
  /** Código estable del BE (PERMISSION_DENIED, COLLECTION_NOT_FOUND…) o el del error. */
  codigo: string;
  mensaje: string;
}

export class PullFallidoError extends Error {
  constructor(public readonly fallos: FalloPull[]) {
    super(PullFallidoError.describir(fallos));
    this.name = "PullFallidoError";
  }

  /**
   * El texto que va a ver el promotor en la pantalla.
   *
   * Con una sola colección se muestra su mensaje, y sólo se le antepone el nombre si
   * el mensaje no lo menciona ya — el del BE suele decirlo ("Permiso requerido para
   * sync de 'tipos_visita'…") y repetirlo quedaba redundante justo en el texto que
   * alguien va a leer por teléfono.
   */
  private static describir(fallos: FalloPull[]): string {
    if (fallos.length === 1) {
      const f = fallos[0]!;
      return f.mensaje.includes(f.coleccion)
        ? f.mensaje
        : `${f.coleccion}: ${f.mensaje}`;
    }
    // Varias: casi siempre es el mismo motivo (se cayó la red), así que se dice una
    // vez y se listan las colecciones.
    const motivos = new Set(fallos.map((f) => f.mensaje));
    const nombres = fallos.map((f) => f.coleccion).join(", ");
    return motivos.size === 1
      ? `${[...motivos][0]} (${nombres})`
      : `No se pudieron traer: ${fallos.map((f) => `${f.coleccion} (${f.codigo})`).join(", ")}`;
  }
}

/**
 * Saca el código y el mensaje que mandó el BE.
 *
 * El cuerpo de un 403/404 del sync es `{ code, message }` con texto pensado para
 * mostrarse. Sin esto queda el mensaje de axios ("Request failed with status code
 * 403"), que dice el número pero no la causa ni el permiso que falta.
 */
function describirFallo(coleccion: string, err: unknown): FalloPull {
  const data = (err as { response?: { data?: { code?: string; message?: string }; status?: number } })
    ?.response;
  if (data?.data?.message) {
    return {
      coleccion,
      codigo: data.data.code ?? String(data.status ?? "ERROR"),
      mensaje: data.data.message,
    };
  }
  const mensaje = (err as Error)?.message ?? String(err);
  return {
    coleccion,
    codigo: data?.status ? String(data.status) : "ERROR",
    mensaje: mensaje.includes("Network")
      ? "Sin conexión con el servidor."
      : mensaje,
  };
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

/**
 * Metadatos internos de WatermelonDB que no tienen por qué viajar.
 *
 * `_status` y `_changed` son contabilidad del cliente; el servidor los ignora (no
 * están en ninguna lista de campos aceptados) pero mandarlos infla el payload y
 * confunde a cualquiera que lea el wire.
 */
const METADATOS_WMDB = new Set(["_status", "_changed"]);

/**
 * Copia sin los metadatos internos.
 *
 * SIEMPRE devuelve un objeto NUEVO. No es prolijidad: WatermelonDB compara el raw que
 * mandó a pushChanges contra el raw actual de la fila para decidir si la marca como
 * sincronizada (`areRecordsEqual`). Mutar el objeto del bucket rompería esa
 * contabilidad y las filas quedarían pendientes o se marcarían de más.
 */
function limpiarMetadatos(raw: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!METADATOS_WMDB.has(k)) salida[k] = v;
  }
  return salida;
}

/**
 * La fila modificada reducida a lo que de verdad cambió.
 *
 * POR QUÉ NO SE MANDA COMPLETA
 * ----------------------------
 * Mandando la fila entera, el push lleva TODOS los campos actualizables — incluidos
 * los que el promotor nunca tocó. Y ahí un teléfono con datos viejos pisa lo que otro
 * cambió: el caso concreto es el veredicto de Hacienda, que la oficina puede haber
 * reconsultado después del último pull del teléfono. Mandando sólo lo modificado, un
 * campo únicamente puede pisarse si el promotor lo editó a propósito — y en ese caso
 * su valor ES el más nuevo.
 *
 * Eso vuelve innecesario el control de versión optimista para el caso normal: la
 * única colisión posible es que los dos hayan editado el MISMO campo, y ahí gana el
 * último, que es lo razonable (el historial del servidor deja el rastro).
 *
 * `_changed` es la lista que WatermelonDB ya mantiene por fila: los nombres de columna
 * tocados desde el último sync, en snake_case — el mismo vocabulario del wire, así que
 * no hay traducción en el medio.
 *
 * El `id` viaja siempre aunque no esté en `_changed`: es cómo el servidor encuentra la
 * fila. Igual `client_uuid`, que es la identidad cuando el id local es un uuid.
 *
 * Si `_changed` viene vacío (no debería, pero el wire no es un contrato que controlemos
 * de los dos lados), se manda la fila completa: pasarse de generoso es recuperable,
 * perder la edición del promotor no.
 */
function soloLoCambiado(raw: Record<string, unknown>): Record<string, unknown> {
  // typeof explícito: `_changed` es un string CSV, pero el raw viene tipado como
  // unknown y un String(objeto) daría "[object Object]" — o sea una lista de campos
  // inventada, que es peor que no tener ninguna.
  const cambiados =
    typeof raw._changed === "string"
      ? raw._changed
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
      : [];

  if (cambiados.length === 0) return limpiarMetadatos(raw);

  const salida: Record<string, unknown> = { id: raw.id };
  if (raw.client_uuid != null) salida.client_uuid = raw.client_uuid;

  for (const campo of cambiados) {
    if (METADATOS_WMDB.has(campo)) continue;
    if (campo in raw) salida[campo] = raw[campo];
  }
  return salida;
}
