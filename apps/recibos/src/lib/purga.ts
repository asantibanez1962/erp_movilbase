import { Q } from "@nozbe/watermelondb";
import { database } from "./db";
import type { Bitacora, Recibo, Remedida, RemedidaRuta } from "../db/models";

/**
 * Borra del teléfono los documentos VIEJOS que ya están en el servidor.
 *
 * ── POR QUÉ ─────────────────────────────────────────────────────────────────
 *
 * El trabajo del recibidor es diario: se abre la bitácora, se reciben los recibos, se
 * cierra y se envía. Al día siguiente empieza de nuevo. Pero nada se borraba nunca, así
 * que la base crecía toda la cosecha — el recibidor 001 lleva 4.168 recibos en la actual.
 * No es un problema de espacio, son filas chicas; es que la lista de un teléfono con
 * miles de recibos deja de servir para encontrar el de esta mañana.
 *
 * ── ⚠️ POR QUÉ ESTO ES SEGURO AHORA Y NO ANTES ──────────────────────────────
 *
 * Borrar recibos enviados habría sido, hasta hace poco, el error caro del §4 del diseño:
 * un teléfono sin historia local repitiendo números ya entregados en papel, descubierto
 * días después en la oficina.
 *
 * No pasa porque el próximo número es `MAX(local, rc_Talonario.ultimo)` y ese contador
 * del servidor lo avanza `tr_recibos_talonario` con semántica MAX, venga el recibo del
 * web o del móvil. Se comprobó: el talonario 2484 pasó a `000006` con recibos que subió
 * el teléfono. **El talonario SÍ se sigue bajando, y es lo que sostiene todo esto.**
 *
 * ── ⚠️ SE BORRA CON destroyPermanently, NUNCA CON markAsDeleted ─────────────
 *
 * `markAsDeleted` encola la baja para MANDARLA AL SERVIDOR en el próximo push, y estas
 * colecciones son push-only: borraría los recibos del beneficio. `destroyPermanently`
 * saca la fila del teléfono sin decirle nada a nadie, que es exactamente lo que se
 * quiere — el documento vive en el servidor y en el papel que firmó el productor.
 */

/**
 * Cuántos días de trabajo terminado se conservan.
 *
 * Siete cubre la semana: reimprimir el manifiesto del camión que salió anoche, o buscar
 * el recibo que alguien reclama a los pocos días. Más atrás, la consulta es de la oficina
 * y se hace en el web, donde están todos.
 */
export const DIAS_A_CONSERVAR = 7;

/** Nunca se toca nada que no haya sido aceptado por el servidor. */
function enviado(fila: { syncStatus?: string }): boolean {
  return fila.syncStatus === "synced";
}

function corte(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - DIAS_A_CONSERVAR);
  return d.getTime();
}

/**
 * Corre después de una sincronización exitosa, que es el único momento en que se sabe con
 * certeza qué llegó al servidor.
 *
 * No lanza nunca: una purga que falle no puede romper el sync, que es lo que de verdad
 * importa. Lo peor que pasa es que la base quede más grande y se limpie mañana.
 */
export async function purgarAntiguos(): Promise<void> {
  try {
    const limite = corte();

    /**
     * ⚠️ LA BITÁCORA SE BORRA CON SUS RECIBOS, Y SÓLO SI TODOS SUBIERON.
     *
     * Un recibo sin enviar dentro de una bitácora vieja es trabajo que existe ÚNICAMENTE
     * en este teléfono. Borrar la bitácora y dejarlo huérfano, o borrarlo a él, sería
     * perderlo sin que nadie se entere. Si aparece uno así, el día entero se conserva y
     * se vuelve a evaluar mañana.
     */
    const bitacoras = await database
      .get<Bitacora>("bitacoras")
      .query(Q.where("hora_final", Q.notEq(null)), Q.where("fecha", Q.lt(limite)))
      .fetch();

    let bitacorasBorradas = 0;
    let recibosBorrados = 0;

    for (const b of bitacoras) {
      if (!enviado(b)) continue;

      const recibos = await database
        .get<Recibo>("recibos")
        .query(Q.where("id_bitacora", b.id))
        .fetch();

      if (recibos.some((r) => !enviado(r))) continue;

      await database.write(async () => {
        await Promise.all(recibos.map((r) => r.destroyPermanently()));
        await b.destroyPermanently();
      });
      bitacorasBorradas++;
      recibosBorrados += recibos.length;
    }

    // La remedida va con sus rutas, por lo mismo: una ruta sin su remedida no dice nada.
    const remedidas = await database
      .get<Remedida>("remedidas")
      .query(Q.where("fecha", Q.lt(limite)))
      .fetch();

    let remedidasBorradas = 0;

    for (const rm of remedidas) {
      if (!enviado(rm)) continue;

      const rutas = await database
        .get<RemedidaRuta>("remedida_rutas")
        .query(Q.where("id_remedida", rm.id))
        .fetch();

      if (rutas.some((x) => !enviado(x))) continue;

      await database.write(async () => {
        await Promise.all(rutas.map((x) => x.destroyPermanently()));
        await rm.destroyPermanently();
      });
      remedidasBorradas++;
    }

    if (bitacorasBorradas + remedidasBorradas > 0) {
      // Se deja constancia: un borrado silencioso es imposible de distinguir de un dato
      // que nunca existió, y ésa es justo la duda cara cuando falta un recibo.
      console.info(
        `[purga] borradas ${bitacorasBorradas} bitácoras con ${recibosBorrados} recibos ` +
          `y ${remedidasBorradas} remedidas, todas enviadas y de más de ` +
          `${DIAS_A_CONSERVAR} días`
      );
    }
  } catch (e) {
    console.info("[purga] no se pudo limpiar, se reintenta en el próximo sync", e);
  }
}
