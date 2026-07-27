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

## 3.ter Alcance de los datos: zona (autorización) y cosecha (contexto)

Apareció al probar en el teléfono con un usuario real, y es la pieza que más cambió
el diseño. Con `admin` no se ve nada de esto: tiene el wildcard `*.*.*` y una fila
con `ZonaCodigo NULL`, así que todos los filtros lo saltean.

**El agujero.** `SyncService` arma su propio SQL desde `ColumnsJson` + `FixedFilterSql`
y **nunca pasa por `DynamicQueryService`**, que es donde vive el filtrado por
`rc_usuario_zona`. El teléfono de un promotor se bajaba las solicitudes y fincas de
todas las zonas, incluidas las que no tiene autorizadas. No es sólo volumen: es
exposición de datos en un dispositivo que sale de la oficina.

**Dos filtros de naturaleza distinta, y la distinción es lo importante:**

| | Zona | Cosecha |
|---|---|---|
| Qué es | **autorización** | **contexto de trabajo** |
| De dónde sale | del usuario del JWT, contra `rc_usuario_zona` | la elige el promotor al entrar |
| Puede el cliente pisarla | **no** | sí, es su decisión |
| Config | `ZonaFilterSql` con token `{zonas}` | `CosechaFilterSql` con `@cosecha` |
| Viaja en | nada (se deriva en el servidor) | header `X-Cosecha` |

`{zonas}` se expande a un parámetro por zona (`@z0, @z1, …`), nunca a interpolación
de strings.

**Tri-estado de las zonas**, que es la semántica que documenta `SysUserZonaRc`:

- fila con `ZonaCodigo NULL`, o admin → sin filtro (todas)
- filas con códigos → sólo esas
- **sin filas para (user, empresa) → ninguna**, con un `AND 1 = 0` explícito

⚠ **Divergencia deliberada con la web**: `DynamicQueryService` trata "sin filas" como
"sin filtro", o sea que un usuario no-admin sin zonas asignadas ve **todas** en los
grids. Eso es más permisivo de lo que documenta el modelo. En el móvil negamos. La
web tendría que corregirse igual — son dos lugares y sólo se tocó el del móvil.

**Por qué la config cuelga de la colección y no de `mt.Entities`**: la entity
`Productor` tiene `FilterByUserZonas=0` (el grid web muestra el padrón completo, a
propósito), pero en el móvil sí se recorta. Móvil y web scopean distinto acá, y
colgarlo de la colección lo deja explícito fila por fila.

**El login pide empresa**, no sólo cosecha: las zonas son por user × empresa, así que
sin empresa no hay alcance que resolver. `GET /api/mobile/contexto` devuelve empresas,
zonas, catálogo de cosechas y defaults de Mis Preferencias en una request — no puede
ser una colección del sync porque el pull ya está scopeado por empresa y cosecha.

**Una sola cosecha a la vez.** Cambiarla invalida el delta de WatermelonDB: el pull
incremental pide "cambios desde `lastPulledAt`" asumiendo filtro estable, así que no
borraría las filas de la cosecha anterior ni traería las viejas de la nueva. El único
camino correcto es subir lo pendiente → `unsafeResetDatabase()` → pull completo. Si
queda algo sin sincronizar, se aborta en vez de perderlo (`HayPendientesError`).

**Efecto medido** (usuario `andrea`, rol Promotor, zona 5, cosecha 2026-2027):

| Colección | Sin scoping | Con scoping |
|---|---|---|
| productores | 12 825 | **323** |
| fincas | 832 | **222** |
| solicitudes | 3 804 | **40** |
| entregadores | 71 | **4** |

De ~17 500 filas a menos de 600.

### 3.ter.1 Dos trampas que costaron encontrar

