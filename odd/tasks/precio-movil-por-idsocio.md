# Precio del recibo por idsocio en el móvil

## Objetivo

Que `buscarPrecio()` del móvil identifique al productor por `idsocio`, igual que
`dbo.f_rc_busca_precio` en el servidor, y que `codigo` quede sólo como dato a mostrar.

## Problema

`packages/recibos-calc/src/precio.ts` es un port literal de `dbo.f_rc_busca_precio`. El
servidor ya migró a `idsocio` (verificado el 21-nov-2026 en `sci_altura_0826`):

```sql
CREATE FUNCTION dbo.f_rc_busca_precio
( @cosecha CHAR(10), @tipocafe CHAR(1), @calidad CHAR(1), @zona CHAR(2),
  @recibidor VARCHAR(3), @idsocio INT, @tipo CHAR(3) )
...
  AND (p.idsocio IS NULL OR p.idsocio=@idsocio)
ORDER BY CASE WHEN p.idsocio IS NOT NULL THEN 1 ELSE 0 END DESC,
         ISNULL(p.tipo,' ') DESC, ISNULL(p.recibidor,' ') DESC,
         ISNULL(p.zona,' ') DESC, ISNULL(p.calidad,' ') DESC,
         ISNULL(p.tipocafe,' ') DESC, p.idreprecio DESC
```

`@codigo` salió de la firma y `codigo` salió del `ORDER BY`. El móvil sigue filtrando por
`p.codigo` y ordenando por `codigo` primero. **Es una divergencia activa**: el precio que
se imprime en la finca puede no ser el que el servidor recalcula al sincronizar
(`ReciboCalcHook`, `RcReciboComputeController`).

## Por qué ahora

Dos consecuencias, una presente y una inminente:

1. **Hoy**: un productor sin `rc_codigo` nunca matchea su propio precio, y con código
   duplicado matchea el de otro — el `ORDER BY ISNULL(codigo,' ') DESC` del móvil le da
   el precio del código alfabéticamente mayor.
2. **Inminente**: medido el 21-nov en `rc_precios` — 516 filas, 310 con `idsocio`, y **0
   con `idsocio` y `codigo` vacío**. El día que el web grabe la primera fila así, el móvil
   la lee como **precio general** (su regla es "`codigo` en NULL aplica a todos") y le
   pone el precio de ese productor **a todos los demás**. No falla: calcula, imprime,
   sincroniza, y está mal.

## Lo que ya está hecho del lado del servidor

Aplicado por Alfredo en su sesión de BE (v1.95), verificado acá el 21-nov:

- `mt.MobileCollections` de `recibos`/`precios` → `ColumnsJson` termina en
  `"idsocio AS id_socio"`. El alias manda: la columna de la app se llama `id_socio`.
- `rc_precios.SyncUpdatedAt` estampada en 310 filas (las que tienen `idsocio`) a las
  20:05 UTC del 21-nov, para que el pull incremental las vuelva a entregar.
- Las **206 filas generales conservan su estampa vieja** (5-nov). No se re-pullean, y su
  `id_socio` va a quedar ausente en el teléfono. Eso es correcto, pero obliga a la regla
  de transición de T2.
- No hace falta reiniciar el BE: `SyncCollectionRegistry` es *Scoped* y cachea por request.

## Alcance autorizado

El cálculo del precio en la app de recibos, de punta a punta: columna local, port,
call sites y sus verificaciones.

**Fuera de alcance** (ofrecidos, sin respuesta de Alfredo — no tocar):

- El genérico resuelto por `codigo` con `encontrados[0]` (`recibo.ts:515-530`).
- El accesor `idSocio` explícito en el modelo `Productor` de las dos apps.
- El bloqueo del entregador sin `rc_codigo` en promotor
  (`SolicitudDetailScreen.tsx:135-140`).
- Todo lo que sea del backend: hooks, metadata, scripts SQL. Van en la sesión del web.

## Restricciones

- **La migración va en el MISMO commit que el bump de `SCHEMA_VERSION`.** Lo dice
  `migrations.ts:10-13`: sin su paso, WatermelonDB **borra la base del teléfono**, con los
  recibos del día adentro si la bitácora no cerró.
- Las migraciones van en orden **descendente** y cada versión en su propio paso. Agregarle
  un step a una versión que los teléfonos ya corrieron no hace nada.
