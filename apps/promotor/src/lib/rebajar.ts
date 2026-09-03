import { Q } from "@nozbe/watermelondb";
import * as FileSystem from "expo-file-system/legacy";
import { database } from "./db";
import { syncNow } from "./sync";
import { registrarEvento } from "./bitacora";
import { useSesion } from "./sesion";
import { EventoBitacora, PendingUpload } from "../db/models";

/**
 * Rebajar todos los datos: borrar la base local y traerla de nuevo del servidor.
 *
 * PARA QUÉ EXISTE
 * ---------------
 * Es la válvula de escape cuando el cache local queda en un estado que no se arregla
 * sincronizando: una fila que no aparece, un dato viejo que no se actualiza, o —el caso
 * que motivó esto— registros que quedan pendientes para siempre porque el servidor los
 * rechaza cada vez. Hasta ahora la única salida era desinstalar la app.
 *
 * LA TENSIÓN QUE HAY QUE MIRAR DE FRENTE
 * --------------------------------------
 * Las filas que motivan el reset son las que lo bloquean. Si sólo se permitiera rebajar
 * con cero pendientes —que es lo seguro— un registro muerto de verdad lo bloquearía
 * eternamente, o sea que la válvula no serviría justo para lo que existe.
 *
 * Por eso son DOS operaciones y no una:
 *
 *   descartar = false   sincroniza primero y exige que no quede nada. Sin riesgo.
 *   descartar = true    tira lo que no pudo subir. Peligroso, y por eso quien llama
 *                       tiene que haberle mostrado al usuario QUÉ se pierde — no un
 *                       número, la lista. Es la diferencia entre una decisión y un
 *                       accidente.
 */

export interface ResumenPendientes {
  solicitudes: number;
  entregadores: number;
  visitas: number;
  adjuntos: number;
  total: number;
}

/* Ver la nota en sync.ts: productores es modificable, así que cuenta como
   pendiente mientras la corrección no haya subido. */
const ESCRIBIBLES = ["solicitudes", "entregadores", "visitas", "productores"] as const;

/**
 * Qué hay sin subir, desglosado. El desglose es el punto: "3 pendientes" no le permite
 * a nadie decidir si vale la pena descartarlos.
 */
export async function resumenPendientes(): Promise<ResumenPendientes> {
  const conteos: Record<string, number> = {};
  for (const tabla of ESCRIBIBLES) {
    conteos[tabla] = await database
      .get(tabla)
      .query(Q.where("_status", Q.notEq("synced")))
      .fetchCount();
  }
  const adjuntos = await database
    .get("pending_uploads")
    .query(Q.where("status", Q.notEq("subida")))
    .fetchCount();

  const solicitudes = conteos.solicitudes ?? 0;
  const entregadores = conteos.entregadores ?? 0;
  const visitas = conteos.visitas ?? 0;

  return {
    solicitudes,
    entregadores,
    visitas,
    adjuntos,
    total: solicitudes + entregadores + visitas + adjuntos,
  };
}

/** Texto para el aviso, en el idioma del promotor. Vacío si no hay nada. */
export function describirPendientes(r: ResumenPendientes): string {
  const partes: string[] = [];
  if (r.solicitudes > 0) partes.push(`${r.solicitudes} solicitud(es)`);
  if (r.entregadores > 0) partes.push(`${r.entregadores} entregador(es)`);
  if (r.visitas > 0) partes.push(`${r.visitas} visita(s)`);
  if (r.adjuntos > 0) partes.push(`${r.adjuntos} foto(s) o adjunto(s)`);
  return partes.join(", ");
}

export class HayPendientesAlRebajarError extends Error {
  constructor(public readonly resumen: ResumenPendientes) {
    super(
      `Quedan sin enviar: ${describirPendientes(resumen)}. ` +
        "Se pueden descartar, pero se pierden."
    );
    this.name = "HayPendientesAlRebajarError";
  }
}

/**
 * Borra la base local y la vuelve a bajar completa.
 *
 * Orden, y cada paso está por una razón:
 *   1. sincronizar — lo que pueda subir, que suba. Reduce lo que hay que descartar.
 *   2. si queda algo y `descartar` es false, abortar con el desglose.
 *   3. guardar la bitácora y las rutas de los adjuntos ANTES del reset.
 *   4. borrar los archivos de los adjuntos que se descartan.
 *   5. resetear.
 *   6. restaurar la bitácora + anotar qué se descartó.
 *   7. bajar todo de nuevo.
 */
