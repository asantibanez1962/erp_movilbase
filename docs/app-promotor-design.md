# App móvil `promotor` — Visitas + Solicitudes de crédito

App #2 del monorepo. Reusa `shared-types` / `shared-api` / `shared-sync` y el patrón
de navegación de `recibos-cr`. `AppId = 'promotor'` (ya es el AppId de las colecciones
sembradas en `mt.MobileCollections` por `v1.53/RC/02_MobileCollections_promotor.sql`).

**Usuario objetivo**: el promotor de crédito en campo. Sale con el teléfono, visita
productores, levanta la visita de validación de crédito (con GPS + fotos) y arma la
solicitud con sus entregadores. Sincroniza cuando vuelve a tener señal.

---

## 1. Estado de partida (qué ya existía antes de esta app)

El BE llegó a esto ya medio construido. Vale la pena tenerlo claro porque cambia
mucho el costo del trabajo:

| Pieza | Estado | Dónde |
|---|---|---|
| Tabla `rc_Visita` con `ClientUuid`, `GpsLat/GpsLng`, `IdSolicitud` | ✅ existe | `Modules/RC/Models/Visita.cs` |
| Hook visita → solicitud (`prodestimadapromotor` + `inspeccioncampo=1`) | ✅ existe | `Modules/RC/Hooks/SolicitudVisitaHook.cs` |
| Sync columns en `rc_solicitud`, `rc_Finca`, `rc_Visita` | ✅ existe | `Sql/Upgrades/v1.53/RC/01_sync_columns.sql` |
| Colecciones `productores`/`solicitudes`/`visitas` para AppId `promotor` | ✅ existe | `Sql/Upgrades/v1.53/RC/02_MobileCollections_promotor.sql` |
| Registry metadata-driven (`mt.MobileCollections`) | ✅ existe | `Modules/Mobile/Services/SyncCollectionRegistry.cs` |
| Endpoint de attachments multipart | ✅ existe | `Contollers/AttachmentController.cs` |
| Entity `SolicitudEntregador` registrada (`AllowCreate=1`) | ✅ existe | `Sql/Upgrades/v1.49/RC/47_register_SolicitudEntregador.sql` |
| Permisos `rc.visita.create`, `rc.solicitud.create`, `rc.finca.list`, `rc.tipovisita.list` | ✅ existen | varios |

El registry es metadata-driven: **sumar una colección = una fila de SQL, no código**.
Eso hace que la mayor parte del trabajo de BE sea SQL barato. La excepción es el
remapeo de FK (§3), que sí es código.

---

## 2. Scope confirmado

**Se crea desde el móvil**: visitas **y** solicitudes con sus entregadores.
**Solo lectura**: productores, fincas, tipos de visita.
**Captura de campo**: GPS **y** fotos en la visita.

Colecciones finales de la app `promotor`:

| Colección | Tabla | Política | Notas |
|---|---|---|---|
| `productores` | `dbo.ge_Socio` | pull-only | filtrada por rol `PRODUCTOR` |
| `fincas` | `dbo.rc_Finca` | pull-only | la visita la exige si `TipoVisita.requierefinca=1` |
| `tipos_visita` | `dbo.rc_tiposvisita` | pull-only | catálogo del picker |
| `solicitudes` | `dbo.rc_solicitud` | **bidireccional** | pasa de pull-only a bidireccional |
| `entregadores` | `dbo.rc_solicitudes_entregadores` | **bidireccional** | nueva. `id_socio` es la relación real; `codigo` va denormalizado para el legacy PB |
| `visitas` | `dbo.rc_Visita` | bidireccional | ya estaba |

---

## 3. El problema central: FK padre→hijo creados offline

Es la única pieza de arquitectura genuinamente nueva. Todo lo demás es aplicación
de patrones que ya existen en `recibos-cr`.

