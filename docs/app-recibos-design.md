# App móvil `recibos` — Bitácora, recibos e impresión en el recibidor

Estado: **diseño**, sin código todavía. Documento de trabajo — las decisiones que
están tomadas dicen por qué, y lo que falta definir está marcado como abierto.

El POC `apps/recibos-cr` queda como referencia histórica y se descarta: es anterior a
toda la arquitectura de sync, no usa WatermelonDB, y sus descuentos eran literalmente
constantes inventadas en el HTML de impresión (`-₡250 humedad`, `-₡100 broca`).

---

## 1. Estado de partida — qué ya existe en el BE

Más de lo que parecía. El módulo RC ya resuelve casi todo del lado del servidor; lo
que falta es casi todo del lado del móvil.

| Pieza | Dónde | Estado |
|---|---|---|
| Recibo | tabla `recibos` (trigger `tr_recibos`), entidad `Recibo` | ✅ completo |
| Cálculo de castigos | `dbo.f_rc_calcula_recibo` | ✅ port del PB, 90 líneas |
| Precio con fallback | `dbo.f_rc_busca_precio` | ✅ |
| Cálculo al grabar | `ReciboCalcHook` (IBeforeCreate) | ✅ autoritativo |
| Consecutivo | `sp_rc_recibo_consecutivo` + `rc_Talonario` | ✅ atómico, sin gaps |
| Preview en vivo | `RcReciboComputeController` (`/compute`) | ✅ usado por el web |
| Remedida | `remedida`, `remedida_ruta`, `RemedidaPrintController` | ✅ existe |
| Transportistas | catálogo `re_transportistas` | ✅ |
| **Bitácora (jornada)** | tabla `re_Bitacora_recibos` | ⚠️ **el BE no la conoce** |

La bitácora existe en la base desde el PowerBuilder, con su FK a `rc_recibidores`, y
`recibos.idbitacora` la referencia. Pero **ninguna línea de código del BE la toca**: no
tiene entidad, ni mapeo, ni metadata. Hay que conectarla, no inventarla.

### Un nombre que significa tres cosas

Antes de escribir nada conviene fijar el vocabulario, porque "bitácora" ya está tomado
dos veces:

1. `bitacora_recibos`, `bitacora_rc_precios`, … — tablas de **auditoría**: una fila por
   versión de un registro (alta/modificación). Nada que ver con esto.
2. La **bitácora del teléfono** en la app promotor — log local de diagnóstico.
3. `re_Bitacora_recibos` — **la jornada de trabajo del recibidor**, que es de la que
   habla este documento.

En la UI se llama *Bitácora*, que es como la nombra la operación. En el código, cuando
haya ambigüedad, la de este documento es la **jornada**.

---

## 2. Scope confirmado

- Consulta de productores (solo lectura, como en promotor).
- **Bitácora**: abrir, acumular recibos, cerrar imprimiendo.
- **Recibos**: crear e imprimir. **No se modifican** — el sync es solo de altas.
- **Remedida** en beneficios principales (ver §8, falta definir).
- Parámetros de contexto: usuario, cosecha y **recibidor donde está**.
- Impresión térmica **Bluetooth directa ESC/POS** (sin diálogo del sistema).

Fuera de scope: modificación de recibos, anulación desde el móvil, tipo de café en la
bitácora.

### App nueva

`apps/recibos`, reusando `@erp/shared-api`, `@erp/shared-sync` y `@erp/shared-types`, y
el mismo esquema de branding por cliente que ya tiene promotor. El recibidor y el
promotor son personas distintas, con teléfonos y permisos distintos: no hay razón para
meterlos en el mismo APK.

---

## 3. El problema central: entregar un documento definitivo sin red

Todo lo difícil de este módulo sale de una sola frase: **el recibo se imprime en el
recibidor, sin señal, y se le entrega firmado al productor**. Eso obliga a que el
teléfono resuelva offline dos cosas que hoy resuelve el servidor:

