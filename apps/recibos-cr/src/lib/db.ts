import { createDatabase } from "@erp/shared-sync";

/**
 * Singleton de la WMDB Database del app. Llamado UNA vez al boot del app
 * (en bootstrapApi). Después se importa desde donde se necesite.
 */
export const database = createDatabase({ dbName: "recibos-cr" });
