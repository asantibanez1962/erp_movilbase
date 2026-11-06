import { Q } from "@nozbe/watermelondb";
import { create } from "zustand";
import { runSync, type FalloPull } from "@erp/shared-sync";
import type { PushResponse } from "@erp/shared-types";
import { database } from "./db";
import { getSyncClient } from "./api";
import { config } from "./config";
import { COLLECTIONS } from "../db/schema";
import { flushAdjuntos, purgarAdjuntosLocales, registrarServerIds } from "./adjuntos";
import { purgarBitacora, registrarEvento } from "./bitacora";
import { useSesion } from "./sesion";
import { cargarPoliticas, puedeEnviarse } from "./politicas";

/** Colecciones que el teléfono origina y por lo tanto pueden tener pendientes. */
/* `productores` entra acá aunque el teléfono no las cree: puede MODIFICARLAS
   (teléfono y email, v1.80/RC/10), y una corrección sin enviar es trabajo sin
   enviar igual que una visita. Si no estuviera, cambiar de cosecha borraría la
   corrección sin avisar. */
const ESCRIBIBLES = ["solicitudes", "entregadores", "visitas", "productores"] as const;

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
export async function syncNow(): Promise<FalloPull[]> {
  const api = getSyncClient();
  const inicio = Date.now();

  // Las políticas se refrescan en cada sync: son config del servidor y pueden
  // cambiar sin republicar la app. Si el manifest falla se sigue con lo que haya
  // en sesión (o el default conservador) — no vale abortar el sync por esto.
  try {
    useSesion.getState().setPoliticas(await cargarPoliticas());
  } catch (err) {
    console.info("no se pudo refrescar el manifest de políticas", err);
  }
  const politicas = useSesion.getState().politicas;

  // Se cuenta ANTES de sincronizar: después de un push exitoso ya no hay pendientes
  // que contar, y "cuántas cosas tenía sin subir" es justo el dato que se necesita
  // para entender un reclamo de "no envió nada".
  const pendientesAntes = await contarPendientes();

  let resultado: Awaited<ReturnType<typeof runSync>>;
  try {
    resultado = await runSync(database, {
      api,
      collections: [...COLLECTIONS],
      schemaVersion: config.schemaVersion,
      // Retención: una fila con política hasta-evento no sale hasta que su campo
      // de cierre tiene valor (ej. recibo impreso).
      puedeEnviar: (coleccion, fila) => puedeEnviarse(politicas, coleccion, fila),
    });
  } catch (err) {
    // El sync falla y se propaga (la pantalla lo muestra), pero antes queda
    // registrado: un sync que nunca llegó al servidor no deja rastro del otro lado,
    // y sin esto la única evidencia sería el logcat de un teléfono en el campo.
    // Acá sólo caen los fallos que NO son de un pull individual (el push, o un error
    // al aplicar): desde que el sync es resiliente, una colección que no se pudo traer
    // vuelve en `resultado.fallos` en vez de tirar.
    await registrarEvento({
      tipo: "sync",
      ok: false,
      resumen: `Sincronización falló con ${pendientesAntes} pendiente(s)`,
      error: (err as Error)?.message ?? String(err),
      duracionMs: Date.now() - inicio,
    });
    throw err;
  }

  const { push: pushResponses, fallos } = resultado;

  await registrarEvento({
    tipo: "sync",
    ok: fallos.length === 0,
    resumen:
      fallos.length === 0
        ? resumirPush(pushResponses, pendientesAntes)
        : `${resumirPush(pushResponses, pendientesAntes)} — sin traer: ` +
          fallos.map((f) => f.coleccion).join(", "),
    detalle: { push: detallarPush(pushResponses), fallos },
    duracionMs: Date.now() - inicio,
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
  //
  // La bitácora se purga al MISMO plazo que las fotos: las dos son diagnóstico
  // reciente del dispositivo, no archivo. Lo permanente vive en la LogDB.
  try {
    const dias = useSesion.getState().retencionFotosDias;
    const borradas = await purgarAdjuntosLocales(dias);
    if (borradas > 0) {
      console.info(`[fotos] ${borradas} copia(s) local(es) purgada(s) tras ${dias} días`);
    }
    const eventos = await purgarBitacora(dias);
    if (eventos > 0) {
      console.info(`[bitácora] ${eventos} evento(s) purgado(s) tras ${dias} días`);
    }
  } catch (err) {
    console.warn("purga de datos locales vencidos falló", err);
  }

  // Llegar hasta acá significa que hablamos con el servidor. Aunque `fallos` traiga
  // colecciones, hubo ida y vuelta: la puerta del cambio de clave se apoya en esto
  // para no bloquear a un promotor sin señal. Ver useSyncEstado.
  useSyncEstado.getState().marcarOk();

  // Las colecciones que no se pudieron traer se DEVUELVEN en vez de tirar: las demás
  // ya se aplicaron y avanzaron su checkpoint, así que el sync sirvió. Quien llame
  // decide cómo mostrarlo — parcial es una advertencia, y que fallen todas, un error.
  return fallos;
}

/**
 * ¿Hubo, en esta corrida de la app, un sync que efectivamente llegó al servidor?
 *
 * Existe para una sola cosa: decidir cuándo se puede exigir el cambio de clave
 * vencida. Un promotor sin señal NO puede cambiarla —el endpoint es del
 * servidor—, así que bloquearlo lo dejaría encerrado afuera de sus propios datos,
 * en una finca, sin salida más que desinstalar.
 *
 * Se prefirió esto a detectar conectividad con NetInfo: no hace falta una
 * dependencia nueva para responder la pregunta que de verdad importa, que no es
 * "¿hay red?" sino "¿este teléfono logró hablar con SU servidor?". Con VPN de por
 * medio, además, tener red no implica alcanzar el backend.
 *
 * No se persiste a propósito: al reabrir la app vuelve a false y la exigencia
 * espera al primer sync, que es justo el momento en que sabemos que se puede.
 */
export const useSyncEstado = create<{ huboSyncOk: boolean; marcarOk: () => void }>(
  (set) => ({
    huboSyncOk: false,
    marcarOk: () => set({ huboSyncOk: true }),
  })
);

/**
 * Una línea que el promotor pueda leer por teléfono. Incluye lo que había pendiente
 * ANTES: "0 enviadas" con 3 pendientes es un problema; con 0 pendientes es normal.
 */
function resumirPush(
  respuestas: Record<string, PushResponse>,
  pendientesAntes: number
): string {
  let aceptadas = 0;
  let rechazadas = 0;
  for (const resp of Object.values(respuestas)) {
    for (const filas of Object.values(resp.accepted ?? {})) aceptadas += filas.length;
    for (const filas of Object.values(resp.rejected ?? {})) rechazadas += filas.length;
  }
  const partes = [`${aceptadas} enviada(s)`];
  if (rechazadas > 0) partes.push(`${rechazadas} rechazada(s)`);
  if (pendientesAntes > 0) partes.push(`de ${pendientesAntes} pendiente(s)`);
  return `Sincronización OK — ${partes.join(", ")}`;
}

/**
 * Desglose por colección, con el motivo de cada rechazo y el id de cada fila que subió.
 *
 * Los motivos hacen diagnosticable un "no envió nada": sin ellos, un UNRESOLVED_PARENT y
 * un permiso faltante se ven iguales desde afuera.
 *
 * Los ids (local → servidor, con el número si el servidor lo asignó) son el rastro
 * documental del lado del teléfono. En el servidor está la misma información en
 * dbo.MobileSyncRow, pero acá cubre el caso en que el teléfono cree que algo subió y el
 * servidor no lo tenga: son los dos extremos del mismo envío y se pueden cruzar.
 */
function detallarPush(respuestas: Record<string, PushResponse>): unknown {
  const porColeccion: Record<string, unknown> = {};
  for (const [coleccion, resp] of Object.entries(respuestas)) {
    const enviadas = Object.values(resp.accepted ?? {})
      .flat()
      .map((a) => ({
        local: a.local_id,
        servidor: a.server_id,
        ...(a.codigo ? { codigo: a.codigo } : {}),
      }));
    const rechazos = Object.values(resp.rejected ?? {})
      .flat()
      .map((r) => ({ local: r.local_id, motivo: r.reason, mensaje: r.message }));
    porColeccion[coleccion] = { aceptadas: enviadas.length, enviadas, rechazos };
  }
  return porColeccion;
}

/**
 * Cuánto trabajo del teléfono todavía no llegó al servidor. Se usa para no dejar
 * cambiar de cosecha con cosas sin subir, que el reset borraría.
 *
 * Incluye los adjuntos en cola: viven en una tabla local que `unsafeResetDatabase`
 * también vacía, así que si no se contaran, cambiar de cosecha los perdería en
 * silencio junto con los archivos que referencian.
 *
 * `status != 'subida'` y no todas las filas: los adjuntos YA subidos conservan su
 * fila para poder verlos sin señal hasta que los libere la purga, y contarlos hacía
 * que el drawer mostrara 0 pendientes mientras "Cambiar cosecha" se negaba diciendo
 * que había N sin sincronizar. El mismo criterio que usePendientes.
 */
export async function contarPendientes(): Promise<number> {
  let total = 0;
  for (const tabla of ESCRIBIBLES) {
    total += await database
      .get(tabla)
      .query(Q.where("_status", Q.notEq("synced")))
      .fetchCount();
  }
  total += await database
    .get("pending_uploads")
    .query(Q.where("status", Q.notEq("subida")))
    .fetchCount();
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

  // Mismo motivo que en rebajarTodo: el reset dejó a las pantallas con suscripciones
  // muertas. Sin remontar, se cambia de cosecha y se siguen viendo los datos de la
  // anterior.
  useSesion.getState().remontar();
}