1. **el número del recibo**, y
2. **el monto**, que depende de los castigos y del precio.

Si cualquiera de las dos se resolviera al sincronizar, el papel que tiene el productor
diría algo distinto de lo que quedó en el sistema. No es un detalle de UX: es un
documento firmado que no cuadra.

---

## 4. Numeración offline

### Cómo numera hoy el servidor

`sp_rc_recibo_consecutivo`, en modo automático (`tipo=2`):

```sql
@recibo = RIGHT('000' + @recibidor, 3) + RIGHT('000000' + @cur, 6)
```

Nueve dígitos pegados —`001000123`— que entran a `recibos.recibo`, que es **`char(10)`**
(verificado en `sys.columns`, no en el model builder: ahí una línea vecina declara
`numeric(18,0)` y es fácil atribuírsela a esta columna).

Siendo texto de 10, el guión **sí cabe y sí se guarda**: en la base conviven
`001-004116` y `0000000009`. O sea que hay al menos dos formatos históricos y el
procedimiento actual genera un tercero (9 dígitos sin guión, con relleno a 10).
**Hay que fijar cuál emite el móvil antes de imprimir el primero**, porque el número
va en el papel del productor y en la llave cosecha + número.

La unicidad es por **cosecha + número**, y el recibidor va adentro del número. Como hay
**un solo teléfono por recibidor**, cada equipo es dueño de su rango y puede numerar
solo, sin coordinarse con nadie.

### ⚠️ Trampa: `rc_Talonario.ultimo` NO es el último — es el próximo

El procedimiento hace:

```sql
@cur  = ISNULL(NULLIF(ultimo,''), inicio)   -- este número se usa AHORA
...
ultimo = @cur + 1                            -- queda listo el SIGUIENTE
```

O sea que después de cada recibo, el campo llamado `ultimo` contiene **el número que va
a usar el recibo siguiente**. Si el teléfono lo lee como "el último usado" y le suma
uno, se salta un número en cada recarga.

Ese error no se ve en desarrollo. Se ve cuando la oficina detecta huecos en la
numeración de una cosecha, con los papeles ya entregados y sin forma de saber si el
hueco fue un recibo perdido o un bug.

**Regla para el móvil: el valor de `ultimo` se usa tal cual. Nunca se le suma nada al
leerlo.**

### Recuperar un teléfono

La idea es que `rc_Talonario.ultimo` quede al día en la base central, para que un
teléfono reinstalado, con la base rebajada, o un equipo de reemplazo, recupere su
contador en la primera sincronización.

⚠️ **Hoy eso NO pasa, y hay que construirlo.** Verificado: el único lugar de toda la
base que actualiza `ultimo` es `sp_rc_recibo_consecutivo`, y ese procedimiento sólo
corre cuando **el servidor** asigna el número. `tr_recibos` es el trigger de auditoría
—alimenta `bitacora_recibos`— y no toca el talonario.

Como el móvil trae su propio número, el proc nunca se llama: `ultimo` se queda
congelado. Un teléfono reinstalado leería un contador viejo y **empezaría a repetir
números ya entregados en papel**.

**El avance va donde pasan todas las inserciones, no sólo las del móvil.** Una sola
regla, en vez de una por origen — así el talonario refleja la realidad venga el recibo
del teléfono o del web:

```
ultimo = MAX(ultimo, secuencia_del_recibo + 1)
```

Dos propiedades que hacen que esto sea seguro:

- **`MAX` y no asignación directa**, para que un recibo que llega tarde —el teléfono
  sincronizó fuera de orden— no haga retroceder el contador.
- **Es idempotente**, así que convive con `sp_rc_recibo_consecutivo` sin pisarlo: el
  proc deja `ultimo = cur+1` y la regla calcula ese mismo valor. No hay doble avance en
  los recibos del web.

Como red de seguridad, el contador local **nunca retrocede**:

