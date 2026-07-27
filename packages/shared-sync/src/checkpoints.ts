import type { Database } from "@nozbe/watermelondb";

/**
 * Checkpoint de pull POR COLECCIÓN.
 *
 * POR QUÉ NO ALCANZA EL DE WATERMELONDB
 * -------------------------------------
 * `synchronize()` lleva un único `lastPulledAt` para toda la base. Con un solo
 * checkpoint, el sync tiene que ser todo-o-nada: si se devolvieran las colecciones que
 * sí anduvieron y se dejara afuera la que falló, el checkpoint global avanzaría igual
 * —incluido el de la que falló— y sus filas pendientes no entrarían en ningún delta
 * futuro. Se perderían en silencio, que es peor que el fallo ruidoso.
 *
 * Con un checkpoint por colección, la que falla conserva el suyo y se pone al día en el
 * próximo sync, mientras las demás avanzan. Eso es lo que permite que un permiso
 * faltante en un catálogo de 11 filas deje de bloquear productores, solicitudes y
 * visitas.
 *
 * DÓNDE VIVEN
 * -----------
 * En `database.localStorage`, que es una tabla SQLite del adapter. Elegida a propósito:
 * `unsafeResetDatabase` la borra junto con el resto, así que después de "rebajar todos
 * los datos" cada colección vuelve a pedir desde cero, sin código extra. Es la misma
 * mecánica por la que se resetea el `lastPulledAt` propio de WatermelonDB.
 *
 * El de WatermelonDB sigue existiendo y avanzando; simplemente dejamos de usarlo para
 * decidir qué pedir. Se lo sigue mandando al push, que es donde el contrato lo espera.
 */

const PREFIJO = "sync.lastPulledAt.";

/**
 * Checkpoints de todas las colecciones. Se leen juntos al empezar el pull para no
 * intercalar lecturas con las requests.
 *
 * Una colección sin checkpoint devuelve `null` = "traeme todo", que es lo correcto la
 * primera vez y también después de un rebajado.
 */
export async function leerCheckpoints(
  db: Database,
  colecciones: string[]
): Promise<Record<string, number | null>> {
  const mapa: Record<string, number | null> = {};
  await Promise.all(
    colecciones.map(async (c) => {
      try {
        const v = await db.localStorage.get<number>(PREFIJO + c);
        mapa[c] = typeof v === "number" ? v : null;
      } catch {
        // Sin checkpoint legible se pide todo. Pedir de más es recuperable; pedir de
        // menos deja huecos que no se notan.
        mapa[c] = null;
      }
    })
  );
  return mapa;
}

/**
 * Avanza el checkpoint de las colecciones que SÍ se pudieron traer.
 *
 * Se llama después de que `synchronize()` aplicó los cambios, no antes: si la
 * aplicación falla, los checkpoints no deben haber avanzado o esas filas se perderían.
 */
export async function guardarCheckpoints(
  db: Database,
  checkpoints: Record<string, number>
): Promise<void> {
  for (const [coleccion, valor] of Object.entries(checkpoints)) {
    try {
      await db.localStorage.set(PREFIJO + coleccion, valor);
    } catch (e) {
      // Que falle uno significa que esa colección va a volver a pedir desde su
      // checkpoint viejo: trae de más, no de menos. Molesto y seguro.
      console.warn(
        `[sync] no se pudo guardar el checkpoint de ${coleccion}`,
        (e as Error)?.message
      );
    }
  }
}