- Comentarios en español, al estilo del repo (neutral, explicando el *por qué*).
- `precio.ts` es un port: cualquier divergencia con la función del servidor es un bug,
  incluso si parece una mejora. El servidor es la definición de lo correcto.

## Modo TDD

**Apagado**, y no por elección: el monorepo no tiene framework de pruebas. Lo que hay es
un verificador a mano, `packages/recibos-calc/scripts/verificar.cjs`, y **no cubre
`buscarPrecio` en absoluto** (grep de `buscarPrecio`, `idsocio` y `codigo`: cero
resultados). Resuelto de la configuración del repo, no de una preferencia.

- Runner: `pnpm --filter @erp/recibos-calc run verificar`
- Lint/typecheck: `pnpm -r run lint --if-present` (cada paquete corre `tsc --noEmit`)

## Verificaciones aplicables

| check | comando |
|---|---|
| typecheck del paquete | `pnpm --filter @erp/recibos-calc run lint` |
| verificador del cálculo | `pnpm --filter @erp/recibos-calc run verificar` |
| typecheck de la app | `pnpm --filter @erp/recibos run lint` |

## Tareas

- [x] **T1 — columna `id_socio` en la tabla local `precios`.**
      `apps/recibos/src/db/schema.ts` (tabla `precios`, `SCHEMA_VERSION` 12→13),
      `apps/recibos/src/db/migrations.ts` (paso `toVersion: 13` arriba),
      `apps/recibos/src/db/models.ts` (campo en el modelo `Precio`).
      Ruta: **delegada** (3 archivos no triviales → trigger de writer).
- [x] **T2 — port de `buscarPrecio` a idsocio.**
      `packages/recibos-calc/src/tipos.ts` (`Precio.idSocio`, `EntradaPrecio.idSocio`),
      `packages/recibos-calc/src/precio.ts` (filtro + nuevo `ORDER BY`).
      **Regla de transición**: una fila con `idSocio` ausente pero `codigo` NO vacío es una
      fila vieja que todavía no se re-pulleó → se compara por `codigo`, como hoy. Una fila
      con los dos vacíos es precio general. Sin esa distinción, las 206 generales y las
      viejas se confunden.
      Ruta: **delegada** (misma tanda que T1).
- [x] **T3 — call sites pasan el idsocio.**
      `apps/recibos/src/lib/recibo.ts:321-349` y
      `apps/recibos/src/screens/ReciboScreen.tsx:407`, que hoy pasan
      `productor?.codigo ?? ""`. Ruta: **delegada** (misma tanda).
- [x] **T4 — casos de precio en `verificar.cjs`.**
      Mínimo: precio de socio por idsocio; precio general; fila vieja sin `id_socio` con
      código (cae al código); productor **sin código** que sí recibe su precio por idsocio;
      código duplicado que ya no agarra el precio ajeno. Ruta: **delegada** (misma tanda).

## Criterios de aceptación

1. `buscarPrecio` da el mismo resultado que `f_rc_busca_precio` para las cinco formas de
   fila de T4.
2. Un productor sin `rc_codigo` recibe su precio específico.
3. Una fila con `idsocio` y `codigo` vacío **no** se aplica a todos los productores.
4. Un teléfono en la versión 12 migra a la 13 sin perder datos.
5. Los tres checks de la tabla pasan.

## Estrategia de entrega

`ask-on-risk` (default), un solo PR. Forecast desde las tareas: ~180 líneas autoradas
(adiciones + borrados), bien debajo del presupuesto de ~400.

## Progreso

- 21-nov-2026: auditoría de identidad del productor en las dos apps, los `shared-*` y los
  endpoints del BE (4 mapeos en paralelo). Resultado: el pull **sí** manda `idsocio` como
  `id` del productor, así que `Number(p.id)` es correcto en todas partes; promotor ya es
  idsocio-primario; el agujero real está en los hooks del BE y en el precio del móvil.
- 21-nov-2026: rama `feat/precio-por-idsocio` abierta desde `master` (613f5dc).
  `feat/preparar-logo-impreso` quedó con 2 commits sin mergear y no se toca.
- 21-nov-2026: T1 a T4 en un solo work-unit commit, **`8e2e398`** — 8 archivos, 155
  adiciones y 16 borrados. El bump de `SCHEMA_VERSION` y su migración van ahí adentro,
  como manda `migrations.ts:10-13`.
