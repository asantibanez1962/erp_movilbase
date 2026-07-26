import { createDatabase } from "@erp/shared-sync";
import { schema } from "../db/schema";
import { MODEL_CLASSES } from "../db/models";

/**
 * Singleton de la WMDB Database del app. Se crea UNA vez al import; el boot
 * (bootstrapApi) solo lo usa. dbName distinto al de recibos-cr para que las dos
 * apps no compartan SQLite si están instaladas en el mismo teléfono.
 */
export const database = createDatabase({
  dbName: "promotor",
  schema,
  modelClasses: MODEL_CLASSES,
});