```
próximo = max(próximo local, ultimo del servidor)
```

Así, si por cualquier razón el servidor viniera atrasado, el teléfono no reusa un
número que ya imprimió.

### ⚠️ El servidor exige un talonario activo

Si no existe una fila en `rc_Talonario` con `estado='A'` y `tipo=2` para ese recibidor y
cosecha, el procedimiento tira `RAISERROR` y **rechaza el recibo**.

Conceptualmente "no se usan talonarios" —es uno solo, corrido, de `001-000000` a
`001-999999` por cosecha— pero la fila tiene que existir igual. Es un seed por recibidor
con teléfono, no un proceso. Si falta, el sync falla y el recibo queda pendiente sin que
el mensaje diga por qué. **Va como precondición de despliegue, verificada antes de
entregar un equipo.**

### La bitácora se numera igual

`re_Bitacora_recibos.numero` es hoy `nchar(5)`, que no da para meterle el recibidor
adentro: quedarían 2 dígitos de secuencia, 99 bitácoras por cosecha.

**Decidido: se ensancha** y se numera con la misma regla que el recibo — recibidor(3) +
secuencia. Una sola regla de numeración para las dos entidades, en vez de dos que hay
que recordar. Es un `ALTER` de bajo riesgo: ninguna aplicación toca esa tabla hoy.

---

## 5. El cálculo del recibo, dos veces

### Es portable

`f_rc_calcula_recibo` son ~90 líneas de aritmética determinista sobre cuatro catálogos
chicos, más `dbo.redondeo_Cafe(valor, 0.25)`:

| Catálogo | Para qué |
|---|---|
| `rc_castigosbroca` | castigo por broca, por bloques de 100 |
| `re_castigos_cosecha` | tope y % de castigo por verde / flote maduro / flote seco |
| `rc_recibidorescosechanivel` | nivel del recibidor en la cosecha |
| `rc_precios` | precio, con fallback de más específico a más general |

Todos se sincronizan al teléfono como catálogos de solo lectura. **El cálculo offline es
viable** — era la duda que podía hundir el módulo entero.

### ⚠️ Trampa: el tipo de café vive en `zona`

En `recibos`, el código de tipo de café **no está en un campo llamado `tipocafe`: está
en `zona`**. Lo dice el propio hook —`var zona = ... // = código tipocafe`— y se lo pasa
a `f_rc_busca_precio` como el parámetro `@tipocafe`.

Cualquiera que llegue nuevo va a mapear "tipo de café" al campo obvio. El error no
revienta: devuelve un precio equivocado, que es peor.

### La divergencia es el riesgo real, no el port

El `ReciboCalcHook` recalcula **siempre** al grabar, y el propio comentario dice que
`/compute` es solo preview: el servidor no confía en el cliente. Para el web eso está
perfecto — el usuario ve un número y el servidor guarda el bueno.

Para el móvil no alcanza, porque **su "preview" se imprime y se entrega firmado**. Si el
servidor recalcula distinto, hay un papel que contradice al sistema.

No hay forma de evitar las dos implementaciones si se quiere imprimir offline. Lo que sí
se puede es que la divergencia sea imposible de ignorar:

1. El móvil manda **lo que calculó y lo que imprimió**, no solo los insumos.
2. El servidor recalcula y **compara**. Si difieren, lo registra como incidencia
   —`MobileSyncLog` ya existe para esto— en vez de pisar el valor en silencio.
3. Tests con recibos reales de la base corriendo por las dos implementaciones.

Sin el punto 3, las dos versiones se separan en la primera cosecha en que alguien
cambie un castigo, y nadie se entera hasta que un productor reclama.

### 5.1 Resultado de la verificación — ✅ el port reproduce el cálculo

`packages/recibos-calc` ya existe, y `scripts/verificar.cjs` lo corre contra los recibos
reales de la base. No es un test unitario a propósito: la pregunta no es "¿pasa?" sino
**"¿cuántos de los ya emitidos reproduce, y los que no, por qué?"**.

