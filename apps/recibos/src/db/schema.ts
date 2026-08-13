import { appSchema, tableSchema } from "@nozbe/watermelondb";

/**
 * Schema WMDB de la app `recibos`.
 *
 * Los nombres de tabla son EXACTAMENTE los `CollectionName` de mt.MobileCollections, y
 * los de columna los alias snake_case de su `ColumnsJson`. Cambiar uno sin el otro rompe
 * el sync **en silencio**: el pull trae la columna, WMDB no la reconoce y la descarta.
 *
 * WMDB agrega solo por tabla: `id` (PK string), `_status`, `_changed`.
 *
 * IDENTIDAD DE LAS FILAS CREADAS SIN SEÑAL
 * ----------------------------------------
 * `bitacoras` y `recibos` son bidireccionales y las crea el teléfono. Sin identidad
 * estable pasaría esto: el push las crea en el servidor, que asigna otro id; el pull
 * siguiente las devuelve con ese id; WMDB no lo reconoce e inserta una segunda fila.
 *
 * Por eso viajan con `client_uuid` y el BE lo proyecta como `id` en el pull. Exige que
 * el id local sea un UUID válido —la columna del servidor es UNIQUEIDENTIFIER— y los que
 * genera WMDB no lo son, así que al crear se fuerza `_raw.id` con un uuid v4 propio.
 *
 * EL CÁLCULO NO VIVE ACÁ. Los castigos y el precio los resuelve `@erp/recibos-calc`
 * contra los catálogos de abajo, y el resultado se guarda en el recibo. Ver
 * `docs/app-recibos-design.md` §5.
 */

/**
 * Cada bump necesita su paso en `db/migrations.ts`, en el MISMO commit. Sin eso WMDB no
 * tiene cómo actualizar la base del teléfono y **la borra** — con los recibos del día
 * adentro, si todavía no cerraron la bitácora.
 *
 *   1 → schema inicial
 */
export const SCHEMA_VERSION = 1;

/**
 * Orden de sync. Importa para el push: **la bitácora sube antes que sus recibos**, para
 * que el BE pueda resolver la FK contra mt.MobileIdMap. Los catálogos van primero por
 * prolijidad; son pull-only y el orden les da igual.
 */
