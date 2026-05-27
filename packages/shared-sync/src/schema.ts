import { appSchema, tableSchema } from "@nozbe/watermelondb";

/**
 * WatermelonDB schema. Cada bump de schemaVersion requiere agregar
 * migration step en migrations.ts (pendiente cuando aparezca el primer
 * cambio post-release).
 *
 * WMDB built-ins por tabla:
 *   - id              string PK
 *   - _status         created | updated | synced (managed by WMDB)
 *   - _changed        list of changed fields (managed by WMDB)
 *
 * No declaramos esos — WMDB los agrega automático.
 */

export const SCHEMA_VERSION = 2;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: "productores",
      columns: [
        { name: "codigo", type: "string", isOptional: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "apellido1", type: "string", isOptional: true },
        { name: "apellido2", type: "string", isOptional: true },
        { name: "nombrecomercial", type: "string", isOptional: true },
        { name: "identificacion", type: "string", isOptional: true },
        { name: "telefonos", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "compania", type: "number" },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
    tableSchema({
      name: "recibos",
      columns: [
        { name: "numero_recibo", type: "string" },
        { name: "socio_id", type: "number", isIndexed: true },
        { name: "fecha", type: "string" },
        { name: "cantidad", type: "number" },
        { name: "precio", type: "number" },
        { name: "compania", type: "number" },
        // push_status / push_error: NUESTROS fields (no del wire del BE).
        // null → pending (todavía no se intentó o pendiente próximo sync);
        // 'rejected' → BE rechazó el push, push_error tiene el motivo.
        // (No usamos 'syncStatus' como nombre porque WMDB Model base ya
        // tiene esa propiedad interna con un enum específico.)
        { name: "push_status", type: "string", isOptional: true },
        { name: "push_error", type: "string", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
  ],
});
