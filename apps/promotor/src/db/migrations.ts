import {
  addColumns,
  createTable,
  schemaMigrations,
} from "@nozbe/watermelondb/Schema/migrations";

/**
 * Migraciones del SQLite local.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * ---------------------------
 * Cuando el APK trae un `SCHEMA_VERSION` mayor que el de la base que ya está en el
 * teléfono, WMDB busca acá cómo llevarla de una versión a la otra. Si no encuentra
 * el camino, lo único que puede hacer es BORRAR la base y bajarla de nuevo — y lo
 * que el promotor había capturado sin sincronizar no está en ningún otro lado.
 *
 * O sea: la migración faltante no se nota en desarrollo (donde uno limpia los datos
 * a mano igual) y se cobra el día de la primera actualización en campo.
 *
 * REGLA: todo cambio de schema entra con su paso acá y su bump de versión, en el
 * mismo commit que la columna nueva. Nunca "después".
 *
 * Las migraciones sólo agregan; nunca renombran ni borran columnas. Si una columna
 * queda sin uso, se deja muerta: es más barato que una migración destructiva que
 * puede fallar a mitad de camino en un teléfono ajeno.
 */
export const migrations = schemaMigrations({
  migrations: [
    {
      // v1 → v2: veredicto de Hacienda (ATV) en la solicitud + bitácora local.
      toVersion: 2,
      steps: [
        addColumns({
          table: "solicitudes",
          columns: [
            { name: "resultado_atv", type: "number", isOptional: true },
            { name: "consultado_atv", type: "number", isOptional: true },
          ],
        }),
        createTable({
          name: "bitacora",
          columns: [
            { name: "tipo", type: "string", isIndexed: true },
            { name: "ok", type: "boolean" },
            { name: "resumen", type: "string" },
            { name: "detalle", type: "string", isOptional: true },
            { name: "error", type: "string", isOptional: true },
            { name: "duracion_ms", type: "number", isOptional: true },
            { name: "created_at", type: "number", isIndexed: true },
          ],
        }),
      ],
    },
    {
      // v2 → v3: el id NUMÉRICO del servidor, además del id de identidad.
      //
      // Las bidireccionales usan el ClientUuid como id para no duplicarse al volver del
      // servidor, y eso dejaba al cliente sin el id numérico — que es el que necesitan
      // los adjuntos (/attachments/{Entidad}/{serverId}) y la consulta ATV de una
      // solicitud ya sincronizada. Se resolvía por el id local (si era numérico) o por
      // la tabla `server_ids` (mapeos de push de ESTE teléfono), y faltaba el caso más
      // común en un teléfono nuevo: la fila bajó de un pull y este dispositivo nunca la
      // pusheó. Ver v1.53/RC/54.
      toVersion: 3,
      steps: [
        addColumns({
          table: "solicitudes",
          columns: [{ name: "server_id", type: "string", isOptional: true }],
        }),
        addColumns({
          table: "visitas",
          columns: [{ name: "server_id", type: "string", isOptional: true }],
        }),
        addColumns({
          table: "entregadores",
          columns: [{ name: "server_id", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // v3 → v4: GPS exigible por tipo de visita, con la omisión registrada.
      //
      // `requiere_gps` en el tipo y `gps_omitido` en la visita. El legacy rechaza una
      // visita sin GPS; acá se exige sin prohibir, porque bajo sombra de cafetal el fix
      // puede no llegar y perder la visita entera es peor que perder el punto. Ver
      // v1.53/RC/57.
      toVersion: 4,
      steps: [
        addColumns({
          table: "tipos_visita",
          columns: [{ name: "requiere_gps", type: "number", isOptional: true }],
        }),
        addColumns({
          table: "visitas",
          columns: [{ name: "gps_omitido", type: "number", isOptional: true }],
        }),
      ],
    },
  ],
});