export async function rebajarTodo(opts: { descartar: boolean }): Promise<void> {
  // 1. Intento de subir. Si falla la red no importa: lo que cuenta es el paso 2.
  try {
    await syncNow();
  } catch (err) {
    console.info("sync previo al rebajado falló", (err as Error)?.message);
  }

  const pendientes = await resumenPendientes();
  if (pendientes.total > 0 && !opts.descartar) {
    throw new HayPendientesAlRebajarError(pendientes);
  }

  // 3. La bitácora vive en la base local, así que el reset la borraría — y con ella el
  //    registro de qué se descartó, que es justo lo que va a hacer falta después. Se
  //    guarda en memoria y se reescribe del otro lado.
  const historia = await leerBitacora();

  // Los archivos de los adjuntos NO están en la base sino en el filesystem. Si se borra
  // la fila sin borrar el archivo, queda basura que ya nadie referencia y que ninguna
  // purga va a encontrar nunca.
  const archivosHuerfanos = await rutasDeAdjuntosPendientes();

  await database.write(async () => {
    await database.unsafeResetDatabase();
  });

  for (const uri of archivosHuerfanos) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Archivo ya borrado o inaccesible: la fila igual se fue.
    }
  }

  await restaurarBitacora(historia);
  await registrarEvento({
    tipo: "sync",
    ok: pendientes.total === 0,
    resumen:
      pendientes.total === 0
        ? "Datos rebajados del servidor"
        : `Datos rebajados DESCARTANDO ${describirPendientes(pendientes)}`,
    detalle: { descartados: pendientes },
  });

  // 7. Pull completo: unsafeResetDatabase también borró lastPulledAt.
  await syncNow();

  // 8. Remontar la app.
  //
  // NO es cosmético. `unsafeResetDatabase` mata las suscripciones vivas —su propio
  // código avisa "App should not hold onto subscriptions or Watermelon objects while
  // resetting database"— así que las pantallas quedan con objetos viejos en memoria y
  // observadores muertos. Sin esto, los datos se borran y se rebajan de verdad pero la
  // pantalla sigue mostrando lo de antes, y uno concluye que el rebajado no funcionó.
  useSesion.getState().remontar();
}

/**
 * Rutas de los adjuntos que todavía no subieron. Sólo esos: los ya subidos tienen su
 * copia en el servidor y su archivo local lo libera la purga por antigüedad, pero si se
 * borran acá también, la fila desaparece y el archivo queda sin dueño.
 */
async function rutasDeAdjuntosPendientes(): Promise<string[]> {
  const filas = await database
    .get<PendingUpload>("pending_uploads")
    .query()
    .fetch();
  return filas.map((f) => f.fileUri);
}

interface EventoPlano {
  tipo: string;
  ok: boolean;
  resumen: string;
  detalle: string | null;
  error: string | null;
  duracionMs: number | null;
  createdAt: number;
}

async function leerBitacora(): Promise<EventoPlano[]> {
  try {
    const filas = await database
      .get<EventoBitacora>("bitacora")
      .query(Q.sortBy("created_at", Q.desc), Q.take(200))
      .fetch();
    return filas.map((e) => ({
      tipo: e.tipo,
      ok: e.ok,
      resumen: e.resumen,
      detalle: e.detalle,
      error: e.error,
      duracionMs: e.duracionMs,
      createdAt: e.createdAt,
    }));
  } catch {
    return [];
  }
}

async function restaurarBitacora(eventos: EventoPlano[]): Promise<void> {
  if (eventos.length === 0) return;
  try {
    await database.write(async () => {
      for (const e of eventos) {
        await database.get<EventoBitacora>("bitacora").create((rec) => {
          rec.tipo = e.tipo;
          rec.ok = e.ok;
          rec.resumen = e.resumen;
          rec.detalle = e.detalle;
          rec.error = e.error;
          rec.duracionMs = e.duracionMs;
          rec.createdAt = e.createdAt;
        });
      }
    });
  } catch (err) {
    // Perder el historial es feo pero no invalida el rebajado, que ya ocurrió.
    console.warn("no se pudo restaurar la bitácora", (err as Error)?.message);
  }
}