| Cosecha | Recibos | Coincide |
|---|---|---|
| 2025-2026 (en curso, sin las pruebas de agosto) | 38.487 | **99,94 %** |
| 2024-2025 | 35.854 | 99,89 % |
| 2023-2024 | 39.855 | 99,95 % |

Las cosechas anteriores a 2022 son cargas de otros sistemas y no sirven de referencia:
sus recibos no tienen castigos, o sea que nunca pasaron por este cálculo.

**Conclusión: se puede imprimir offline.** Era el riesgo que podía invalidar el módulo.

### 5.2 Dos defectos del BE que encontró la verificación

Ninguno da error: los dos devuelven un número equivocado en silencio. Y los dos los
destapa el móvil, porque hoy no se ejercitan.

**1. `f_rc_calcula_recibo` no redondea la cantidad final al cuartillo.**

```sql
@cantidad = @bruto - @rflote - @castigosbroca - @rverde + ISNULL(@errormedidor,0)
```

Los rebajos sí pasan por `redondeo_Cafe`, pero `errormedidor` entra crudo. Con un error
de −2,753 la cantidad da 180,997 — que **no es representable**, porque las cajuelas son
enteras y los cuartillos van de 0 a 3.

Por qué no reventó: de los 292.243 recibos de la base, **ninguno** tiene cantidad fuera
de cuartillo, y de los 3.781 con error de medidor en la cosecha actual, **todos** son
múltiplos de 0,25. La resta cae en cuartillo por casualidad aritmética. Sólo 22 recibos
en toda la historia tuvieron un error con decimales sueltos, y el PowerBuilder los
redondeaba.

El móvil es justamente lo que abre esa puerta, y del lado impreso.

**2. La descomposición en cuartillos trunca en vez de usar piso.**

```sql
@rcantidad = CAST(@cantidad AS INT)   -- trunca HACIA CERO
```

Para −31,75 da −31 cajuelas y −3 cuartillos. La base guarda −32 y 1, que suma lo mismo
y sí respeta el rango 0..3.

**3. `redondeo_Cafe` corre los negativos un cuartillo** — apareció al arreglar el 1.

```sql
@resultado = convert(integer, (@monto*@f)+.5) / @f   -- convert trunca hacia cero
```

Para −50: `−199.5 → −199 → −49.75`. O sea que redondear un valor **que ya era exacto**
lo cambia. Se descubrió porque el primer intento de arreglo usaba `redondeo_Cafe` para
la cantidad final y rompió dos recibos de la cosecha en curso que antes coincidían.

La función se deja **intacta**: la usan otros módulos y cambiarla afectaría cálculos
que este trabajo no verificó. El redondeo se hace con `FLOOR` dentro del cálculo del
recibo, que es donde el valor puede ser negativo. Para positivos las dos dan lo mismo.

### 5.3 Estado: arreglado y verificado sin regresiones

`Sql/Upgrades/v1.71/RC/16_fn_calcula_recibo_cuartillos.sql` aplica los tres puntos.
Medido contra la base, mismas muestras de 5.000 recibos antes y después:

| Cosecha | Original (cantidad / descomp.) | Con el arreglo |
|---|---|---|
| 2025-2026 | 5000 / 4999 | **5000 / 5000** |
| 2024-2025 | 4996 / 4996 | **4999 / 4999** |
| 2023-2024 | 4996 / 4995 | **4998 / 4998** |
| 2022-2023 | 4945 / 4943 | **4945 / 4945** |

Mejora en las cuatro cosechas y no regresa en ninguna. Con la función corregida, el
port en TypeScript sube a **99,95 %** en la cosecha en curso y **99,97 %** en 2023-2024.

---

## 6. Bitácora (jornada)

### La tabla que ya existe

