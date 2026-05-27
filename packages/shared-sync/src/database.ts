import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import { schema } from "./schema";
import { Productor } from "./models/Productor";
import { Recibo } from "./models/Recibo";

/**
 * Factory de la WMDB Database. Cada app instancia la suya en el bootstrap.
 *
 * dbName: nombre del archivo SQLite local. Recomendado mismo que appId
 * para que múltiples apps en el mismo phone no compartan SQLite.
 *
 * jsi: false (bridge mode) — JSI requería el plugin morrowdigital que
 * inyecta una API removida en RN 0.81 (JSIModulePackage). Bridge es ~10-30%
 * más lento que JSI por call pero invisible para nuestro volumen (1K rows).
 * Cuando WMDB actualice su Expo plugin para new arch, volvemos a jsi: true.
 */
export function createDatabase(opts: { dbName: string }): Database {
  const adapter = new SQLiteAdapter({
    dbName: opts.dbName,
    schema,
    // migrations: [], // sumar cuando bumpeemos schema version
    jsi: false,
    onSetUpError: (error) => {
      console.error("WatermelonDB setup error", error);
    },
  });

  return new Database({
    adapter,
    modelClasses: [Productor, Recibo],
  });
}
