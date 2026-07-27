import { Q } from "@nozbe/watermelondb";
import { database } from "./db";
import { EventoBitacora } from "../db/models";

/**
 * Bitácora local: qué intentó ESTE teléfono.
 *
 * Por qué existe además del log del servidor: los dos problemas que más cuesta
 * diagnosticar son remotos y silenciosos —"sigue todo pendiente" y "el ATV no me
 * dijo nada"— y el promotor está en el campo, sin cable ni logcat. Desde el servidor
 * son indistinguibles entre sí y de "no había nada que enviar": fue exactamente lo
 * que escondió el bug del case de los uuid durante horas. Y lo que nunca llegó a la
 * red no deja rastro del otro lado por definición.
 *
 * Es diagnóstico reciente, no archivo: se purga al mismo plazo que las copias
 * locales de adjuntos. El histórico permanente vive en la LogDB.
 */

export type TipoEvento = "sync" | "atv";

/**
 * Registra un evento. Nunca tira: un fallo al escribir la bitácora no puede romper
 * la operación que estaba registrando — sería el peor intercambio posible.
 */
export async function registrarEvento(e: {
  tipo: TipoEvento;
  ok: boolean;
  resumen: string;
  detalle?: unknown;
  error?: string | null;
  duracionMs?: number | null;
}): Promise<void> {
  try {
    await database.write(async () => {
      await database.get<EventoBitacora>("bitacora").create((rec) => {
        rec.tipo = e.tipo;
        rec.ok = e.ok;
        rec.resumen = e.resumen;
        rec.detalle = e.detalle == null ? null : serializar(e.detalle);
        rec.error = e.error ?? null;
        rec.duracionMs = e.duracionMs ?? null;
        rec.createdAt = Date.now();
      });
    });
  } catch (err) {
    console.warn("no se pudo registrar en la bitácora", (err as Error)?.message);
  }
}

/** Los eventos más recientes primero. */
export async function eventosRecientes(limite = 100): Promise<EventoBitacora[]> {
  return consulta(limite).fetch();
}

/**
 * Los mismos eventos, como suscripción viva.
 *
 * La pantalla usa ésta y no `eventosRecientes`: el drawer la mantiene montada, así que
 * una carga única la dejaba mostrando los datos del momento en que se abrió por primera
 * vez — y el síntoma era "sincronizo y la bitácora no registra nada", con los eventos
 * escribiéndose perfectamente.
 */
export function observarEventos(limite = 100) {
  return consulta(limite).observe();
}

function consulta(limite: number) {
  return database
    .get<EventoBitacora>("bitacora")
    .query(Q.sortBy("created_at", Q.desc), Q.take(limite));
}

/**
 * Borra los eventos que pasaron el plazo de retención. Mismo plazo que los adjuntos
 * (config del servidor) y misma razón para colgarla del sync: es el único momento en
 * que la app está corriendo y hay dónde ejecutar mantenimiento.
 */
export async function purgarBitacora(dias: number): Promise<number> {
  if (!Number.isFinite(dias) || dias <= 0) return 0;

  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const viejos = await database
    .get<EventoBitacora>("bitacora")
    .query(Q.where("created_at", Q.lt(corte)))
    .fetch();
  if (viejos.length === 0) return 0;

  await database.write(async () => {
    for (const e of viejos) await e.destroyPermanently();
  });
  return viejos.length;
}

/**
 * JSON tolerante: el detalle es diagnóstico, así que un objeto que no serializa
 * (un ciclo, un Error) tiene que degradar a texto y no tumbar el registro.
 */
function serializar(valor: unknown): string {
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}