```sql
re_Bitacora_recibos (
  idbitacora    numeric(18,0) IDENTITY,   -- PK
  numero        nchar(5),                 -- ⚠️ a ensanchar (§4)
  recibidor     varchar(3),               -- FK rc_recibidores
  fecha         date,
  medidor       varchar(50),
  transportista varchar(50),
  placacamion   varchar(20),
  hora_inicio   time(7),
  hora_final    time(7),
  observaciones varchar(100),
  cosecha       char(10)
)
```

Decisiones sobre los campos:

- **`medidor` = el usuario de la app.** Se llena solo. No es el medidor de la remedida.
- **`transportista`**: hay catálogo `re_transportistas` → lista, no texto libre. Se
  escribe con una mano y bajo el sol.
- **Cerrada ⇔ `hora_final` no nula.** No hace falta columna de estado del lado del
  servidor: una condición no puede quedar inconsistente con los datos, un flag sí.
- **Sin tipo de café** — quedó fuera de scope.
- `fecha` + `hora_inicio`/`hora_final` están separados (patrón legacy). El teléfono
  maneja timestamps y los parte al enviar.

### Estado y contador de impresiones: locales

El teléfono **sí** necesita estado y contador de impresiones. Van en el esquema local,
no en la tabla central, salvo el contador que se sincroniza como dato de auditoría.

### Cerrar es imprimir

No hay botón de cerrar separado: **al imprimir el ORIGINAL, la bitácora queda cerrada**.
Elimina el estado intermedio de "cerrada pero sin papel", que en el campo es el que
genera dudas.

El cierre imprime la lista de recibos de esa bitácora con **número, cantidad bruta y
porcentajes de descuento**. Nada más.

Una vez cerrada no admite más recibos. Si hace falta seguir recibiendo, se abre otra.

### Varias bitácoras abiertas a la vez

Puede haber más de una abierta el mismo día: algunos clientes separan bitácoras por
categoría de café. Consecuencia para la UI:

- **Una sola abierta** → el recibo se le asigna sin preguntar.
- **Varias abiertas** → el recibidor elige a cuál va. Es el único momento en que la app
  puede pedirle que decida algo que no puede deducir.

### `idbitacora` es IDENTITY, y eso ya está resuelto

El id real lo pone el servidor, pero el teléfono crea la bitácora offline y le cuelga
recibos antes de sincronizar. Es exactamente el caso del entregador y su solicitud en la
app promotor: el motor de sync resuelve el padre por **ClientUuid**. No hay nada nuevo
que diseñar acá.

---

## 7. Impresión

### ORIGINAL / COPIA sin tocar el esquema

`recibos.impreso` ya es `tinyint`, no bit. **Sirve de contador tal cual**: 0 sin
imprimir, 1 original, 2+ copias. Encaja con la convención de no usar BIT.

⚠️ Verificar antes de usarlo así: si el PowerBuilder o el web hacen `WHERE impreso = 1`
para decir "ya impreso", un recibo con dos copias se les escapa.

### Si la impresión del original falla

**Decisión tomada: el primer intento manda.** Si falla, las siguientes salen marcadas
COPIA y se vive con eso. Se documentó la alternativa (confirmar el cierre solo después
de una impresión exitosa) y se descartó.

### Bluetooth ESC/POS directo

El POC abría el diálogo del sistema y el usuario elegía la impresora en cada recibo —
tres o cuatro toques extra por recibo, decenas de veces al día. Va conexión directa:
la app manda los bytes, un toque por recibo.

Es módulo nativo nuevo ⇒ APK nuevo, no sale por actualización de JS.

