import type { Model } from "@nozbe/watermelondb";
import { database } from "./db";
import { randomUUID } from "./deviceId";

/**
 * Creación de las filas que el teléfono ORIGINA: jornadas, recibos, remedidas y sus rutas.
 *
 * ⚠️ POR QUÉ NO SE LLAMA `collection.create()` DIRECTO. Las cuatro colecciones son
 * bidireccionales, así que la fila que sube vuelve a bajar en el próximo pull. Para que
 * WatermelonDB la reconozca en vez de duplicarla, el id local tiene que ser el MISMO valor
 * que el servidor devuelve como `id` — y el servidor devuelve el ClientUuid cuando existe.
 *
 * Eso obliga a dos cosas que este helper centraliza:
 *
 *   1. el id local es un UUID v4 nuestro, no el que genera WatermelonDB (que no tiene
 *      formato GUID y no entra en una columna UNIQUEIDENTIFIER);
 *   2. ese mismo uuid viaja en `client_uuid`.
 *
 * ⚠️ Y EL SÍNTOMA DE OLVIDARLO NO APARECE CUANDO UNO MIRA. La primera jornada que subió
 * se guardó con ClientUuid en NULL y el push dijo "aceptado": el error recién se vería en
 * el SEGUNDO sync, como una jornada duplicada, o el día que un teléfono reinstalado no
 * reconociera lo suyo. De ahí que valga la pena el helper en vez de recordarlo en cada
 * pantalla.
 */
export async function crearConUuid<T extends Model>(
  tabla: string,
  aplicar: (rec: T, uuid: string) => void
): Promise<T> {
  // MINÚSCULAS, siempre. Es la forma canónica del texto UUID y la que devuelve la
  // proyección del pull. SQL Server renderiza UNIQUEIDENTIFIER en MAYÚSCULAS, y como los
  // ids de WatermelonDB son sensibles a mayúsculas, una diferencia de case hace que la
  // fila que vuelve del servidor se vea como OTRA y se duplique.
  const uuid = randomUUID().toLowerCase();
  return database.get<T>(tabla).create((rec) => {
    // WatermelonDB sólo permite fijar el id en el momento de la creación.
    (rec as unknown as { _raw: { id: string } })._raw.id = uuid;
    aplicar(rec, uuid);
  });
}