**Colisión de nombres de colección entre apps.** Había dos `productores` —de
`recibos-cr` y de `promotor`— y la URL `/api/sync/{collection}/pull` no lleva la app.
`ResolveAsync` buscaba por nombre entre todas y devolvía la primera, así que
`promotor` sincronizaba con la spec de `recibos-cr`: otras columnas, otro permiso y
**sin filtro de zona**. Todo el scoping quedaba sin efecto en la colección más
grande. Se resolvió por dos lados: la fila de `recibos-cr` desactivada
(v1.53/RC/10) y `ResolveAsync` discriminando por header `X-App-Id`. Los dos, porque
el próximo choque de nombres va a pasar igual con la tercera app.

**Permiso equivocado en la config.** `productores` pedía `ge.productor.list`, pero la
entity vive en el módulo RC y el rol Promotor trae `rc.productor.list`. Un promotor
real recibía 403 en la colección principal (v1.53/RC/09).

### 3.ter.2 Dato operativo

`mt.MobileCollections` **se cachea al arrancar el backend**. Cambiar una fila no tiene
efecto hasta reiniciar. Cuesta un buen rato darse cuenta si no se sabe.

---

## 3.quater Lo que cambió al probar en campo

Todo lo de abajo salió de usar la app en un teléfono real, no de diseñarla. Vale
la pena tenerlo junto porque varias cosas eran invisibles desde el escritorio.

**La solicitud usa `tipocredito` + `total`, no los rubros.** El master soporta las
dos variantes; los datos deciden cuál: de 937 solicitudes de las últimas dos
cosechas, **923 usan tipo y 1 usa rubros**. El form arrancó con los 5 rubros
(efectivo/insumos/almácigo/formalización/otros), que era la variante equivocada.
Los rubros se siguen bajando para que las solicitudes históricas se vean, pero no
se capturan.

**Nada que el servidor pueda derivar se captura en el móvil.** Tasa, mora, inicio
de interés y plazo salen de `rc_cosechas` y `rc_tipodesembolso` (con
`modifica_intereses` decidiendo cuál gana). Si los mandara el teléfono, una cosecha
cacheada vieja escribiría una tasa incorrecta en una solicitud de crédito. Abono y
tipo de abono tampoco: 1 de 937 los usa, los pone la oficina.

**Zona y cosecha se heredan, no se piden.** La zona del productor elegido, la
cosecha de la sesión. Antes ambas eran texto libre — y `cosecha` con placeholder
`2526` cuando los códigos válidos son `2026-2027`, o sea que el promotor habría
tipeado cosechas inválidas.

**Las zonas se muestran por nombre.** `5` no le dice nada a nadie; `MIRAMAR` sí.
El código sigue siendo lo que viaja en los datos.

**`ge_Socio.nombre` YA es el compuesto** (`apellido1 + apellido2 + nombrep`).
Concatenarlo otra vez con los apellidos mostraba
"ALVARADO ARIAS EULALIO ALVARADO ARIAS".

**Sin sync automático al guardar.** Esta es la más interesante, porque fue una
contradicción de diseño propia: una solicitud sólo se puede editar mientras no
subió, y a la vez se sincronizaba apenas se guardaba. Con señal, la solicitud
quedaba de solo lectura en segundos, antes de que el promotor pudiera agregarle
los entregadores. Ahora sincroniza él desde el drawer, que además muestra el
pendiente en ámbar (`Sincronizar (3 sin enviar)`) para que no se vaya del campo
con trabajo sin subir. El sync automático se conserva sólo al entrar.

**Editar sólo lo no sincronizado.** WatermelonDB lo mantiene en `created`, así que
editar o quitar entregadores es puramente local. Editar algo ya sincronizado
requiere soportar `updated`/`deleted` en el push —hoy `NOT_SUPPORTED`— más política
de conflictos con la web. Queda pendiente aparte.

### 3.quater.1 Trampas que costaron encontrar