- Nombre del campo en `recibos-calc`: **`idsocio`**, no `idSocio`. Los campos vecinos
  (`idreprecio`, `tipocafe`) son nombres de columna del servidor en minúscula y sin
  separador, y `EntradaPrecio` refleja los parámetros de la función SQL. La columna local
  sigue siendo `id_socio` y el accesor del modelo `idSocio`, igual que en `Finca` y
  `Cuota`.

## Evidencia de verificación

Corridos el 21-nov-2026, con el cambio aplicado:

| check | resultado observado |
|---|---|
| `pnpm --filter @erp/recibos-calc run lint` | tsc sin errores, exit 0 |
| `pnpm --filter @erp/recibos run lint` | tsc sin errores, exit 0 |
| `pnpm --filter @erp/recibos-calc run verificar` | **14/14 casos de precio `ok`** (`precio: todo ok`); exit 1 por la comparación contra la base |

**Ese exit 1 es preexistente, medido, no asumido.** El verificador compara 5.000 recibos
reales de `sci_altura_2026` y da `Coinciden: 4982/5000 (99.640 %)`. Para saber si el port
lo había causado, guardé el cambio con `git stash`, corrí el verificador en limpio y dio
**el mismo 99.640 %**, con las mismas 18 diferencias (`rcantidad calculado=N
almacenado=0`, en recibos sin castigos) y las mismas 8 de
`rcantidadcuartillos`. El port no introdujo ninguna.

Esas 18 son un defecto aparte, del cálculo del recibo contra datos viejos: no es de esta
feature y no se tocó. Queda anotado, sin abrir tarea.

El writer agregó además el flag `--solo-precio`, que corre los casos de precio sin tocar
la base y sale con exit 0. Ése es el check útil de acá en adelante.

## Prueba en teléfono — 21-nov-2026

Hecha en un **Samsung SM-A055M, Android 14**, contra el BE de desarrollo
(`ERP.Backend\bin\Debug\net8.0`, que sirve `sci_altura_0826`). **No hizo falta compilar
un APK**: el `cr.confeldan.recibos` instalado es el dev-client (`DEBUGGABLE`, con
`expo.modules.devlauncher`), y todo el cambio es JavaScript, migración de esquema
incluida.

### Fila de prueba

No existía ninguna fila con `idsocio` y `codigo` vacío —0 de 516—, así que se insertó
una en `sci_altura_0826`. El productor **16636 (josefin salas salazar) tiene
`rc_codigo` en NULL**: es uno de los 27 del problema original.

```sql
INSERT INTO dbo.rc_precios
    (cosecha, tipocafe, calidad, zona, recibidor, tipo, codigo,
     monto, moneda, recalcula, flete, compania, idsocio)
VALUES ('2026-2027','9','M',NULL,NULL,NULL,NULL, 9.99,1,1,0.00,1, 16636);
```

Verificado antes de correrla: `tr_rc_precios_reprice` es **sólo de UPDATE**
(`ExecIsInsertTrigger = 0`), así que insertar no dispara el recálculo de recibos.
`Id` lo llena `tr_rc_precios` y `SyncUpdatedAt` tiene default `sysutcdatetime()`, así
que el pull incremental la entrega sola. Quedó como `idreprecio = 538`.

### Resultado

| criterio | evidencia observada |
|---|---|
| 4 — migración sin pérdida | `[🍉] [SQLite] Migrating from version 12 to 13... Migration successful`, y `PRAGMA user_version` = 13 en la base del teléfono |
| proyección | la fila 538 bajó con `id_socio = 16636`; el alias `idsocio AS id_socio` funciona de punta a punta |
| 2 — productor sin código | recibo `001-000014`, josefin (16636, código vacío) → `idreprecio 538`, **₡9.99** |
| 3 — la fila no se derrama | recibo `001-000015`, AARON (15187, código `C12749`) → `idreprecio 537`, **₡7.50** |
| 1 — igual que el servidor | `f_rc_busca_precio('2026-2027','9','M',NULL,'001',16636,NULL)` → 538/9.99; con cualquier otro idsocio → 537/7.50. Los tres recibos coinciden |

**El recibo 001-000015 es el que separa el código viejo del nuevo.** La fila 538 tiene
`codigo` vacío, así que el código viejo la leía como precio general y, al desempatar por
`idreprecio DESC`, se la habría aplicado a AARON: ₡9.99 en vez de ₡7.50. El recibo
`001-000014` por sí solo **no** prueba nada — el código viejo también habría caído en la
538, por la razón equivocada.

