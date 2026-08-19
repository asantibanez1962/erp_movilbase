/**
 * Números en letras, igual que `dbo.towords_numero` del servidor.
 *
 * El comprobante imprime la cantidad dos veces —en cifras y en letras—: `diecisiete
 * CAJUELA(S)` debajo de `CAJUELAS: 17`. No es adorno: es la práctica de cualquier
 * documento que se firma, porque una cifra sola se altera con un trazo y la letra no.
 *
 * ⚠️ ESTO REPRODUCE AL SERVIDOR, NO AL ESPAÑOL "CORRECTO". El papel del móvil tiene que
 * salir idéntico al del web —el productor recibe el mismo documento venga de donde
 * venga— así que las formas se copiaron midiendo la salida real de `towords_numero`:
 *
 *     1     → «un»              (apocopado, no "uno")
 *     21    → «veintiuno»       (pero acá NO se apocopa)
 *     31    → «treinta y un»
 *     101   → «ciento un»
 *     1000  → «un mil»          (no "mil" a secas)
 *     0     → «»                (cadena VACÍA, no "cero")
 *
 * En minúsculas, que es como las devuelve el servidor y como salen en el reporte.
 *
 * Hasta 999 999: las cajuelas de un recibo no pasan de unos cientos, y un conversor
 * general sería más código del que hace falta mantener.
 */

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete",
  "dieciocho", "diecinueve", "veinte",
];

const DECENAS = [
  "", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta",
  "ochenta", "noventa",
];

const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function hasta999(n: number): string {
  // El 1 va apocopado en todos lados MENOS dentro de "veintiuno".
  if (n <= 20) return n === 1 ? "un" : UNIDADES[n]!;

  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    if (u === 0) return DECENAS[d]!;
    // Veintiuno..veintinueve van pegados y con la forma plena: «veintiuno».
    if (d === 2) return `veinti${UNIDADES[u]}`;
    return `${DECENAS[d]} y ${u === 1 ? "un" : UNIDADES[u]}`;
  }

  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  return resto === 0 ? CENTENAS[c]! : `${CENTENAS[c]} ${hasta999(resto)}`;
}

export function enLetras(n: number): string {
  const entero = Math.floor(Math.abs(n));
  // ⚠️ El cero es cadena VACÍA, como el servidor. En el recibo no molesta: los cuartillos
  // en cero se imprimen como «SIN», no como el número en letras.
  if (entero === 0) return "";
  if (entero < 1000) return hasta999(entero);

  const miles = Math.floor(entero / 1000);
  const resto = entero % 1000;
  // «un mil», no «mil»: es lo que devuelve el servidor.
  const prefijo = `${hasta999(miles)} mil`;
  return resto === 0 ? prefijo : `${prefijo} ${hasta999(resto)}`;
}

/**
 * Los cuartillos del comprobante: en cero dicen «SIN», no el número.
 *
 * Sale de la vista `vw_rc_recibo_impreso`, que hace exactamente eso. Imprimir «cero
 * CUARTILLO(S)» sería correcto y distinto de lo que ve el productor hoy.
 */
export function cuartillosEnLetras(cuartillos: number): string {
  return cuartillos > 0 ? enLetras(cuartillos) : "SIN";
}