| Síntoma | Causa |
|---|---|
| La visita de "Validación de Crédito" no pedía la solicitud y el hook nunca disparaba | `RequiereSolicitud` es `BIT` → llegaba como `true` booleano, y el modelo comparaba `=== 1`. Los otros flags del mismo catálogo son `TINYINT`. Corregido con `CONVERT(TINYINT, ...)` + `esVerdadero()` |
| El promotor recibía 403 en `productores` | La colección pedía `ge.productor.list`, pero la entity es del módulo RC y el rol trae `rc.productor.list` |
| El scoping por zona no se aplicaba a `productores` | Dos colecciones homónimas (`recibos-cr` y `promotor`) y la URL no lleva la app: `ResolveAsync` devolvía la primera por nombre |
| Sync fallaba con 404 tras crear algo | El `syncEngine` empujaba también las tablas locales (`server_ids`, `pending_uploads`), que no existen como colección |
| Contraseña equivocada decía "Error de conexión" | El BE responde 401 y axios lanza `AxiosError`; sólo se construía `AuthError` ante `success:false` con 2xx |
| La foto nunca subía | El flush sólo miraba el `accepted[]` de ese sync, pero la foto se saca DESPUÉS de sincronizar la visita |

---

## 3.quinquies Política de edición: el ciclo de vida de la fila

`SyncPolicy` dice la **dirección** (pull / push / bidireccional). `PoliticaEdicion`
dice el **ciclo de vida** en el teléfono: hasta cuándo se edita y cuándo se envía.
Son ejes ortogonales, y hasta ahora el segundo estaba hardcodeado en el código de
la app.

| política | editable | se envía | ejemplos |
|---|---|---|---|
| `automatica` | no | apenas se guarda | productores, catálogos |
| `hasta-sync` | mientras no subió | cuando el usuario sincroniza | solicitudes, visitas |
| `hasta-evento` | hasta que se cierra | al cerrarse | recibos de café (al imprimir) |

**Regla que atraviesa todo: ya sincronizado ⇒ read-only en el móvil.** Corregir algo
que ya subió es trabajo de la web. Por eso el BE no valida ediciones — nunca le
llegan.

`CampoCierre` nombra la columna que marca la fila como firme en `hasta-evento`. Es
una columna **real que viaja al servidor**, no un estado local: para un documento
importa saber cuándo se cerró.

### Las dos consecuencias no obvias

**1. Retener en el push no es filtrar.** WatermelonDB marca como sincronizado TODO
lo que pasó por `pushChanges`, se haya enviado o no. Filtrar el bucket a secas
habría hecho que las filas retenidas se marcaran synced **y nunca se enviaran**.
La salida es devolver `{ experimentalRejectedIds }`, que le dice a WMDB qué ids no
marcar.

Eso además destapó un bug que estaba desde antes: los **rechazos del servidor** se
manejaban escribiéndole `push_status` a la fila ya marcada como synced, lo que la
volteaba de `created` a `updated`. Y como el BE rechaza `updated` con
`NOT_SUPPORTED`, una fila rechazada habría quedado reintentándose para siempre sin
poder crearse nunca. No se vio porque en las pruebas el orden padre→hijo siempre
funcionó a la primera. Ahora los rechazos también van por `experimentalRejectedIds`
y se reintentan como `created`.

**2. "No sincronicé" y "no puedo sincronizar" son cosas distintas.** Una fila
retenida no se resuelve sincronizando: espera un evento de negocio. Con un solo
contador el usuario sincroniza, el número no baja a cero y no entiende por qué. De
ahí que el drawer muestre `Sincronizar (3 sin enviar · 1 sin cerrar)`.

---

## 4. Adjuntos

El contrato de sync es JSON y no transporta binarios, así que los adjuntos **no
viajan por el sync** — van por el endpoint genérico que ya existe:

```
POST /attachments/{EntityName}/{serverId}   multipart: file, notes
```

**Genéricos por (colección, registro), no atados a visitas.** Arrancó como "fotos de
visita" y esa fue una limitación autoimpuesta: el platform ya guarda los adjuntos por
`(EntityId, RecordKey)`, así que el mismo mecanismo sirve para la cédula y los
respaldos de una solicitud. La cola local es `(coleccion, registro_local_id)` y el
`EntityName` sale del **manifest** — no de un mapa colección→entidad en la app, que
se desincronizaría.