### Lo que costó llegar

El dev-client instalado es del **13-oct-2026**, anterior al arreglo de
`unstable_serverRoot` en `metro.config.js:26` (21-oct). Lleva horneado el entry
`apps/recibos/index`, relativo a la raíz del monorepo, y pedía
`/apps/recibos/index.ts.bundle` — que con la raíz del servidor en el proyecto da **404**,
con un `UnableToResolveError` en pantalla y un ANR encima. Comprobado con curl: esa ruta
daba 404 y `/index.ts.bundle` daba 200. Se comentó la línea 26 para la prueba y **se
revirtió al terminar** (árbol limpio, sin diff). La solución de fondo es recompilar el
dev-client, que lo regenera consistente con la configuración actual.

## Entrega — APK de Marespi, 21-nov-2026

Build de EAS `eca46d03-eec4-410e-b996-2067fbf85393`, perfil `marespi`, FINISHED, desde el
commit `2b1fe03`. **Probado por Alfredo en el teléfono: funciona.**

El catálogo de Marespi pasó a apuntar al túnel del beneficio
(`https://pharmacy-stud-moscow-rescue.trycloudflare.com`), verificado antes de hornearlo:
`GET /api/auth/me` responde 401 con `WWW-Authenticate: Bearer`.

Verificado sobre el propio APK, no sobre el repo: `assets/app.config` con el nombre, el
package `cr.confeldan.recibos.marespi` y la URL correctos; firma
`CN=Confeldan, OU=Desarrollo`; recurso `drawable/assets_clientes_marespi`.

**El truco de buscar una cadena distintiva en el bundle no aplica a este cambio**: la
columna `id_socio` ya existía en el esquema para otras tablas, y el port no agregó ningún
literal de texto nuevo. La verificación que vale acá es la procedencia — el `gitCommit`
que reporta `eas build:view --json`, contrastado con `git show <sha>:<archivo>`.

## Confirmación en Marespi — 22-nov-2026

El ambiente de prueba de Marespi corre un **respaldo de `sci_altura_0826`**, así que trae
los mismos `idsocio`: josefin salas salazar sigue siendo el **16636**. El respaldo es
anterior a la fila de precio de la prueba, así que Alfredo la volvió a insertar ahí —
también quedó con `idreprecio = 538`, a **9.99** — emitió un recibo desde la app y lo
sincronizó.

El recibo quedó guardado en el ERP con **`# Precio 538`, `Precio 9.99`**, valor 494.51.

### Lo que ese 9.99 NO prueba

Escribí primero que eso confirmaba la metadata v1.95 en la copia y que `ReciboCalcHook` no
pisaba el precio. **Las dos cosas eran falsas**, y la evidencia está en el código:

`ReciboCalcHook.cs:94-106` — salvo que el recibo venga con `manual=1`, el hook **sobrescribe**
`idreprecio` y `precio` con el resultado de su propia llamada a `f_rc_busca_precio`:

```csharp
if (!esManual) { ... data["idreprecio"] = price.idreprecio; data["precio"] = price.precio; }
```

O sea que **el 9.99 de la pantalla del ERP es la respuesta del servidor, no la del teléfono**.
Y `f_rc_busca_precio` es una función de la base: resuelve por `idsocio` sin consultar
`mt.MobileCollections`, así que tampoco dice nada sobre si el `ColumnsJson` de `precios` de esa
copia trae `idsocio AS id_socio`.

Lo que sí quedó probado en Marespi: el recibo viaja, se acepta y **lo almacenado es correcto**.
El circuito del servidor está bien. Lo que elige el teléfono sigue sin verificarse ahí.

### Por qué no se puede leer el precio del teléfono de Marespi

Tres caminos, los tres cerrados:

1. **La pantalla.** `ReciboScreen.tsx:62` lo dice explícito: *"EL PRECIO Y EL VALOR SE CALCULAN
   PERO NO SE MUESTRAN"*. El recibo del móvil no es un documento de pago.
2. **El papel.** Imprime una línea `ADELANTO`, pero ese número **no es el precio guardado**:
   `imprimir.ts:268-292` porta `f_re_precio_recibo_impreso`, que filtra `codigo is null` a
   propósito para que en el papel vaya siempre el genérico, y además lo multiplica ×20 (por
   fanega). Por diseño no coincide con el precio del recibo.
