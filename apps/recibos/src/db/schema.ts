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
 *   2 → `cldd` en fincas y `activo` en cuotas/entregadores: sin esos tres datos el
 *        teléfono no puede reproducir offline los defaults que el web resuelve con
 *        sp_rc_recibo_finca_default. Ver v1.71/RC/34.
 *        Y la tabla `talonarios`, de donde sale el contador del servidor. Ver
 *        v1.71/RC/35.
 *   3 → `niveles`: el nivel se muestra por su nombre (Inicios, Centro, Finales) y no
 *        por su número. Ver v1.71/RC/36.
 *   4 → `remedidas` y `remedida_rutas`: la remedida se captura en el sitio del camión,
 *        que no tiene PC ni red. Ver v1.71/RC/39 y /40.
 *   5 → `client_uuid` en las cuatro que el teléfono origina. Estaba documentado desde
 *        el principio y nunca se implementó: la primera jornada subió con ClientUuid
 *        en NULL y el push la dio por aceptada.
 *   6 → lo que el comprobante necesita: `parametros` (quién emite), la geografía del
 *        productor y la ubicación de la finca. Ver v1.71/RC/43 y /45.
 *   7 → `companias`: el encabezado del tiquete sale de los `ben_*` de ge_companias,
 *        que están previstos para eso, y no de re_parametros —la tabla del legacy,
 *        de una fila y sin compañía— que es lo que la 6 había registrado por error.
 *        `parametros` deja de sincronizar. Ver v1.71/RC/46.
 *   8 → `ben_nota_recibo`: la nota legal del pie es texto de CADA BENEFICIO, no del
 *        sistema. Estaba escrita dentro del .frx. Ver v1.71/RC/48.
 *   9 → `pinton`, `granopasa` y `flotenegro` en recibos y remedidas, y la lista de
 *        cuáles usa cada beneficio. ⚠️ SÓLO REGISTRAN: son control de calidad y no
 *        producen rebajo, así que el cálculo no cambia. Ver v1.71/RC/49.
 */
export const SCHEMA_VERSION = 9;

/**
 * Orden de sync. Importa para el push: **la bitácora sube antes que sus recibos**, para
 * que el BE pueda resolver la FK contra mt.MobileIdMap. Los catálogos van primero por
 * prolijidad; son pull-only y el orden les da igual.
 */