El `recordKey` tiene que ser el id del servidor, que no existe hasta que el push de la
visita fue aceptado. De ahí el diseño:

1. La foto se redimensiona (1280px, JPEG 0.7 → ~190 KB) y se encola en la tabla
   local `pending_uploads`.
2. El id del servidor se resuelve contra `server_ids`, un mapeo **persistido** de
   `localId → serverId` que se llena con los `accepted[]` de cada push. Persistirlo
   es lo que hace que funcione el caso normal: la foto se saca DESPUÉS de
   sincronizar la visita, y para entonces esa visita ya no vuelve a aparecer en
   `accepted[]`. La primera versión sólo miraba ahí y la foto no subía nunca.
3. Subida OK → la fila pasa a `subida` y **la copia local se conserva**, para poder
   ver la foto sin señal al reentrar a la visita.
4. La purga borra las copias locales vencidas al final de cada sync. El plazo lo
   define el servidor (`Mobile:RetencionFotosLocalesDias` en appsettings, viaja en
   `/api/mobile/contexto`), así que se ajusta por instalación sin republicar el APK.
5. Purgada la copia, si el promotor abre la visita con señal las fotos se leen de
   `GET /attachments/Visita/{serverId}`.

**La purga es local y no puede ser del BE**: las copias viven en el filesystem del
teléfono. Lo que sí es del servidor es la *política*. Y no hay purga en el servidor:
los adjuntos son parte del expediente de crédito.

`pending_uploads` y `server_ids` son tablas WMDB locales que **no están en
COLLECTIONS** — nunca se pushean. El `syncEngine` sólo empuja lo declarado
justamente por esto: empujarlas daba 404 `COLLECTION_NOT_FOUND`.

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

## 6.bis Auditoría del sync: las dos mitades — ✅ hecha

**El sync móvil es la parte del sistema que se opera a ciegas.** En la sesión del bug
del case de los uuid, desde el servidor no había forma de distinguir "el teléfono no
mandó nada", "mandó y rechacé" y "mandó, acepté y el cliente no se enteró": los tres
se veían igual. Hubo que instrumentar el cliente con `console.info` y leer logcat por
USB — algo imposible con un promotor en el campo.

Se resolvió con **dos** registros, no uno, porque ninguno alcanza solo.

### `dbo.MobileSyncLog` en la LogDB — lo que llegó al servidor

`Sql/LogDb/04_MobileSyncLog.sql` + `Logging/MobileSyncLog.cs` +
`Modules/Mobile/Services/MobileSyncAuditService.cs`. Una fila por request (el pull y el
push por separado, porque fallan por razones distintas): dispositivo, usuario, empresa,
cosecha, `LastPulledAt`, filas movidas, aceptadas, rechazadas, duración, y el **motivo
de cada rechazo** en el detalle — es lo que convierte "3 rechazadas" en algo accionable.

Tres decisiones que importan:

- **`DeviceId` es la columna que hace útil a todas las demás.** Sin ella no se puede
  separar "este teléfono tiene un problema" de "este usuario tiene un problema", que
  son cosas distintas y se arreglan distinto.
- **Un push con rechazos se marca `Ok = 0`** aunque la request haya funcionado: quien
  revisa después filtra por ahí, y el éxito parcial honesto queda en el detalle.
- **El servicio se traga todos sus errores.** Un log que hace fallar la operación que
  audita es peor que no tener log: el promotor perdería el trabajo del día porque la
  LogDB estaba llena.

No se registra en `mt.Entities` (la LogDB no tiene metadata), así que verlo desde la
web necesita un endpoint dedicado — igual que `PollingRunLog`. **No se purga**: con
pocos promotores el volumen es chico, pero si la flota crece hay que sumar un job.