**El problema.** El promotor crea una solicitud offline. Su `id` es un uuid local de
WatermelonDB (`"a3f9c1..."`), no un `idsolicitud` del servidor — ese no existe todavía.
Acto seguido le agrega 3 entregadores, que apuntan a la solicitud por ese uuid local.
Al sincronizar, el BE recibe entregadores cuyo `idsolicitud` es un uuid: no matchea
ninguna fila de `rc_solicitud`. Lo mismo con `visitas.id_solicitud` cuando la visita
valida una solicitud creada en el mismo teléfono.

**La solución.** `mt.MobileIdMap` ya existe en el schema (`DeviceId`, `CollectionName`,
`LocalId`, `ServerId`) — se creó justo para esto en Phase A, pero **nunca se cableó en
el código**. Lo cableamos ahora:

1. Cada `created` aceptado inserta su fila `(deviceId, collection, localId) → serverId`.
2. La `CollectionSpec` gana un `ForeignKeys` (`wireKey → collectionName`) leído de una
   columna nueva `ForeignKeysJson` en `mt.MobileCollections`.
3. En `BuildEntityPayload`, todo campo declarado como FK se resuelve antes de crear:
   - **valor numérico** → es un id del servidor (la fila vino de un pull). Pasa tal cual.
   - **valor no numérico** → es un uuid local. Se busca en `MobileIdMap`. Si no está,
     la fila va a `rejected[]` con `UNRESOLVED_PARENT` en vez de crear basura.

El discriminante numérico/no-numérico es sólido acá: el pull proyecta `Id AS id` y lo
castea a string, así que los ids del servidor son siempre strings de dígitos, y los
uuid de WMDB nunca lo son.

**Orden de push.** El padre tiene que subir antes que el hijo o el `MobileIdMap`
todavía no tiene la fila. WMDB no garantiza el orden entre colecciones, así que el
`syncEngine` pushea siguiendo el orden de `opts.collections` en vez de iterar el objeto
de cambios: `solicitudes → entregadores → visitas`.

**Qué NO hacemos.** No implementamos `updated`/`deleted` en push (siguen devolviendo
`NOT_SUPPORTED`). No hace falta: mientras una solicitud no se sincronizó, WMDB la
mantiene en estado `created` y las ediciones locales viajan dentro de ese mismo
`created`. Editar una solicitud ya sincronizada es trabajo de la web.

**Bonus necesario**: hoy `@companyId` sólo se bindea cuando la colección declara
`CompanyColumn`. `rc_solicitudes_entregadores` no tiene columna `compania` — se scopea
por su solicitud padre. Así que el parámetro pasa a bindearse siempre, y el
`FixedFilterSql` de esa colección lo usa:

```sql
EXISTS (SELECT 1 FROM dbo.rc_solicitud s
         WHERE s.Id = base.idsolicitud AND s.compania = @companyId)
```

---

## 3.bis El otro problema: identidad de las filas creadas offline

Apareció al implementar y es tan importante como el anterior. `recibos-cr` no lo tiene
porque su colección es push-only; acá las tres colecciones que se escriben son
**bidireccionales**, o sea que lo que sube vuelve a bajar.

1. el teléfono crea la solicitud con su id local
2. el push la crea en el servidor, que le asigna otro id (identity)
3. el pull siguiente la devuelve con **ese** id
4. WatermelonDB no reconoce el id → inserta una segunda fila → **duplicado**

El síntoma no aparece al guardar ni en el primer sync: aparece en el segundo, sin
ningún error en los logs.

`rc_Visita` ya tenía `ClientUuid` justamente para esto. Extendemos el patrón:

- `ClientUuid UNIQUEIDENTIFIER NULL` también en `rc_solicitud` y
  `rc_solicitudes_entregadores`, con UNIQUE filtrado (`WHERE ClientUuid IS NOT NULL`,
  para que las filas nacidas en la web no participen)
- el pull proyecta `ISNULL(CONVERT(NVARCHAR(60), ClientUuid), CONVERT(NVARCHAR(60), Id)) AS id`
- las FK a un padre se proyectan igual, resolviendo el uuid del padre