**Impresora: 3nStar, papel de 80 mm (3").** ESC/POS ya probado en el POC y en promotor,
así que el riesgo de hardware está descartado — lo nuevo es sólo la conexión directa en
vez del diálogo del sistema. Los 80 mm coinciden con lo que ya usaba el POC
(`@page { size: 80mm }`, ancho 226 pt).

---

## 8. Remedida — falta definir

En beneficios principales se reciben recibos de clientes **y** camiones que vienen de
los recibidores. El BE ya tiene `remedida`, `remedida_ruta`, `RemedidaConsecutivoHook`,
`RemedidaPrintController` y `RemedidaTransportePdfBuilder`.

**Hipótesis a confirmar:** si `placacamion` es el camión que se lleva el café del
recibidor, entonces la bitácora es el manifiesto de ese viaje y la remedida es su
re-medición al llegar. Si es así, conviene que la remedida pueda referenciar la
bitácora: ahí aparece solo el cuadre que hoy debe hacerse a mano — *lo que el recibidor
despachó contra lo que llegó*.

Si la placa es otra cosa, esto se cae y hay que rediseñarlo.

---

## 9. Sync

Encaja sin cambios de arquitectura sobre lo que ya funciona en promotor:

- **Solo altas.** No hay modificación de recibos ⇒ `WritableFieldsJson` sin
  `UpdatableFieldsJson`. Se ahorra todo el problema de locks y concurrencia que costó
  resolver en solicitudes.
### Catálogos de bajada

Todos **ya tienen entidad en el BE**. No hay que crear ninguna: sólo registrarlas en
`mt.MobileCollections`. La única tabla sin entidad en todo el módulo es la bitácora.

| Catálogo | Entidad / tabla | Para qué |
|---|---|---|
| Productores | `productores` | consulta y dueño del recibo |
| Fincas | `Finca` | `IdFinca`, `nombrefinca`; cuelgan del productor |
| Cuotas de certificado | `ProductorCuota` | si el recibo puede ser certificado (§9.1) |
| Entregadores de la cuota | `ProductorCuotaGrupo` | quién puede entregar contra esa cuota |
| Zonas | `Zona` | |
| Tipo de café | `TipoCafe` | ⚠️ en el recibo se guarda en `zona` (§5) |
| Tipo de descuento | `TipoCastigo` | |
| Descuentos por cosecha | `CastigoCosecha` → `re_castigos_cosecha` | cálculo: tope y % |
| Niveles por recibidor/cosecha | `RecibidorCosechaNivel` | cálculo: nivel |
| Castigos de broca | `CastigoBroca` → `rc_castigosbroca` | cálculo: bloques de 100 |
| Calidades | `Calidad` | entra al precio |
| Certificados | `Certificado` | |
| Precios | `Precio` → `rc_precios` (trigger `tr_rc_precios`) | precio a asignar e imprimir |
| Provincia / Cantón / Distrito | `ge_provincia`, `vw_Canton`, `vw_Distrito` | **imprimir el nombre en el recibo** |
| Recibidores | `Recibidor` | |
| Transportistas | `re_transportistas` | bitácora |
| Cosechas | `Cosecha` | contexto |
| Talonario | `Talonario` → `rc_Talonario` | contador (§4) |

La geografía es fija y chica (7 provincias, 82 cantones, ~490 distritos): baja una vez
y no vuelve a moverse. Se sincroniza completa, sin filtro.

**Productores: filtrados por la zona del recibidor.** El recibidor pertenece a una zona
y el productor también, así que baja sólo la intersección — el mismo patrón de
`ZonaFilterSql` que ya usa promotor. Y **no baja la fila entera**: `ColumnsJson` proyecta
sólo `idsocio`, `codigo`, `nombre`, `cedula`, `email`, `telefono`. De las fincas, sólo
`IdFinca` y `nombrefinca`.

Vale registrar el riesgo que esto deja abierto: si llega a entregar un productor de otra
zona, no va a estar en el teléfono y el recibidor no puede hacerle el recibo. Habrá que
ver en campo si pasa y con qué frecuencia.

### 9.1 ⚠️ Cuotas de certificado: falta definir si es bandera o techo

Van `ProductorCuota` (IdSocio + certificado + cosecha + cuota) y `ProductorCuotaGrupo`
(los entregadores habilitados contra esa cuota). **`FincaCuota` NO se usa acá**, aunque
exista.

Que la cuota tenga grupo de entregadores tiene una consecuencia de UI: para decidir si
el recibo puede ir certificado no basta con el productor — importa **quién está
entregando**. Si entrega alguien que no está en el grupo, la cuota no aplica.

**El monto de la cuota no se usa y no baja al teléfono.** Sólo importa si el recibo
admite certificado o no: existe cuota para ese productor, certificado y cosecha, y el
que entrega está en el grupo. `cuota` y `premio` quedan fuera de `ColumnsJson`.

Vale dejar dicho por qué esto es una buena noticia y no un detalle: si el monto fuera un
techo a consumir, el teléfono necesitaría el saldo — y offline nunca lo tendría al día,
porque el productor pudo haber entregado en otro recibidor esa misma mañana. Habría que
elegir entre bloquear café legítimo o permitir de más. **Al no llevar saldo, el problema
no existe**, y la decisión se resuelve con datos que no cambian durante la jornada.
- **Subida**: bitácoras y recibos, con la bitácora como padre resuelto por ClientUuid.
- **Contexto**: usuario + cosecha + recibidor, análogo a empresa/cosecha/zona en
  promotor. Cambiar de recibidor tiene el mismo efecto que cambiar de cosecha —
  **es un cambio de alcance y obliga a rebajar los datos**.

⚠️ Los triggers `tr_recibos` y `tr_rc_remedida_remdirty` se van a disparar con cada
inserción del móvil. Hay que saber qué hacen antes de mandar el primer recibo.

---

## 10. Plan de fases

- **Fase 0 — BE (bloqueante).** Entidad y mapeo de `re_Bitacora_recibos`; ensanchar
  `numero`; registrar colecciones en `mt.MobileCollections`; seed de talonarios;
  endpoint para leer `ultimo`; comparación móvil-vs-servidor del cálculo.
- **Fase 1 — Scaffold.** App nueva, branding, contexto usuario/cosecha/recibidor.
- **Fase 2 — Consulta.** Productores y catálogos bajando.
- **Fase 3 — Cálculo offline.** Port de `f_rc_calcula_recibo` y `f_rc_busca_precio` con
  tests contra recibos reales. **Antes de cualquier pantalla de captura.**
- **Fase 4 — Bitácora y recibos.** Alta offline, numeración local.
- **Fase 5 — Impresión.** ESC/POS Bluetooth, ORIGINAL/COPIA, cierre de bitácora.
- **Fase 6 — Remedida**, una vez definida.

El orden no es arbitrario: la fase 3 es la que puede invalidar el diseño. Si el cálculo
portado no reproduce exactamente los recibos históricos, hay que saberlo antes de haber
construido las pantallas encima.

---

## 11. Abierto

1. **¿La placa es el camión que va al beneficio?** Define si la remedida se ata a la
   bitácora (§8).
2. **¿Alguien crea recibos de un recibidor desde la oficina** mientras el teléfono está
   en el campo? Si sí, hay dos numeradores sobre el mismo rango.
3. Qué hace `tr_rc_remedida_remdirty`. (`tr_recibos` ya está: es el trigger de
   auditoría que alimenta `bitacora_recibos`. Va a dispararse con cada inserción del
   móvil, generando su fila de historial — esperado e inofensivo.)

### Cerrado durante el diseño

- **Impresora**: 3nStar 80 mm (3"), ESC/POS, ya probado en POC y promotor.
- **Alcance de productores**: por zona del recibidor, con proyección de columnas (§9).
- **Cuotas de certificado**: sólo existencia, sin monto ni saldo (§9.1).
- **Talonario `ultimo`**: hoy no lo actualiza nadie al sincronizar — hay que
  construirlo (§4). Se creía que lo hacía `tr_recibos`; no es así.