**Cómo se ve desde la web:** `GET /api/logs/mobile-sync` (lista, con filtros por fecha,
usuario, `deviceId`, `appId`, dirección y `onlyErrors`) y `/api/logs/mobile-sync/{id}`
(detalle, con el JSON de rechazos). Van en `LogViewerController`, junto a los otros logs
de la LogDB, y el FE los consume con el componente `LogViewer` genérico — **no** con el
grid dinámico del platform, que trabaja contra `AppDbContext` y no puede ver la LogDB.

**El log se ganó el sueldo en su primer uso.** La primera fila que escribió tenía
`UserName` en blanco: `SyncController` resuelve el usuario con `User.Identity?.Name`, que
en este BE devuelve vacío porque el JWT no mapea `unique_name` a `Name`. `LogService` sí
trae el username porque usa `ICurrentUserContext`. El servicio de auditoría pasó a esa
misma fuente. Queda una deuda anotada: esas tres líneas de `User.Identity?.Name` siguen
alimentando el `userId` que recibe `SyncService` — hoy no rompe nada visible (el scoping
por zona usa `_user.UserId`), pero es un string vacío viajando por tres firmas.

### La bitácora local del móvil — lo que el teléfono intentó

Tabla WMDB `bitacora` (`src/lib/bitacora.ts`, pantalla `BitacoraScreen` en el drawer).
Cada sincronización y cada consulta ATV, con resumen legible, desglose y duración.

**Por qué no es redundante:** lo que nunca llegó a la red no deja rastro del otro lado,
por definición. Y en la práctica es lo que se puede leer por teléfono en treinta
segundos cuando el promotor llama diciendo "no envió nada", sin cable ni computadora.

Se purga **al mismo plazo que las copias locales de adjuntos** (`retencionFotosDias`,
config del servidor): es diagnóstico reciente, no archivo. Lo permanente está en la
LogDB.

Los logs de consola (`[sync] push …`, `[adjuntos] …`) se dejan puestos: son la tercera
capa, para cuando sí hay un cable.

---

## 6.ter Consulta ATV (Hacienda) desde el móvil

El endpoint web es `POST /api/rc/solicitud/{id}/consultar-hacienda` y **necesita una
solicitud que ya exista en el servidor**, porque escribe el veredicto en su fila. En el
móvil la solicitud se levanta en el campo y se sincroniza horas después: en el momento
de consultar no hay `{id}` que poner.

`POST /api/mobile/hacienda/atv` invierte el sujeto: la consulta va contra el
**productor** (`idSocio`), y el veredicto se devuelve. El teléfono lo guarda en su
solicitud local y viaja con el push, en las mismas dos columnas
(`resultadoatv`, `consultadoatv` — v1.53/RC/52 las agrega a la proyección y a los
escribibles).

**La regla vive en `AtvVeredictoService`**, no en cada controller. Ahora la consultan
dos canales; duplicada, el día que cambie el código CIIU del café los dos empezarían a
clasificar distinto al mismo productor, y el que se corrija primero taparía al otro.

### El caso de la solicitud ya sincronizada

El push sólo sube filas nuevas: no puede modificar una que ya subió. Así que si el
promotor consulta después de sincronizar, el body lleva `solicitudId` (el id de
servidor, resuelto contra `server_ids`) y el BE escribe el veredicto directo. La
response trae `persistido` para que la app sepa cuál de los dos caminos ocurrió y lo
diga en pantalla.

Y **no se guarda local en ese caso**: cualquier escritura marcaría la fila `updated`, el
push la reintentaría, el BE la rechazaría con `NOT_SUPPORTED` y quedaría contada como
pendiente para siempre, sin nada que el promotor pueda hacer. El dato baja solo en el
próximo pull.

### "No editables" quiere decir por convención, no por control de acceso

Ningún form —ni el web ni el móvil— toca esas dos columnas. Pero el motor de sync no
distingue: el push acepta lo que el cliente manda en cualquier campo escribible. La
garantía real es la auditoría — cada consulta queda en `LogEvent` con cédula, veredicto
y outcome, y el evento es el mismo (`hacienda.actividades.lookup`) que la consulta web,
con `origen: "movil"` en el JSON para distinguirlas. Conviene tenerlo escrito para no
confundir las dos cosas.

