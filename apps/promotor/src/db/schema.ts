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

/**
 * Cada bump necesita su paso en db/migrations.ts, en el MISMO commit. Sin eso,
 * WMDB no tiene cómo actualizar la base del teléfono y la borra — con lo que el
 * promotor haya capturado y no sincronizado adentro. Ver la nota de migrations.ts.
 *
 *   1 → schema inicial
 *   2 → resultado_atv / consultado_atv en solicitudes + tabla bitacora
 *   3 → server_id en las bidireccionales (id numérico del servidor)
 */
export const SCHEMA_VERSION = 3;

/**
 * Orden de sync. Importa para el push: el padre tiene que subir antes que el hijo
 * para que el BE pueda resolver la FK contra mt.MobileIdMap (ver syncEngine).
 * Los catálogos van primero por prolijidad — son pull-only, el orden les da igual.
 */
export const COLLECTIONS = [
  "tipos_visita",
  "zonas",
  "recibidores",
  "tipos_desembolso",
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
    // Recibidores: destino de las visitas de tipo 0. Se bajan TODOS (119) sin
    // filtrar por zona aunque la tengan — un promotor puede necesitar registrar
    // una visita a un recibidor fuera de su zona.
    tableSchema({
      name: "recibidores",
      columns: [
        { name: "codigo", type: "string", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        { name: "ubicacion", type: "string", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
    // Zonas: traduce el código que viaja en los datos ('5') al nombre que el
    // promotor reconoce ('MIRAMAR'). /api/mobile/contexto ya trae los nombres de
    // SUS zonas, pero eso no alcanza para etiquetar la zona de una fila cualquiera
    // ni para el admin, que no tiene zonas específicas listadas.
    tableSchema({
      name: "zonas",
      columns: [
        { name: "codigo", type: "string", isIndexed: true },
        { name: "nombre", type: "string", isOptional: true },
        { name: "id_region", type: "number", isOptional: true },
        { name: "compania", type: "number", isOptional: true },
        { name: "sync_updated_at", type: "number", isIndexed: true },
      ],
    }),
    // Tipos de desembolso (Efectivo / Insumos / Carga Saldos / Insumos Feria).
    // Es el lookup de `solicitudes.tipo_credito`: de 937 solicitudes reales, 923
    // usan tipo+total y sólo 1 usa los rubros sueltos.
    tableSchema({
      name: "tipos_desembolso",
      columns: [
        { name: "id_tipo_desembolso", type: "number" },
        { name: "nombre", type: "string", isOptional: true },
        { name: "requiere_insumo", type: "number", isOptional: true },
        { name: "requiere_banco", type: "number", isOptional: true },
        { name: "requiere_fe", type: "number", isOptional: true },
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
        // `nombre` es el COMPUESTO (apellido1 + apellido2 + nombrep); `nombrep` es
        // sólo el nombre de pila. Ver la nota en models.ts.
        { name: "nombre", type: "string", isOptional: true },
        { name: "nombrep", type: "string", isOptional: true },
        { name: "apellido1", type: "string", isOptional: true },
        { name: "apellido2", type: "string", isOptional: true },
        // La solicitud hereda la zona del productor en vez de pedirla.
        { name: "rc_zona", type: "string", isOptional: true, isIndexed: true },
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
        // Id NUMÉRICO del servidor, aparte del `id` de identidad.
        //
        // Hace falta porque en las bidireccionales el `id` es el ClientUuid (para que la
        // fila no se duplique al volver del servidor), y hay cosas que sólo funcionan con
        // el numérico: subir un adjunto y consultar ATV de una solicitud ya sincronizada.
        // Antes se deducía —del id local si era numérico, o de `server_ids` si este
        // teléfono la había pusheado— y faltaba el caso más común en un teléfono nuevo:
        // la fila bajó de un pull y este dispositivo nunca la pusheó. Ver v1.53/RC/54.
        //
        // Null mientras la fila no subió: todavía no tiene id de servidor.
        { name: "server_id", type: "string", isOptional: true },
        { name: "id_socio", type: "number", isIndexed: true, isOptional: true },
        { name: "codigo", type: "string", isOptional: true },
        { name: "fecha", type: "number", isOptional: true },
        { name: "cosecha", type: "string", isOptional: true },
        { name: "zona", type: "string", isOptional: true },
        // Variante vigente: un tipo de desembolso + el total. FK a
        // tipos_desembolso.id_tipo_desembolso.
        { name: "tipo_credito", type: "number", isOptional: true },
        // Rubros — la otra variante del master. Se siguen bajando para que las
        // solicitudes históricas se vean, pero el móvil ya no las captura.
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
        // 0/null = pendiente · 1 = aprobada · 2 = rechazada. Lo resuelve la
        // oficina desde la web; el móvil sólo lo muestra.
        { name: "estado", type: "number", isOptional: true },
        // Veredicto de Hacienda (ATV). NO son campos de captura: los escribe
        // únicamente la consulta a /api/mobile/hacienda/atv y viajan al servidor
        // con el push. 0 = no se pudo consultar · 1 = no inscrito ·
        // 2 = inscrito sin café · 3 = inscrito con café (CIIU 0127).
        { name: "resultado_atv", type: "number", isOptional: true },
        { name: "consultado_atv", type: "number", isOptional: true },
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
        /** Id numérico del servidor. Ver la nota en `solicitudes`. */
        { name: "server_id", type: "string", isOptional: true },
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
        /** Id numérico del servidor. Ver la nota en `solicitudes`. */
        { name: "server_id", type: "string", isOptional: true },
        { name: "id_tipo_visita", type: "number" },
        { name: "id_socio", type: "number", isIndexed: true, isOptional: true },
        { name: "cosecha", type: "string", isOptional: true },
        { name: "id_finca", type: "number", isOptional: true },
        // Código del recibidor visitado. Sólo para tipos con destino 'recibidor'.
        { name: "recibidor", type: "string", isOptional: true },
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

    // ─── Mapeo local id → id de servidor (NO se sincroniza) ─────────────
    // Necesario para trabajo que depende del id del servidor DESPUÉS de que la
    // fila ya se sincronizó — hoy, subir fotos a /attachments/Visita/{serverId}.
    //
    // Por qué una tabla aparte y no una columna en `visitas`: escribir en una fila
    // ya sincronizada la marca 'updated' y WMDB la re-pushea (ver syncEngine). Y
    // por qué persistido y no sólo la response del push: la foto se saca DESPUÉS
    // de sincronizar la visita, así que en el sync siguiente esa visita ya no
    // aparece en accepted[] — la primera versión sólo miraba ahí y la foto no
    // subía nunca.
    tableSchema({
      name: "server_ids",
      columns: [
        { name: "coleccion", type: "string", isIndexed: true },
        { name: "local_id", type: "string", isIndexed: true },
        { name: "server_id", type: "string" },
        { name: "created_at", type: "number" },
      ],
    }),

    // ─── Cola local de adjuntos (NO se sincroniza) ──────────────────────
    // No está en COLLECTIONS ni en mt.MobileCollections: los binarios no viajan
    // por el sync (el contrato es JSON), suben aparte a
    // POST /attachments/{Entity}/{serverId} una vez que el registro dueño fue
    // aceptado y tiene id del servidor.
    //
    // Genérico por (coleccion, registro): arrancó como cola de fotos de visita,
    // pero es el mismo mecanismo que necesita una solicitud para su cédula y
    // respaldos. El platform ya lo tiene genérico —mt.Attachments por
    // (EntityId, RecordKey)— así que atarlo a una entidad era una limitación
    // nuestra, no suya.
    tableSchema({
      name: "pending_uploads",
      columns: [
        { name: "coleccion", type: "string", isIndexed: true },
        { name: "registro_local_id", type: "string", isIndexed: true },
        { name: "file_uri", type: "string" },
        // 'pending' → falta subir | 'subida' → ya está en el servidor, la copia
        // local se conserva para verla sin señal | 'error' → falló, reintenta
        { name: "status", type: "string", isIndexed: true },
        { name: "error", type: "string", isOptional: true },
        { name: "created_at", type: "number" },
        // Cuándo se subió. Lo usa la purga para saber qué copias locales ya
        // cumplieron su plazo de retención.
        { name: "subida_at", type: "number", isOptional: true },
      ],
    }),

    // ─── Bitácora local (NO se sincroniza) ──────────────────────────────
    // Qué pasó en ESTE teléfono: cada sincronización y cada consulta a Hacienda.
    //
    // Existe porque los dos casos que más cuesta diagnosticar son remotos: "sigue
    // todo pendiente" y "el ATV no me dijo nada". El promotor está en el campo, sin
    // cable ni logcat, y desde el servidor las fallas son indistinguibles entre sí
    // y de "no había nada que enviar" (fue exactamente lo que escondió el bug del
    // case de los uuid). Con esto se le puede pedir que lea la pantalla.
    //
    // El log server-side (mt.MobileSyncLog en la LogDB) es la otra mitad: éste ve
    // lo que el teléfono intentó, incluso cuando nunca llegó al servidor.
    //
    // Se purga al mismo plazo que las copias locales de adjuntos: es diagnóstico
    // reciente, no archivo histórico — para eso está la LogDB.
    tableSchema({
      name: "bitacora",
      columns: [
        /** 'sync' | 'atv' */
        { name: "tipo", type: "string", isIndexed: true },
        { name: "ok", type: "boolean" },
        /** Una línea legible, que es lo que se le pide leer al promotor. */
        { name: "resumen", type: "string" },
        /** JSON con el desglose por colección / la respuesta de Hacienda. */
        { name: "detalle", type: "string", isOptional: true },
        { name: "error", type: "string", isOptional: true },
        { name: "duracion_ms", type: "number", isOptional: true },
        { name: "created_at", type: "number", isIndexed: true },
      ],
    }),
  ],
});
