import { appSchema, tableSchema } from "@nozbe/watermelondb";

/**
 * Schema WMDB de la app 'promotor'.
 *
 * Los nombres de tabla son EXACTAMENTE los CollectionName de mt.MobileCollections
 * (el syncEngine mapea colección → tabla 1:1), y los nombres de columna los alias
 * snake_case de ColumnsJson. Cambiar uno sin el otro rompe el sync en silencio.
 *
 * WMDB agrega solo por tabla: id (PK string), _status, _changed.
 *
 * `sync_deleted_at` NO se declara aunque el pull lo proyecte: las filas con
 * tombstone nunca llegan como `updated` (el servicio las manda en `deleted`), así
 * que la columna local sería siempre null. Mismo criterio que recibos-cr.
 *
 * IDENTIDAD DE LAS FILAS CREADAS EN EL TELÉFONO
 * ---------------------------------------------
 * solicitudes / entregadores / visitas son bidireccionales, y eso trae un
 * problema que recibos-cr no tiene (su colección es push-only):
 *
 *   1. el teléfono crea la fila con id local
 *   2. el push la crea en el servidor, que le asigna OTRO id (identity)
 *   3. el pull siguiente la devuelve con el id del servidor
 *   4. WMDB no reconoce ese id → inserta una SEGUNDA fila = duplicado
 *
 * Solución: la fila viaja con su `client_uuid`, y el BE proyecta ese uuid como
 * `id` en el pull cuando existe. La identidad queda estable a ambos lados.
 *
 * Eso exige que el id local sea un UUID válido (la columna del servidor es
 * UNIQUEIDENTIFIER), y los ids que genera WMDB no lo son — por eso al crear
 * cualquiera de estas tres se fuerza `_raw.id` con un uuid v4 propio
 * (ver src/lib/crear.ts).
 */

export const SCHEMA_VERSION = 1;

/**
 * Orden de sync. Importa para el push: el padre tiene que subir antes que el hijo
 * para que el BE pueda resolver la FK contra mt.MobileIdMap (ver syncEngine).
 * Los catálogos van primero por prolijidad — son pull-only, el orden les da igual.
 */
export const COLLECTIONS = [
  "tipos_visita",
  "productores",
  "fincas",
  "solicitudes",
  "entregadores",
  "visitas",
] as const;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    // ─── Catálogos (pull-only) ──────────────────────────────────────────
    tableSchema({
      name: "tipos_visita",
      columns: [
        { name: "nombre", type: "string", isOptional: true },
        { name: "tipos_visita", type: "number", isOptional: true },
        // Gobiernan el form de la visita: requiere_finca obliga a elegir finca,
        // requiere_solicitud habilita el link a la solicitud de crédito.
        { name: "requiere_finca", type: "number", isOptional: true },
        { name: "requiere_solicitud", type: "number", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
    tableSchema({
      name: "productores",
      columns: [
        { name: "codigo", type: "string", isOptional: true },
        // Código con el que un entregador se liga a su solicitud. NO es el
        // mismo que `codigo`: son columnas distintas de ge_Socio y difieren en
        // cientos de socios. Ver v1.53/RC/06.
        { name: "rc_codigo", type: "string", isOptional: true },
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
      name: "fincas",
      columns: [
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "nombre_finca", type: "string", isOptional: true },
        { name: "ubicacion", type: "string", isOptional: true },
        { name: "area", type: "number", isOptional: true },
        { name: "altitud", type: "number", isOptional: true },
        { name: "id_region", type: "number", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),

    // ─── Solicitudes de crédito (bidireccional) ─────────────────────────
    tableSchema({
      name: "solicitudes",
      columns: [
        { name: "id_socio", type: "number", isIndexed: true, isOptional: true },
        { name: "codigo", type: "string", isOptional: true },
        { name: "fecha", type: "number", isOptional: true },
        { name: "cosecha", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        // Rubros
        { name: "efectivo", type: "number", isOptional: true },
        { name: "insumos", type: "number", isOptional: true },
        { name: "almacigo", type: "number", isOptional: true },
        { name: "formalizacion", type: "number", isOptional: true },
        { name: "otros", type: "number", isOptional: true },
        { name: "total", type: "number", isOptional: true },
        // Plan / estimados
        { name: "plan_inversion", type: "string", isOptional: true },
        { name: "motivo", type: "string", isOptional: true },
        { name: "entrega_estimada", type: "number", isOptional: true },
        { name: "prod_estimada", type: "number", isOptional: true },
        { name: "aprobado", type: "number", isOptional: true },
        { name: "estado", type: "number", isOptional: true },
        // Read-only desde el móvil: los escribe el hook del BE cuando entra
        // la visita de validación de crédito.
        { name: "prod_estimada_promotor", type: "number", isOptional: true },
        { name: "inspeccion_campo", type: "number", isOptional: true },
        { name: "client_uuid", type: "string", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "push_status", type: "string", isOptional: true },
        { name: "push_error", type: "string", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
    tableSchema({
      name: "entregadores",
      columns: [
        // string, no number: guarda el id LOCAL de la solicitud padre — el id
        // del servidor si vino de un pull, o el uuid propio si se creó offline.
        // El BE lo resuelve contra mt.MobileIdMap al pushear.
        { name: "id_solicitud", type: "string", isIndexed: true },
        // La relación real con el productor. No necesita ser string como
        // id_solicitud: productores es pull-only, así que siempre es un id de
        // servidor y nunca un uuid local.
        { name: "id_socio", type: "number", isIndexed: true, isOptional: true },
        // Denormalizado desde id_socio (ge_Socio.rc_codigo). Se conserva porque
        // el legacy PB vincula por código.
        { name: "codigo", type: "string", isOptional: true },
        { name: "client_uuid", type: "string", isOptional: true },
        { name: "push_status", type: "string", isOptional: true },
        { name: "push_error", type: "string", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),

    // ─── Visitas de campo (bidireccional) ───────────────────────────────
    tableSchema({
      name: "visitas",
      columns: [
        { name: "id_tipo_visita", type: "number" },
        { name: "id_socio", type: "number", isIndexed: true, isOptional: true },
        { name: "cosecha", type: "string", isOptional: true },
        { name: "id_finca", type: "number", isOptional: true },
        { name: "id_usuario_promotor", type: "number", isOptional: true },
        // Mismo criterio que entregadores.id_solicitud.
        { name: "id_solicitud", type: "string", isOptional: true, isIndexed: true },
        { name: "fecha", type: "number", isOptional: true },
        { name: "observaciones", type: "string", isOptional: true },
        { name: "gps_lat", type: "number", isOptional: true },
        { name: "gps_lng", type: "number", isOptional: true },
        { name: "prod_estimada_promotor", type: "number", isOptional: true },
        { name: "estado", type: "number", isOptional: true },
        { name: "client_uuid", type: "string", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "push_status", type: "string", isOptional: true },
        { name: "push_error", type: "string", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),

    // ─── Cola local de fotos (NO se sincroniza) ─────────────────────────
    // No está en COLLECTIONS ni en mt.MobileCollections: las fotos no viajan
    // por el sync (es JSON), suben aparte a POST /attachments/Visita/{serverId}
    // una vez que la visita fue aceptada y tiene id del servidor.
    tableSchema({
      name: "pending_uploads",
      columns: [
        { name: "visita_local_id", type: "string", isIndexed: true },
        { name: "file_uri", type: "string" },
        { name: "status", type: "string", isIndexed: true }, // 'pending' | 'error'
        { name: "error", type: "string", isOptional: true },
        { name: "created_at", type: "number" },
      ],
    }),
  ],
});