Permiso: `rc.solicitud.update`, el mismo que el endpoint web. **No** `mt.hacienda.consultar`
—el del botón de SocioNegocio— porque el rol Promotor no lo tiene y dárselo le abriría
la consulta de cualquier cédula, no sólo la del productor de una solicitud suya.

---

## 6.sexies Autoría de la fila: `UserColumn`

Las 4 primeras visitas creadas desde el teléfono quedaron con
`rc_Visita.IdUsuarioPromotor` **NULL**, sin ningún error.

**Por qué no se notó antes:** en la web ese campo se llena solo, con el token
`${user.id}` de `mt.Fields.DefaultValue`. Pero **ese token lo resuelve el FRONTEND** al
armar el form de alta — el servidor sólo lo transporta como metadata, no lo interpreta.
El móvil no pasa por ese form, así que no había nada que lo llenara; y como la columna es
nullable, la visita se creaba igual.

Es la tercera vez que el mismo patrón nos muerde: **un dato que el servidor acepta sin
protestar y nadie llena** (`ClientUuid` fuera de `mt.Fields`, `idsocio` del entregador
que ni la web poblaba, y ahora esto). El síntoma es siempre el mismo: funciona todo, el
dato no está.

La solución es `mt.MobileCollections.UserColumn` (v1.53/RC/53): el push estampa el id
numérico del JWT en la columna que la colección declare. **No se le pide al cliente**, por
la misma razón que `compania` sale del header y no del body — es un dato de autoría, y un
teléfono no debería poder declarar que el trabajo lo hizo otra persona. Además la app no
tiene por qué conocer su propio id numérico: hoy guarda el username, y el id vive en el
claim `sub`.

`solicitudes` no la lleva: `rc_solicitud` no tiene columna de promotor — el vínculo con
quien la levantó es la visita de validación de crédito, no la solicitud.

Las 4 visitas viejas se dejan en NULL: el push no guardaba quién las mandó, que es
justamente lo que esto arregla, así que backfillearlas sería adivinar.

---

## 6.quater Migraciones del SQLite local — ✅ hechas (deuda pagada)

`SCHEMA_VERSION` estuvo en 1 durante ~8 cambios de schema, sin migraciones. **Eso no se
nota en desarrollo** —donde uno limpia los datos a mano igual— y se cobra el día de la
primera actualización en campo: WMDB no encuentra cómo llevar la base de la versión
vieja a la nueva y lo único que puede hacer es borrarla, con lo que el promotor haya
capturado y no sincronizado adentro.

`src/db/migrations.ts` arranca el camino en la versión 2 (las columnas ATV + la tabla
`bitacora`). La regla, ahora explícita en el archivo y en `schema.ts`: **todo cambio de
schema entra con su paso de migración y su bump de versión, en el mismo commit**. Las
migraciones sólo agregan; nunca renombran ni borran — una columna sin uso se deja
muerta, que es más barato que una migración destructiva fallando a mitad de camino en un
teléfono ajeno.

---

## 6.quinquies Permisos de cámara y GPS

El síntoma reportado era "pregunta el permiso cada vez". Un permiso concedido en Android
es permanente, así que si vuelve a preguntar es por una de tres razones y **ninguna se
arregla pidiéndolo de nuevo**:

1. **"Solo esta vez"** — desde Android 11 es un permiso de una sesión, revocado cuando
   la app pasa a segundo plano un rato. La opción permanente es "Mientras usas la app".
2. **Auto-revocación** de permisos de apps sin usar por meses.
3. **Denegado dos veces** → `canAskAgain: false`, el sistema no muestra el diálogo nunca
   más y el único camino es Ajustes.

Lo que sí estaba de nuestro lado (`src/lib/permisos.ts`):

