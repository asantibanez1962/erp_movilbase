import {
  schemaMigrations,
  addColumns,
  createTable,
} from "@nozbe/watermelondb/Schema/migrations";

/**
 * Migraciones del esquema local.
 *
 * ⚠️ CADA BUMP DE SCHEMA_VERSION NECESITA SU PASO ACÁ, EN EL MISMO COMMIT. Sin la
 * migración, WMDB no tiene cómo actualizar la base del teléfono y **la borra** — con los
 * recibos del día adentro si la bitácora todavía no cerró, que es cuando el teléfono es
 * el único lugar donde existen.
 */
export const migrations = schemaMigrations({
  // ⚠️ EL ORDEN ES DESCENDENTE Y CADA VERSIÓN VA EN SU PROPIO PASO. Agregarle un step a
  // una versión que los teléfonos YA corrieron no hace nada: WatermelonDB guarda en qué
  // versión está cada base y sólo aplica las que faltan. La tabla nunca se crearía y las
  // consultas fallarían en runtime, no al compilar.
  migrations: [
    {
      // La remedida del sitio del camión. Ver v1.71/RC/39 y /40.
      toVersion: 4,
      steps: [
        createTable({
          name: "remedidas",
          columns: [
            { name: "server_id", type: "string", isOptional: true },
            { name: "recibo", type: "string", isIndexed: true },
            { name: "sifon", type: "string", isIndexed: true },
            { name: "recibidor", type: "string", isOptional: true },
            { name: "cosecha", type: "string" },
            { name: "fecha", type: "number", isOptional: true },
            { name: "calidad", type: "string", isOptional: true },
            { name: "tipocafe", type: "string", isOptional: true },
            { name: "transportista", type: "number", isOptional: true },
            { name: "placa", type: "string", isOptional: true },
            { name: "angarilla", type: "number", isOptional: true },
            { name: "cantidad", type: "number" },
            { name: "verdes", type: "number" },
            { name: "flotemaduro", type: "number" },
            { name: "floteseco", type: "number" },
            { name: "granosbrocados", type: "number" },
            { name: "medidor", type: "string", isOptional: true },
            { name: "observaciones", type: "string", isOptional: true },
            { name: "impreso", type: "number" },
          ],
        }),
        createTable({
          name: "remedida_rutas",
          columns: [
            { name: "server_id", type: "string", isOptional: true },
            { name: "id_remedida", type: "string", isIndexed: true },
            { name: "recibidor", type: "string" },
          ],
        }),
      ],
    },
    {
      // Los tramos de la cosecha —Inicios, Centro, Finales— para mostrar el nivel por su
      // nombre. Ver v1.71/RC/36.
      toVersion: 3,
      steps: [
        createTable({
          name: "niveles",
          columns: [
            { name: "nivel", type: "number", isIndexed: true },
            { name: "nombre", type: "string", isOptional: true },
          ],
        }),
      ],
    },
    {
      // Lo que le faltaba al teléfono para resolver offline los defaults que el web saca
      // de sp_rc_recibo_finca_default: el `cldd` sale de la finca, y el certificado sólo
      // de una cuota ACTIVA. Ver v1.71/RC/34.
      toVersion: 2,
      steps: [
        addColumns({
          table: "fincas",
          columns: [{ name: "cldd", type: "number" }],
        }),
        addColumns({
          table: "cuotas",
          columns: [
            { name: "id_cuota", type: "number", isIndexed: true },
            { name: "activo", type: "number" },
          ],
        }),
        addColumns({
          table: "cuota_entregadores",
          columns: [{ name: "activo", type: "number" }],
        }),
        // El contador del servidor, que es la mitad de `próximo = MAX(local, servidor)`.
        // Sin él un teléfono reinstalado repite números ya entregados en papel.
        createTable({
          name: "talonarios",
          columns: [
            { name: "recibidor", type: "string", isIndexed: true },
            { name: "cosecha", type: "string" },
            { name: "inicio", type: "string" },
            { name: "final", type: "string" },
            { name: "ultimo", type: "string" },
            { name: "tipo", type: "number" },
          ],
        }),
      ],
    },
  ],
});
