/**
 * Aritmética compatible con SQL Server.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * El cálculo del recibo es autoritativo en SQL Server (`f_rc_calcula_recibo`), donde
 * los `decimal(18,3)` son exactos: 0.1 es 0.1. En JavaScript todo número es un double
 * IEEE-754 y 0.1 no existe — lo más cercano es 0.1000000000000000055511151231257827.
 *
 * Esa diferencia es irrelevante casi siempre y catastrófica justo en los bordes del
 * redondeo. Un castigo que en SQL da exactamente 1.125 y se redondea a 1.25, en JS
 * puede dar 1.1249999999999998 y redondear a 1.00 — un cuartillo de diferencia en un
 * papel firmado por el productor.
 *
 * Por eso el port no usa aritmética libre: reproduce los puntos EXACTOS donde SQL
 * redondea, que son las asignaciones a variables tipadas.
 */

/**
 * `CAST(x AS INT)` de SQL Server: trunca hacia cero.
 *
 * No es `Math.floor`. Para −1.7, SQL da −1 y `Math.floor` da −2. En este cálculo los
 * montos deberían ser positivos, pero `errormedidor` puede ser negativo y arrastrar la
 * cantidad final por debajo de cero en un recibo mal capturado.
 */
export function truncar(v: number): number {
  return Math.trunc(v);
}

/**
 * Redondeo de SQL Server al asignar a un `decimal(p, s)`: mitad **alejándose de cero**.
 *
 * No es `Math.round`, que para negativos redondea hacia +∞ (Math.round(-0.5) === -0).
 *
 * El `toPrecision(15)` no es superstición: al escalar por 10^s el double arrastra el
 * error de representación hasta la superficie —`1.005 * 100` da `100.49999999999999`—
 * y sin corregirlo el redondeo cae para el lado equivocado. Quince dígitos
 * significativos es donde el double empieza a mentir, así que recortar ahí devuelve el
 * valor que un decimal exacto habría tenido.
 */
export function redondear(v: number, escala: number): number {
  if (!Number.isFinite(v)) return v;
  const f = 10 ** escala;
  const x = Number((v * f).toPrecision(15));
  const r = x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
  return r / f;
}

/**
 * Port de `dbo.redondeo_Cafe(@monto, @factor)`.
 *
 * El original:
 *   @f = 100/@factor*.01                       -- para 0.25 → 4
 *   @resultado = convert(integer, (@monto*@f)+.5) / @f
 *
 * O sea: redondea al múltiplo de `factor` más cercano, con la mitad hacia arriba.
 * Con factor 0.25 —el único que usa el cálculo del recibo— redondea al cuartillo.
 *
 * ⚠️ El `convert(integer, ...)` trunca hacia cero, así que para montos NEGATIVOS el
 * original no redondea simétricamente: −1.6 da −1.25 y no −1.75. Se reproduce el
 * comportamiento tal cual, incluida la asimetría. Copiar un defecto a propósito es
 * preferible a "arreglarlo" y que el móvil imprima un número distinto del que el
 * servidor va a guardar.
 */
/**
 * Redondeo al cuartillo con PISO, para la cantidad final del recibo.
 *
 * ⚠️ No usa `redondeoCafe` a propósito, aunque el factor sea el mismo 0.25.
 *
 * `redondeo_Cafe` hace `convert(integer, monto*4 + .5)`, y ese convert trunca hacia
 * cero. Para −50 da −199.5 → −199 → **−49.75**: redondear un negativo que ya era
 * exacto lo corre un cuartillo. Se comprobó contra la base — dos recibos de la cosecha
 * en curso se rompían al pasarlos por ahí.
 *
 * Con piso, −199.5 → −200 → −50. Para positivos las dos dan lo mismo.
 *
 * `redondeo_Cafe` se deja intacta en el servidor porque la usan otros módulos; el
 * arreglo vive dentro del cálculo del recibo, que es donde el valor puede ser
 * negativo. Ver `Sql/Upgrades/v1.71/RC/16_fn_calcula_recibo_cuartillos.sql`.
 */
export function redondearACuartillo(v: number): number {
  return Math.floor(Number((v * 4 + 0.5).toPrecision(15))) / 4;
}

export function redondeoCafe(monto: number, factor: number): number {
  if (factor === 0) return monto;
  const f = 100 / factor * 0.01;
  const escalado = Number((monto * f + 0.5).toPrecision(15));
  // El RETURNS es decimal(18,2); con /4 los valores caen en .00/.25/.50/.75 y la
  // escala 2 es exacta, pero se aplica igual para no depender de esa coincidencia.
  return redondear(Math.trunc(escalado) / f, 2);
}

/**
 * Parte un monto en cajuelas y cuartillos.
 *
 * REGLA DEL DOMINIO: las cajuelas son enteras y los cuartillos van de 0 a 3, cada uno
 * vale 0.25. El monto es `cajuelas + cuartillos*0.25`.
 *
 * ⚠️ ACÁ EL PORT SE APARTA DEL SQL A PROPÓSITO. El original hace:
 *
 *     @entero     = CAST(@v AS INT)              -- trunca HACIA CERO
 *     @cuartillos = CAST((@v - @entero)/0.25 AS INT)
 *
 * Truncar hacia cero funciona para positivos, pero rompe con negativos: −31.75 daría
 * −31 cajuelas y −3 cuartillos, y −3 no existe en el dominio. Usando piso da −32 y 1,
 * que suma lo mismo y sí es representable.
 *
 * No es una preferencia estética: se comprobó contra la base que los recibos negativos
 * están guardados con la descomposición de piso (−32 / 1), no con la del SQL. O sea
 * que la función tiene ahí un defecto latente y lo correcto es lo que hay guardado.
 * Queda anotado como arreglo pendiente del BE; mientras no se corrija, el móvil y el
 * servidor van a diferir en los recibos de cantidad negativa.
 *
 * El `toPrecision(15)` antes de piso evita que `(1.75 − 1)/0.25`, que en punto
 * flotante da 2.9999999999999996, se convierta en 2 cuartillos en vez de 3.
 */
export function partirEnCuartillos(v: number): { entero: number; cuartillos: number } {
  const entero = Math.floor(Number(v.toPrecision(15)));
  const cuartillos = Math.floor(Number(((v - entero) / 0.25).toPrecision(15)));
  return { entero, cuartillos };
}
