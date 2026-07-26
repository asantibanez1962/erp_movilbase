import { Q } from "@nozbe/watermelondb";
import { runSync } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";
import { config } from "./config";
import { COLLECTIONS } from "../db/schema";
import { flushAdjuntos, purgarAdjuntosLocales, registrarServerIds } from "./adjuntos";
import { useSesion } from "./sesion";
import { cargarPoliticas, puedeEnviarse } from "./politicas";

/** Colecciones que el teléfono origina y por lo tanto pueden tener pendientes. */
const ESCRIBIBLES = ["solicitudes", "entregadores", "visitas"] as const;

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

  // Las políticas se refrescan en cada sync: son config del servidor y pueden
  // cambiar sin republicar la app. Si el manifest falla se sigue con lo que haya
  // en sesión (o el default conservador) — no vale abortar el sync por esto.
  try {
    useSesion.getState().setPoliticas(await cargarPoliticas());
  } catch (err) {
    console.info("no se pudo refrescar el manifest de políticas", err);
  }
  const politicas = useSesion.getState().politicas;

  const pushResponses = await runSync(database, {
    api,
    collections: [...COLLECTIONS],
    schemaVersion: config.schemaVersion,
    // Retención: una fila con política hasta-evento no sale hasta que su campo
    // de cierre tiene valor (ej. recibo impreso).
    puedeEnviar: (coleccion, fila) => puedeEnviarse(politicas, coleccion, fila),
  });

  // Guardar los localId → serverId de lo que se acaba de aceptar, ANTES de
  // intentar las fotos: una visita recién subida tiene que quedar resoluble.
  try {
    await registrarServerIds(pushResponses);
  } catch (err) {
    console.warn("no se pudieron registrar los server ids", err);
  }

  // Best-effort: si falla, las fotos quedan encoladas para el próximo sync.
  // No propagamos — el sync de datos ya fue exitoso y el usuario no puede
  // hacer nada distinto con el error.
  try {
    await flushAdjuntos();
  } catch (err) {
    console.warn("flushAdjuntos falló; los adjuntos siguen encolados", err);
  }

  // Purga de copias locales vencidas. Acá y no en un job aparte porque no hay
  // dónde correrlo: el BE no puede tocar el filesystem del teléfono, así que la
  // mantenimiento del dispositivo se engancha al momento en que la app está
  // activa y conectada. Best-effort — que falle no invalida el sync.
  try {
    const dias = useSesion.getState().retencionFotosDias;
    const borradas = await purgarAdjuntosLocales(dias);
    if (borradas > 0) {
      console.info(`[fotos] ${borradas} copia(s) local(es) purgada(s) tras ${dias} días`);
    }
  } catch (err) {
    console.warn("purga de fotos locales falló", err);
  }
}

/**
 * Cuánto trabajo del teléfono todavía no llegó al servidor. Se usa para no dejar
 * cambiar de cosecha con cosas sin subir, que el reset borraría.
 *
 * Incluye las fotos en cola: viven en una tabla local que `unsafeResetDatabase`
 * también vacía, así que si no se contaran, cambiar de cosecha las perdería en
 * silencio junto con los archivos que referencian.
 */
export async function contarPendientes(): Promise<number> {
  let total = 0;
  for (const tabla of ESCRIBIBLES) {
    total += await database
      .get(tabla)
      .query(Q.where("_status", Q.notEq("synced")))
      .fetchCount();
  }
  total += await database.get("pending_uploads").query().fetchCount();
  return total;
}

export class HayPendientesError extends Error {
  constructor(public readonly cantidad: number) {
    super(
      `Hay ${cantidad} registro(s) sin sincronizar. Sincronizá primero para no perderlos.`
    );
    this.name = "HayPendientesError";
  }
}

/**
 * Cambia la cosecha de trabajo.
 *
 * No es sólo escribir la preferencia: el delta sync de WatermelonDB pide "cambios
 * desde lastPulledAt" asumiendo que el FILTRO no cambia. Al cambiar la cosecha, un
 * pull incremental no borraría las filas de la cosecha anterior ni traería las de
 * la nueva que no cambiaron desde entonces — la app quedaría mostrando una mezcla
 * de las dos. Así que el único camino correcto es resetear y bajar de nuevo.
 *
 * Orden, y el orden importa:
 *   1. subir lo pendiente (un sync normal)
 *   2. si QUEDA algo sin subir, abortar — resetear ahora lo perdería
 *   3. borrar la base local
 *   4. guardar la cosecha nueva y volver a bajar los datos
 *
 * Las fotos encoladas cuelgan de visitas locales, así que el paso 2 también las
 * protege: si su visita no subió, no se resetea.
 */
export async function cambiarCosecha(cosecha: string): Promise<void> {
  const sesion = useSesion.getState();
  if (sesion.companyId == null) throw new Error("No hay empresa en la sesión.");
  if (sesion.cosecha === cosecha) return;

  // 1 + 2. Intentar subir; si no se puede, no seguimos.
  try {
    await syncNow();
  } catch (err) {
    const pendientes = await contarPendientes();
    if (pendientes > 0) throw new HayPendientesError(pendientes);
    // Sin pendientes, un sync fallido no impide cambiar: no hay nada que perder.
    console.warn("sync previo al cambio de cosecha falló, sin pendientes", err);
  }

  const pendientes = await contarPendientes();
  if (pendientes > 0) throw new HayPendientesError(pendientes);

  // 3. Reset. unsafeResetDatabase borra las tablas y el lastPulledAt, así que el
  //    próximo sync es un pull completo con el filtro nuevo.
  await database.write(async () => {
    await database.unsafeResetDatabase();
  });

  // 4. Contexto nuevo + pull completo.
  await sesion.elegir({
    companyId: sesion.companyId,
    cosecha,
    zonas: sesion.zonas,
    zonasNombres: sesion.zonasNombres,
    todasLasZonas: sesion.todasLasZonas,
  });

  await syncNow();
}