export const COLLECTIONS = [
  // Catálogos del cálculo — no tienen pantalla, sólo alimentan a recibos-calc.
  "castigos_broca",
  "castigos_cosecha",
  "recibidor_nivel",
  "precios",
  // Catálogos de consulta y selección.
  "zonas",
  "tipos_cafe",
  "tipos_castigo",
  "calidades",
  "certificados",
  "cosechas",
  "recibidores",
  "transportistas",
  "provincias",
  "cantones",
  "distritos",
  "productores",
  "fincas",
  "cuotas",
  "cuota_entregadores",
  // Bidireccionales. La bitácora ANTES que los recibos.
  "bitacoras",
  "recibos",
] as const;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    // ─── Cálculo ────────────────────────────────────────────────────────────
    // Matriz de 21 granos × 60 cantidades. Se consulta por bloques de 100.
    tableSchema({
      name: "castigos_broca",
      columns: [
        { name: "granosbroca", type: "number" },
        { name: "cantidad", type: "number" },
        { name: "cuartilloscastigo", type: "number" },
      ],
    }),
    // Tope aceptado y % por cosecha/nivel/tipo (1 verde, 2 flote maduro, 3 seco).
    tableSchema({
      name: "castigos_cosecha",
      columns: [
        { name: "cosecha", type: "string", isIndexed: true },
        { name: "nivel", type: "number" },
        { name: "tipocastigo", type: "number" },
        { name: "topeaceptado", type: "number", isOptional: true },
        { name: "pctcastigo", type: "number", isOptional: true },
      ],
    }),
    tableSchema({
      name: "recibidor_nivel",
      columns: [
        { name: "recibidor", type: "string", isIndexed: true },
        { name: "cosecha", type: "string" },
        { name: "nivel", type: "number" },
      ],
    }),
    // Las columnas opcionales (zona, recibidor, tipo, codigo) son parte del criterio
    // de desempate del precio, no adorno: buscarPrecio() ordena por ellas.
    tableSchema({
      name: "precios",
      columns: [
        { name: "idreprecio", type: "number" },
        { name: "cosecha", type: "string", isIndexed: true },
        { name: "tipocafe", type: "string", isOptional: true },
        { name: "calidad", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        { name: "recibidor", type: "string", isOptional: true },
        { name: "tipo", type: "string", isOptional: true },
        { name: "codigo", type: "string", isOptional: true },
        { name: "monto", type: "number" },
        { name: "moneda", type: "number" },
        { name: "recalcula", type: "number" },
        { name: "flete", type: "number" },
      ],
    }),

    // ─── Catálogos de selección ─────────────────────────────────────────────
    tableSchema({
      name: "zonas",
      columns: [
        { name: "zona", type: "string" },
        { name: "nombre", type: "string", isOptional: true },
        { name: "tipocafe", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "tipos_cafe",
      columns: [
        { name: "tipocafe", type: "string" },
        { name: "nombre", type: "string", isOptional: true },
        { name: "idcertificado", type: "number", isOptional: true },
      ],
    }),
    tableSchema({
      name: "tipos_castigo",
      columns: [
        { name: "tipocastigo", type: "number" },
        { name: "nombre", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "calidades",
      columns: [
        { name: "calidad", type: "string" },
        { name: "nombre", type: "string", isOptional: true },
        { name: "idcertificado", type: "number", isOptional: true },
      ],
    }),
    tableSchema({
      name: "certificados",
      columns: [
        { name: "idcertificado", type: "number" },
        { name: "nombre", type: "string", isOptional: true },
        { name: "premio", type: "number", isOptional: true },
        { name: "porcentaje", type: "number", isOptional: true },
      ],
    }),
    tableSchema({
      name: "cosechas",
      columns: [
        { name: "cosecha", type: "string" },
        { name: "descripcion", type: "string", isOptional: true },
        { name: "digitarrecibos", type: "number", isOptional: true },
      ],
    }),
    // codigozona y tipocafe NO son decorativos: entran al criterio del precio.
    tableSchema({
      name: "recibidores",
      columns: [
        { name: "recibidor", type: "string", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        { name: "codigozona", type: "string", isOptional: true },
        { name: "tipocafe", type: "string", isOptional: true },
        { name: "tipo", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "transportistas",
      columns: [
        { name: "transportista", type: "string" },
        { name: "nombre", type: "string", isOptional: true },
      ],
    }),

    // Geografía: fija y chica (7 / 82 / ~490). Hace falta para imprimir el lugar.
    tableSchema({
      name: "provincias",
      columns: [
        { name: "codigo", type: "number", isOptional: true },
        { name: "provincia", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "cantones",
      columns: [
        { name: "id_provincia", type: "number", isIndexed: true },
        { name: "codigo", type: "number", isOptional: true },
        { name: "canton", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "distritos",
      columns: [
        { name: "id_provincia", type: "number" },
        { name: "id_canton", type: "number", isIndexed: true },
        { name: "codigo", type: "number", isOptional: true },
        { name: "distrito", type: "string", isOptional: true },
      ],
    }),

    // ─── Productores y lo que cuelga de ellos ───────────────────────────────
    // `tipo` y `codigo` entran al cálculo del precio; `zona` es el criterio del
    // recorte que hace el servidor.
    tableSchema({
      name: "productores",
      columns: [
        { name: "codigo", type: "string", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "cedula", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "telefono", type: "string", isOptional: true },
        { name: "tipo", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        { name: "recibidor", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "fincas",
      columns: [
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
      ],
    }),
    // Sin `cuota` ni `premio`: sólo importa que la cuota EXISTA. Bajar el monto
    // obligaría a llevar un saldo que offline nunca estaría al día.
    tableSchema({
      name: "cuotas",
      columns: [
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "id_certificado", type: "number" },
        { name: "cosecha", type: "string" },
      ],
    }),
    // Quién puede entregar contra una cuota. Sin esto, un entregador ajeno pasaría
    // como certificado.
    tableSchema({
      name: "cuota_entregadores",
      columns: [
        { name: "id_cuota", type: "number", isIndexed: true },
        { name: "id_socio", type: "number", isIndexed: true },
      ],
    }),

    // ─── Bidireccionales ────────────────────────────────────────────────────
    // Cerrada ⇔ hora_final no nula. No hay columna de estado a propósito: una
    // condición derivada de los datos no puede quedar inconsistente con ellos.
    tableSchema({
      name: "bitacoras",
      columns: [
        { name: "server_id", type: "string", isOptional: true },
        { name: "recibidor", type: "string", isIndexed: true },
        { name: "cosecha", type: "string" },
        { name: "tipocafe", type: "string", isOptional: true },
        { name: "fecha", type: "number", isOptional: true },
        { name: "hora_inicio", type: "number", isOptional: true },
        { name: "hora_final", type: "number", isOptional: true },
        { name: "medidor", type: "string", isOptional: true },
        { name: "transportista", type: "string", isOptional: true },
        { name: "placacamion", type: "string", isOptional: true },
        { name: "observaciones", type: "string", isOptional: true },
        // Locales, no viajan: el contador de impresiones y el estado de la jornada.
        { name: "impresiones", type: "number" },
      ],
    }),
    // `tipo_cafe` acá y no `zona`: en el servidor ese código viaja en la columna
    // `zona`, un nombre engañoso que ya costó una trampa. La proyección lo expone
    // con su nombre real (ver mt.MobileCollections).
    tableSchema({
      name: "recibos",
      columns: [
        { name: "server_id", type: "string", isOptional: true },
        { name: "id_bitacora", type: "string", isIndexed: true },
        { name: "recibo", type: "string", isIndexed: true },
        { name: "fecha", type: "number", isOptional: true },
        { name: "recibidor", type: "string" },
        { name: "cosecha", type: "string" },
        { name: "calidad", type: "string", isOptional: true },
        { name: "tipo_cafe", type: "string", isOptional: true },
        { name: "nivel", type: "number", isOptional: true },
        // Quién entrega
        { name: "id_socio", type: "number", isOptional: true },
        { name: "codigo", type: "string", isOptional: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "cedula", type: "string", isOptional: true },
        { name: "id_finca", type: "number", isOptional: true },
        { name: "id_certificado", type: "number", isOptional: true },
        { name: "cldd", type: "number", isOptional: true },
        { name: "observaciones", type: "string", isOptional: true },
        // Medida y defectos. `errormedidor` NO se captura: es de quien hace recibos
        // a mano, y su ausencia es lo que mantiene la invariante de cuartillos.
        { name: "cantidadinicial", type: "number" },
        { name: "cuartillosinicial", type: "number" },
        { name: "granosbrocados", type: "number" },
        { name: "verdes", type: "number" },
        { name: "flotemaduro", type: "number" },
        { name: "floteseco", type: "number" },
        // Calculado por @erp/recibos-calc y guardado con el recibo.
        { name: "broca", type: "number" },
        { name: "cuartillosbroca", type: "number" },
        { name: "rebajoverde", type: "number" },
        { name: "cuartillosrebajoverde", type: "number" },
        { name: "rebajoflote", type: "number" },
        { name: "cuartillosrebajoflote", type: "number" },
        { name: "rebajofloteseco", type: "number" },
        { name: "cuartillosrebajofloteseco", type: "number" },
        { name: "cantidad", type: "number" },
        { name: "rcantidad", type: "number" },
        { name: "rcantidadcuartillos", type: "number" },
        // Precio
        { name: "idreprecio", type: "number", isOptional: true },
        { name: "precio", type: "number", isOptional: true },
        { name: "imoneda", type: "number", isOptional: true },
        { name: "moneda", type: "string", isOptional: true },
        { name: "manual", type: "number", isOptional: true },
        { name: "cobrarflete", type: "number", isOptional: true },
        { name: "flete", type: "number", isOptional: true },
        { name: "tarifaflete", type: "number", isOptional: true },
        { name: "valor", type: "number", isOptional: true },
        { name: "pagado", type: "number", isOptional: true },
        { name: "saldo", type: "number", isOptional: true },
        // `impreso` es el CampoCierre: mientras esté en 0 el recibo no sincroniza.
        // Es tinyint en el servidor, así que sirve de contador: 1 original, 2+ copias.
        { name: "impreso", type: "number" },
        { name: "origen", type: "number" },
        { name: "agregado", type: "number", isOptional: true },
      ],
    }),

    // ─── Local, no viaja ────────────────────────────────────────────────────
    // "Eventos" y no "bitácora": en esta app esa palabra es el cuaderno del
    // recibidor. Ver docs/app-recibos-design.md §1.
    tableSchema({
      name: "eventos",
      columns: [
        { name: "tipo", type: "string" },
        { name: "ok", type: "boolean" },
        { name: "resumen", type: "string" },
        { name: "detalle", type: "string", isOptional: true },
        { name: "creado_en", type: "number" },
      ],
    }),
  ],
});