3. **La base del teléfono.** El APK de Marespi es un **release** firmado con el keystore de
   Confeldan, así que no es `DEBUGGABLE` y `adb shell run-as cr.confeldan.recibos.marespi`
   falla. Eso sólo funciona con el dev-client, que es debug.

La prueba del teléfono del **21-nov sobre `sci_altura_0826` sigue siendo la válida**: ahí sí se
leyó `recibos.db` directo y los `idreprecio` eran los correctos. El APK de Marespi corre el mismo
JS (commit `2b1fe03`).

Para cerrar Marespi hace falta **una consulta en esa copia**, no en el teléfono:

```sql
SELECT ColumnsJson FROM mt.MobileCollections WHERE CollectionName = 'precios';
```

Si trae `idsocio AS id_socio`, la v1.95 está. Si no, hay que aplicarla.

## Hallazgo lateral: el guardián del precio impreso quedó viejo

Buscando lo anterior apareció otra cosa, y **no la introdujo este cambio**: la trajo la
migración del servidor a `@idsocio`.

`dbo.f_re_precio_recibo_impreso` —y su port en `imprimir.ts:303-314`— excluye los precios de
productor con un solo filtro: **`and codigo is null`**. Esa era una regla válida cuando un
productor se identificaba por `codigo`. Hoy se identifica por `idsocio`, así que **una fila con
`idsocio` y sin `codigo` pasa el filtro** y entra al grupo de los genéricos.

Verificado en `sci_altura_0826`. `re_precios` es un **SYNONYM** de `dbo.rc_precios` (misma
tabla), y los candidatos para cosecha 2026-2027 / tipocafe 9 / calidad M con `codigo IS NULL`
son:

| idreprecio | monto | idsocio | tipo | recibidor | zona |
|---|---|---|---|---|---|
| 534 | 2500.00 | NULL | NULL | NULL | 5 |
| **538** | **9.99** | **16636** | NULL | NULL | NULL |
| 537 | 7.50 | NULL | NULL | NULL | NULL |

La 538 es el precio privado de josefin y está compitiendo por salir impresa en el papel **de
cualquier productor**. Es exactamente *"un número plausible y equivocado en el documento que la
persona firma"* contra lo que advierte el comentario de `imprimir.ts`, ahora con plata ajena.
El `ORDER BY` de la función no tiene desempate entre la 538 y la 537: las dos tienen tipo,
recibidor y zona en NULL.

**Hoy no muerde en esta base**, y por eso no se había visto. El reparto actual de
`dbo.rc_precios`:

| | con código | sin código |
|---|---|---|
| **con idsocio** | 310 | **1** ← mi fila de prueba |
| **sin idsocio** | — | 206 |

Las 310 filas reales llevan los dos campos, así que `codigo is null` todavía las excluye. La
única que cae en el hueco es la que inserté yo.

**Pero la premisa de esta feature es justamente lo que lo vuelve alcanzable:** son 27 los
productores sin `rc_codigo`, y en cuanto la oficina le cargue un precio propio a uno de ellos,
esa fila nace con `idsocio` y sin `codigo`. Ahí el hueco deja de ser teórico. Falta confirmar el
camino de escritura del web para saber si realmente deja `codigo` vacío en ese caso.

El arreglo es una línea en cada lado —agregar `and idsocio is null` al guardián— pero toca la
función del servidor, así que **no se hizo: es decisión y autorización de Alfredo**.

## Pendiente de Alfredo

**Una divergencia que queda viva, y es hacia adelante, no de datos viejos.** Cuando el
recibo se emite con "No está registrado", `productor` es `null`, así que la entrada sale
con `idsocio: null` y `codigo: ""` y **sólo aplican precios generales**. Si ese socio
genérico tuviera filas de precio propias, el servidor se las aplicaría y el móvil no: el
recibo se imprimiría con un precio y se guardaría con otro. El id del genérico ya está
resuelto en `recibo.ts` (`idGenericoResuelto`), así que cerrarlo es pasarlo a la entrada —
pero el genérico está declarado fuera de alcance y la decisión es de Alfredo.

Nada más bloquea esta feature. Lo que queda abierto son los tres puntos de "fuera de alcance",
más la decisión de si `ge_companias.ben_socio_generico` pasa a llevar `idsocio` (hoy es
`varchar`, un código, y está en **NULL en las dos compañías** de `sci_altura_0826`, así
que el genérico no se puede probar en esta base).