Consecuencia del lado del móvil: el id local tiene que ser un **UUID v4 válido** (la
columna del servidor es `UNIQUEIDENTIFIER`) y los ids que genera WMDB no lo son. Por eso
las tres colecciones escribibles se crean por [`src/lib/crear.ts`](../apps/promotor/src/lib/crear.ts),
que fuerza `_raw.id` con un uuid propio y lo copia en `client_uuid`. Crear una de esas
filas sin pasar por ese helper reintroduce el duplicado.

**Trampa encontrada**: `DynamicCreateService.AssignProperties` filtra el payload contra
un allowlist de `mt.Fields` y **descarta en silencio** (sólo un `Console.WriteLine`) lo
que no esté registrado. `ClientUuid` no estaba registrado en ninguna de las tres
entidades, así que el seed de `visitas` de v1.53/RC/02 ya venía descartándolo. Lo
arregla `v1.53/RC/05_Register_ClientUuid_Fields.sql`.

---

## 4. Fotos

`rc_Visita` documenta las fotos como `mt.Attachments` con `recordKey = IdVisita`. El
contrato de sync es JSON y no transporta binarios, así que las fotos **no viajan por el
sync** — van por el endpoint que ya existe:

```
POST /attachments/Visita/{serverId}   multipart: file, notes
```

El `recordKey` tiene que ser el id del servidor, que no existe hasta que el push de la
visita fue aceptado. De ahí el diseño:

1. La foto se guarda en el filesystem del teléfono al tomarla, y se encola una fila en
   una tabla local `pending_uploads` (`visita_local_id`, `file_uri`, `status`).
2. Terminado el sync, para cada visita aceptada se resuelve `localId → serverId` y se
   suben sus fotos pendientes.
3. Subida OK → se borra la fila y el archivo local. Falla → queda encolada para el
   próximo sync.

`pending_uploads` es una tabla WMDB local que **no está en ninguna colección de sync** —
nunca se pushea, es puramente cola local.

---

## 5. Navegación

Mismo esqueleto que `recibos-cr` (Drawer + Bottom Tabs + Stack por tab):

```
Drawer:  Sincronizar todo · Mis preferencias · Acerca de · Cerrar sesión

Tabs:    [👥 Productores]  [📄 Solicitudes]  [📍 Visitas]

Stacks:  Productores → ProductorDetail → (sus solicitudes / sus fincas)
         Solicitudes → SolicitudDetail → NuevaSolicitud → EntregadoresPicker
         Visitas     → VisitaDetail   → NuevaVisita → CapturarFotos
```

---

## 6. Plan de fases

Cada fase es independientemente verificable.

### Fase 0 — BE (bloqueante para crear offline) — ✅ hecha
- `SyncService`: remapeo de FK vía `MobileIdMap` + registro de ids aceptados + `@companyId` siempre bindeado + FK proyectadas como string
- `SyncCollectionRegistry`: leer `ForeignKeysJson`
- Modelos EF: `SyncUpdatedAt`/`SyncDeletedAt` en `Solicitud`, `SolicitudEntregador`, `Finca`; `ClientUuid` en las dos primeras
- SQL `v1.53/RC/03`: `ForeignKeysJson`, sync columns en entregadores y tipos de visita, `ClientUuid` + UNIQUE filtrado
- SQL `v1.53/RC/04`: colecciones `tipos_visita`, `fincas`, `entregadores`; `solicitudes` → bidireccional; proyecciones de identidad estable
- SQL `v1.53/RC/05`: registrar `ClientUuid` en `mt.Fields`
- `shared-sync`: orden de push padre→hijo; `runSync` devuelve las responses del push

**Falta verificar**: aplicar los scripts a la DB de dev y probar el push por Postman
(solicitud con uuid local + entregador apuntando a ese uuid → ambos creados, FK correcta).

### Fase 1 — Scaffold — ✅ hecha
- `apps/promotor/` (Expo, bundle `cr.confeldan.promotor`), `config.appId = 'promotor'`
- WMDB schema + models de las 6 colecciones + `pending_uploads`
- Login + drawer + tabs + sync manual
- `createDatabase` generalizado: cada app pasa su schema y sus models