- **Consultar antes de pedir.** `requestXAsync` a secas es lo que dispara el diálogo.
- **Pedir los dos juntos una vez, al entrar al contexto de trabajo.** No en medio de una
  visita: ahí el diálogo interrumpe la captura y se toca "Solo esta vez" para salir del
  paso, que es justo lo que causa la razón 1. Los dos en serie y no en paralelo —dos
  diálogos simultáneos se apilan y algunos launchers descartan el segundo.
- **Cuando el sistema ya no va a preguntar, mandar a Ajustes** en vez de repetir un botón
  que no hace nada.
- **Distinguir "sin permiso" de "sin señal"** en la fila del GPS: mostrarlos igual manda
  a caminar buscando señal a alguien que sólo tiene que tocar un botón.

El GPS **consulta sin pedir** durante la captura (si falta, la visita se guarda sin
punto, que es el comportamiento correcto) y **sí pide** cuando el promotor toca la fila
para reintentar — ahí el diálogo es la respuesta a algo que él pidió.

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
| ~~Una foto cuyo upload falla queda encolada hasta que su visita vuelva a aparecer en un `accepted[]` — o sea, nunca~~ | **Resuelto.** Era peor de lo anotado: en el flujo normal (sacar la foto DESPUÉS de sincronizar la visita) no subía nunca, porque en el sync siguiente esa visita ya no está en `accepted[]`. Ahora el mapeo localId→serverId se persiste en la tabla local `server_ids` y `flushPendingUploads` recorre la cola completa resolviendo contra ella |
| Un flag `BIT` del servidor llega como booleano y no como número | `CONVERT(TINYINT, ...)` en la proyección + `esVerdadero()` en el modelo. Pasó con `requiere_solicitud`: la app no pedía la solicitud en la visita de crédito y el hook nunca disparaba, sin ningún error |
| ~~`SCHEMA_VERSION` en 1 tras ~8 cambios de schema: la primera actualización del APK le borra la base local al promotor~~ | **Resuelto** en §6.quater: `db/migrations.ts` + versión 2. La regla queda escrita: cada cambio de schema con su paso de migración en el mismo commit |
| ~~`contarPendientes` contaba TODOS los `pending_uploads`, incluidos los ya subidos que conservan su copia local~~ | **Resuelto.** El drawer decía 0 pendientes y "Cambiar cosecha" se negaba diciendo que había N. Ahora filtra `status != 'subida'`, igual que `usePendientes` |
| Los campos ATV son "no editables" por convención, no por control de acceso: el push acepta lo que el cliente mande en cualquier campo escribible | La garantía es la auditoría (`hacienda.actividades.lookup` con cédula, veredicto y `origen`). Ver §6.ter |
| Un adjunto en estado `error` mantiene el contador de pendientes arriba de cero y bloquea el cambio de cosecha | Es correcto que cuente (está pendiente de verdad), pero si el upload falla siempre no hay salida. Falta poder descartarlo desde la pantalla de adjuntos |
| `dbo.MobileSyncLog` no se purga | Volumen chico con pocos promotores. Con una flota grande hace falta un job de retención |
| ~~Las visitas del móvil quedaban sin `IdUsuarioPromotor`: el `${user.id}` de la web lo resuelve el FRONTEND, y el móvil no pasa por ese form~~ | **Resuelto** en §6.sexies: `mt.MobileCollections.UserColumn`, estampado server-side desde el JWT |
| `SyncController` usa `User.Identity?.Name`, que en este BE devuelve **vacío** (el JWT no mapea `unique_name` a `Name`) | La auditoría pasó a `ICurrentUserContext`. Las tres líneas siguen alimentando el `userId` de `SyncService`, hoy sin consecuencia visible — limpiar en el próximo toque de ese archivo |
| La migración 1→2 del SQLite no se ejercitó: con datos limpios WMDB crea el schema directo en v2 y no corre los pasos | Fresh install y upgrade son rutas distintas. El primer bump con datos adentro es la prueba real |
