import { createDatabase } from "@erp/shared-sync";
import { schema } from "../db/schema";
import { migrations } from "../db/migrations";
import { MODEL_CLASSES } from "../db/models";

/**
 * La base local del teléfono. Se crea una vez al importar.
 *
 * `dbName` propio: si alguien instala recibos y promotor en el mismo equipo, cada app
 * tiene su SQLite. Compartirlo mezclaría dos alcances de datos distintos.
 */
export const database = createDatabase({
  dbName: "recibos",
  schema,
  migrations,
  modelClasses: MODEL_CLASSES,
});
