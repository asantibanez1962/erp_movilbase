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
      // El estado del productor: el servidor rechaza los recibos de uno inactivo y el
      // teléfono no tenía cómo saberlo. Ver v1.71/RC/63.
      toVersion: 11,
      steps: [
        addColumns({
          table: "productores",
          columns: [{ name: "estado", type: "number" }],
        }),
      ],
    },
    {
      // De qué talonario salió el número del recibo. En el web lo pone el hook del
      // consecutivo; en el móvil el número lo asigna el teléfono, así que el hook no
      // corre y el campo quedaba en NULL. Ver v1.71/RC/61.
      toVersion: 10,
      steps: [
        addColumns({
          table: "recibos",
          columns: [{ name: "idtalonario", type: "number", isOptional: true }],
        }),
      ],
    },
    {
      // Los defectos de control de calidad. ⚠️ No castigan: el cálculo no cambia.
      // Ver v1.71/RC/49.
      toVersion: 9,
      steps: [
        addColumns({
          table: "recibos",
          columns: [
            { name: "pinton", type: "number" },
            { name: "granopasa", type: "number" },
            { name: "flotenegro", type: "number" },
          ],
        }),
        addColumns({
          table: "remedidas",
          columns: [
            { name: "pinton", type: "number" },
            { name: "granopasa", type: "number" },
            { name: "flotenegro", type: "number" },
          ],
        }),
        addColumns({
          table: "companias",
          columns: [{ name: "ben_defectos", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // La nota legal del recibo, que es de cada beneficio. Ver v1.71/RC/48.
      toVersion: 8,
      steps: [
        addColumns({
          table: "companias",
          columns: [{ name: "ben_nota_recibo", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // El encabezado del tiquete pasa a ge_companias. Ver v1.71/RC/46.
      //
      // `parametros` NO se borra: WatermelonDB no sabe eliminar tablas en una migración, y
      // forzarlo no vale la pena. Deja de aparecer en COLLECTIONS, así que no sincroniza
      // más; en los teléfonos que alcanzaron la 6 queda una tabla muerta que nadie
      // consulta. En los demás nunca llega a existir.
      toVersion: 7,
      steps: [
        createTable({
          name: "companias",
          columns: [
            { name: "ben_nombre", type: "string" },
            { name: "ben_direccion1", type: "string", isOptional: true },
            { name: "ben_direccion2", type: "string", isOptional: true },
            { name: "ben_direccion3", type: "string", isOptional: true },
            { name: "ben_telefono", type: "string", isOptional: true },
            { name: "ben_email", type: "string", isOptional: true },
            { name: "ben_codigoicafe", type: "string", isOptional: true },
          ],
        }),
      ],
    },
    {
      // Lo que el comprobante necesita para identificar a quién emite y dónde queda el
      // productor. Ver v1.71/RC/43 y /45.
      toVersion: 6,
      steps: [
        createTable({
          name: "parametros",
          columns: [
            { name: "nombrecompania", type: "string" },
            { name: "direccion1", type: "string", isOptional: true },
            { name: "direccion2", type: "string", isOptional: true },
            { name: "direccion3", type: "string", isOptional: true },
            { name: "telefono", type: "string", isOptional: true },
            { name: "email", type: "string", isOptional: true },
            { name: "codigoicafe", type: "string", isOptional: true },
          ],
        }),
        addColumns({
          table: "productores",
          columns: [
            { name: "id_provincia", type: "number", isOptional: true },
            { name: "id_canton", type: "number", isOptional: true },
            { name: "id_distrito", type: "number", isOptional: true },
            { name: "ubicacion", type: "string", isOptional: true },
            { name: "direccion", type: "string", isOptional: true },
          ],
        }),
        addColumns({
          table: "fincas",
          columns: [{ name: "ubicacion", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // `client_uuid` en las cuatro que el teléfono origina. Sin él la fila que vuelve del
      // servidor no se reconoce y se duplica — y eso no se ve al guardar ni en el primer
      // sync, sino en el segundo.
      toVersion: 5,
      steps: [
        addColumns({
          table: "bitacoras",
          columns: [{ name: "client_uuid", type: "string", isIndexed: true }],
        }),
        addColumns({
          table: "recibos",
          columns: [{ name: "client_uuid", type: "string", isIndexed: true }],
        }),
        addColumns({
          table: "remedidas",
          columns: [{ name: "client_uuid", type: "string", isIndexed: true }],
        }),
        addColumns({
          table: "remedida_rutas",
          columns: [{ name: "client_uuid", type: "string", isIndexed: true }],
        }),
      ],
    },
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
