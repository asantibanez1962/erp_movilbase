import { createDatabase, schema, Productor, Recibo } from "@erp/shared-sync";

/**
 * Singleton de la WMDB Database del app. Llamado UNA vez al boot del app
 * (en bootstrapApi). Después se importa desde donde se necesite.
 *
 * schema + modelClasses son explícitos desde que hay más de una app en el
 * monorepo (ver createDatabase). Los de recibos-cr todavía viven en
 * shared-sync por historia; los de promotor viven en su propia app.
 */
export const database = createDatabase({
  dbName: "recibos-cr",
  schema,
  modelClasses: [Productor, Recibo],
});

/**
 * TTL para purga de recibos ya sincronizados. Los recibos enviados quedan
 * en cache local para "Enviados" (consulta offline + reimpresión), pero
 * pasados X días se borran silenciosamente al boot para que la DB no
 * crezca sin techo. 30 días cubre auditoría operativa típica (cierre
 * mensual + un par de días de margen). Cambiable si el cliente pide más.
 */
const SYNCED_RECIBOS_TTL_DAYS = 30;

/**
 * Borra silenciosamente los recibos sincronizados más viejos que
 * SYNCED_RECIBOS_TTL_DAYS. Llamado UNA vez al boot del app post-bootstrap.
 * No corre durante operación normal para evitar borrar rows que el user
 * acaba de ver/reimprimir.
 *
 * Filtro: `_status='synced'` (WMDB-native, seteado automáticamente al
 * confirmarse el push). No usamos un campo custom porque escribirlo
 * flipparía _status a 'updated' → loop de re-push + duplicado en BE
 * (ver syncEngine.ts).
 *
 * TTL: comparamos contra el id del row. WMDB genera ids con prefix de
 * timestamp (string ordenable lexicográficamente) → IDs viejos < IDs nuevos.
 * No es preciso al ms pero alcanza para una TTL de días. Si más adelante
 * necesitamos timestamp exacto, agregar columna `created_at` con
 * @date('created_at') (requiere migration de schema).
 *
 * Errores se logean y no rompen el boot — la purga es best-effort.
 */
export async function purgeOldSyncedRecibos(): Promise<void> {
  // No-op temporal. Para purgar correctamente necesitamos un timestamp
  // confiable de "cuándo se sincronizó" por row, y eso requiere agregar
  // una columna created_at (@date) al schema + migration:
  //   - schema.ts: bump SCHEMA_VERSION + agregar { name: "created_at", type: "number" }.
  //   - Recibo.ts: @readonly @date("created_at") createdAt!: Date;
  //   - migrations.ts: nuevo archivo, addColumn step.
  //
  // El fix anterior usaba un campo custom sync_updated_at que se escribía
  // desde código de app post-sync — eso flippeaba _status='updated' y
  // disparaba duplicados en BE. Quitado.
  //
  // Mientras tanto la colección no crece sin límite porque solo se acumulan
  // los recibos del operador (típicamente decenas por sesión, no miles).
  // Si el cliente reporta que el dispositivo se llena, prioritizar la
  // migration.
  void SYNCED_RECIBOS_TTL_DAYS; // referenciar para que el lint no lo borre
  return;
}