export const COLLECTIONS = [
  // Catálogos del cálculo — no tienen pantalla, sólo alimentan a recibos-calc.
  "castigos_broca",
  "castigos_cosecha",
  "talonarios",
  "niveles",
  "companias",
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
  // Bidireccionales. El PADRE antes que sus hijos: el BE resuelve la FK del hijo contra
  // mt.MobileIdMap, que sólo tiene la entrada del padre si el padre ya subió.
  "bitacoras",
  "recibos",
  "remedidas",
  "remedida_rutas",
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
        // La UBICACION del comprobante sale de estos tres ids contra la geografía.
        // Es la forma NUEVA (ge_Socio.h_provincia/h_canton/h_distrito); el código
        // empaquetado `ubicacion` queda de respaldo para los que aún no la tienen.
        { name: "id_provincia", type: "number", isOptional: true },
        { name: "id_canton", type: "number", isOptional: true },
        { name: "id_distrito", type: "number", isOptional: true },
        { name: "ubicacion", type: "string", isOptional: true },
        { name: "direccion", type: "string", isOptional: true },
        { name: "email", type: "string", isOptional: true },
        { name: "telefono", type: "string", isOptional: true },
        { name: "tipo", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        { name: "recibidor", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      // Los tramos de la cosecha: Inicios, Centro, Finales. Se muestran por nombre —
      // "Nivel 1" no le dice nada al recibidor e invita a confundirlo con la calidad.
      name: "niveles",
      columns: [
        { name: "nivel", type: "number", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      // Una sola fila por recibidor y cosecha: el talonario activo automático. De acá
      // sale la mitad de la regla `próximo = MAX(local, servidor)` que impide que un
      // teléfono reinstalado repita números ya entregados en papel.
      name: "talonarios",
      columns: [
        { name: "recibidor", type: "string", isIndexed: true },
        { name: "cosecha", type: "string" },
        { name: "inicio", type: "string" },
        { name: "final", type: "string" },
        /** ⚠️ NO es el último usado: es el PRÓXIMO. Ver §4 del design doc. */
        { name: "ultimo", type: "string" },
        { name: "tipo", type: "number" },
      ],
    }),
    // El encabezado del tiquete: quién lo emite. Baja UNA fila, la del usuario.
    //
    // Las tres líneas de dirección no son un capricho del modelo: son tres RENGLONES del
    // papel, cortados al ancho que aguanta la impresora, y le toca al usuario repartir el
    // texto entre ellas como le sirva.
    tableSchema({
      name: "companias",
      columns: [
        { name: "ben_nombre", type: "string" },
        { name: "ben_direccion1", type: "string", isOptional: true },
        { name: "ben_direccion2", type: "string", isOptional: true },
        { name: "ben_direccion3", type: "string", isOptional: true },
        { name: "ben_telefono", type: "string", isOptional: true },
        { name: "ben_email", type: "string", isOptional: true },
        { name: "ben_codigoicafe", type: "string", isOptional: true },
        // Con sus saltos de línea: los renglones son parte del texto legal.
        { name: "ben_nota_recibo", type: "string", isOptional: true },
        // Lista separada por comas de los defectos que esta empresa registra.
        { name: "ben_defectos", type: "string", isOptional: true },
      ],
    }),
    tableSchema({
      name: "fincas",
      columns: [
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
        // Se imprime debajo del productor cuando el recibo lleva finca.
        { name: "ubicacion", type: "string", isOptional: true },
        // Atributo de la FINCA, no del recibo: no se digita. De acá sale el `cldd` del
        // recibo al elegir el productor, igual que en el web.
        { name: "cldd", type: "number" },
      ],
    }),
    // Sin `cuota` ni `premio`: sólo importa que la cuota EXISTA. Bajar el monto
    // obligaría a llevar un saldo que offline nunca estaría al día.
    tableSchema({
      name: "cuotas",
      columns: [
        // La llave por la que la referencian los entregadores. Se proyecta explícita y
        // no se usa `id`: son dos columnas distintas de la tabla (`idcuotaprod` legacy e
        // `Id` nueva) que hoy coinciden por cómo se rellenaron, no por definición.
        { name: "id_cuota", type: "number", isIndexed: true },
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "id_certificado", type: "number" },
        { name: "cosecha", type: "string" },
        // El servidor filtra por Activo=1. Sin este dato el teléfono tomaría el
        // certificado de una cuota dada de baja, sin ningún error.
        { name: "activo", type: "number" },
      ],
    }),
    // Quién puede entregar contra una cuota. Sin esto, un entregador ajeno pasaría
    // como certificado.
    tableSchema({
      name: "cuota_entregadores",
      columns: [
        { name: "id_cuota", type: "number", isIndexed: true },
        { name: "id_socio", type: "number", isIndexed: true },
        { name: "activo", type: "number" },
      ],
    }),

    // ─── Remedida ───────────────────────────────────────────────────────────
    // El camión que llega de los recibidores, medido en el sitio de recepción. Ese sitio
    // NO tiene PC ni red, y por eso la remedida vive en el teléfono hasta que se imprime.
    //
    // No lleva tarifa, monto ni certificados: el flete lo calcula la oficina, y repartir
    // por certificado necesita los recibos de certificados de cada recibidor, que en el
    // sitio no se tienen. Tampoco los seis campos que la cosecha entera tiene en cero.
    tableSchema({
      name: "remedidas",
      columns: [
        { name: "server_id", type: "string", isOptional: true },
        // Igual al id local. Es lo que permite que la fila que vuelve del
        // servidor se reconozca en vez de duplicarse. Ver lib/crear.ts.
        { name: "client_uuid", type: "string", isIndexed: true },
        // sifón(3) + 6 dígitos. En el servidor es numérico; acá va como texto para no
        // perder los ceros de relleno al mostrarlo e imprimirlo.
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
        // Cajuelas con cuartillos en decimales: 29,50 son 29 cajuelas y 2 cuartillos.
        { name: "cantidad", type: "number" },
        { name: "verdes", type: "number" },
        { name: "flotemaduro", type: "number" },
        { name: "floteseco", type: "number" },
        { name: "granosbrocados", type: "number" },
        // Defectos de CONTROL DE CALIDAD: se registran y se imprimen, pero no
        // castigan. Cada beneficio declara cuáles usa; ver `Compania.defectos`.
        { name: "pinton", type: "number" },
        { name: "granopasa", type: "number" },
        { name: "flotenegro", type: "number" },
        { name: "medidor", type: "string", isOptional: true },
        { name: "observaciones", type: "string", isOptional: true },
        // Campo de cierre: 0 sin imprimir, 1 original, 2+ copias.
        { name: "impreso", type: "number" },
      ],
    }),
    // De qué recibidores venía el camión. Del móvil viaja SÓLO el recibidor: la hora de
    // salida no se usa (0 de 5177 filas) y el flete es de la oficina.
    tableSchema({
      name: "remedida_rutas",
      columns: [
        { name: "server_id", type: "string", isOptional: true },
        // Igual al id local. Es lo que permite que la fila que vuelve del
        // servidor se reconozca en vez de duplicarse. Ver lib/crear.ts.
        { name: "client_uuid", type: "string", isIndexed: true },
        { name: "id_remedida", type: "string", isIndexed: true },
        { name: "recibidor", type: "string" },
      ],
    }),

    // ─── Bidireccionales ────────────────────────────────────────────────────
    // Cerrada ⇔ hora_final no nula. No hay columna de estado a propósito: una
    // condición derivada de los datos no puede quedar inconsistente con ellos.
    tableSchema({
      name: "bitacoras",
      columns: [
        { name: "server_id", type: "string", isOptional: true },
        // Igual al id local. Es lo que permite que la fila que vuelve del
        // servidor se reconozca en vez de duplicarse. Ver lib/crear.ts.
        { name: "client_uuid", type: "string", isIndexed: true },
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
        // Locales, no viajan: el contador de impresiones y el estado de la bitácora.
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
        // Igual al id local. Es lo que permite que la fila que vuelve del
        // servidor se reconozca en vez de duplicarse. Ver lib/crear.ts.
        { name: "client_uuid", type: "string", isIndexed: true },
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
        // Defectos de CONTROL DE CALIDAD: se registran y se imprimen, pero no
        // castigan. Cada beneficio declara cuáles usa; ver `Compania.defectos`.
        { name: "pinton", type: "number" },
        { name: "granopasa", type: "number" },
        { name: "flotenegro", type: "number" },
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
