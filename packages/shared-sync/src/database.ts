import { AppSchema, Database, Model } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";
import type { SchemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

/**
 * Factory de la WMDB Database. Cada app instancia la suya en el bootstrap
 * pasando SU schema y SUS models — no hay default. Los tuvo mientras
 * recibos-cr era la única app; con la segunda (promotor) un default silencioso
 * significaría arrastrar tablas ajenas al SQLite equivocado.
 *
 * dbName: nombre del archivo SQLite local. Recomendado mismo que appId
 * para que múltiples apps en el mismo phone no compartan SQLite.
 *
 * migrations: OBLIGATORIO en cuanto el schema pase de la versión 1. Sin ellas,
 * WMDB no sabe cómo llevar el SQLite del teléfono de la versión vieja a la nueva
 * y lo único que puede hacer es BORRARLO — el promotor pierde todo lo capturado
 * que no había sincronizado, y en el momento peor: justo después de actualizar la
 * app. Cada cambio de schema tiene que venir con su paso de migración y su bump
 * de versión, en el mismo commit.
 *
 * jsi: false (bridge mode) — JSI requería el plugin morrowdigital que
 * inyecta una API removida en RN 0.81 (JSIModulePackage). Bridge es ~10-30%
 * más lento que JSI por call pero invisible para nuestro volumen (1K rows).
 * Cuando WMDB actualice su Expo plugin para new arch, volvemos a jsi: true.
 */
export function createDatabase(opts: {
  dbName: string;
  schema: AppSchema;
  modelClasses: Array<typeof Model>;
  migrations?: SchemaMigrations;
}): Database {
  const adapter = new SQLiteAdapter({
    dbName: opts.dbName,
    schema: opts.schema,
    migrations: opts.migrations,
    jsi: false,
    onSetUpError: (error) => {
      console.error("WatermelonDB setup error", error);
    },
  });

  return new Database({
    adapter,
    modelClasses: opts.modelClasses,
  });
}