### Fase 2 — Screens de consulta — ✅ hecha
- Productores (lista + búsqueda + detalle con fincas/solicitudes/visitas)
- Solicitudes (lista + detalle con sus entregadores)
- Visitas (lista)

### Fase 3 — Creación offline — ✅ hecha
- `NuevaSolicitudScreen`: productor + cosecha/zona + los 5 rubros con total en vivo + plan/estimados
- Alta de entregadores desde `SolicitudDetail`, con picker buscable
- `NuevaVisitaScreen`: el tipo gobierna el form — finca si `requiere_finca`, solicitud + producción estimada si `requiere_solicitud`
- Todo guarda local primero y sincroniza best-effort: en campo no hay señal, y perder el dato por eso sería el peor resultado

**Verificable con**: modo avión, crear solicitud + 2 entregadores + visita ligada, reconectar, sincronizar, verlos en la web.

### Fase 4 — Captura de campo — ✅ hecha
- GPS: [`gps.ts`](../apps/promotor/src/lib/gps.ts). Se pide al abrir el form, no al guardar — el fix bajo sombra de cafetal tarda. `Accuracy.Balanced` alcanza para ubicar una finca. Si no engancha, la visita se guarda igual sin coordenadas.
- Fotos: [`FotosVisitaScreen`](../apps/promotor/src/screens/FotosVisitaScreen.tsx) captura y encola; [`fotos.ts`](../apps/promotor/src/lib/fotos.ts) redimensiona a 1280px/JPEG 0.7 y sube post-sync.
- **Pendiente**: dev client build nuevo — `expo-camera`, `expo-location` y `expo-image-manipulator` son native modules y no corren en el binario actual.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| ~~Los scripts `v1.53` pueden no estar aplicados en la DB de dev~~ | Resuelto: `01..05` aplicados y registrados en `mt.SchemaVersion` de `sci_altura_2026` |
| `requierefinca` es TINYINT con valores 0/1/2 y nadie lo consume — el significado del 2 no está definido | El móvil toma "distinto de cero" = exige finca. Confirmar con negocio |
| El entregador se liga por `ge_Socio.rc_codigo`, NO por `ge_Socio.codigo` — son columnas distintas y difieren en ~550 socios | Resuelto en v1.53/RC/06: la colección proyecta ambas y el alta usa `rc_codigo`. Un productor sin `rc_codigo` no puede ser entregador y la app lo dice |
| `rc_solicitudes_entregadores.idsocio` existía desde v1.50 pero nadie la escribía (ni la web) | Resuelto en v1.53/RC/07: registrada en `mt.Fields`, mapeada en EF, escribible desde el móvil y backfilleada. **La web sigue sin poblarla en altas nuevas** — decisión aparte |
| Fechas en el wire: unix ms en ambas direcciones | El push las convierte por tipo CLR (`ConvertUnixDates`). Cuidado con el ternario: `cond ? unDateTime : unDateTimeOffset` se unifica en `DateTimeOffset` |
| `SolicitudEntregadorValidationHook` rechaza entregadores duplicados en la misma cosecha | Es el comportamiento correcto — cae en `rejected[]`, la UX lo muestra |
| Fotos pesadas en 3G rural | Redimensionar a ~1280px + JPEG q=0.7 antes de encolar |
| `rc_solicitudes_entregadores` sin `compania` | Se scopea por la solicitud padre vía `FixedFilterSql` (§3) |
| Solicitud creada offline sin `numero`/secuencia | Igual que recibos-cr: lo asigna el servidor al crear (identity). No hay campo manual. |
| Crear una fila escribible sin pasar por `crear.ts` reintroduce el duplicado del §3.bis | El helper es el único camino; conviene un lint rule si el equipo crece |
| Una foto cuyo upload falla queda encolada hasta que su visita vuelva a aparecer en un `accepted[]` — o sea, nunca | Pendiente: reintentar leyendo el server id de un mapeo local persistido, no sólo de la response del push |
