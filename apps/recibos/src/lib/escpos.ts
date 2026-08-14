/**
 * Lo común de ESC/POS: comandos, el ancho del papel y el logo en ráster.
 *
 * Lo comparten la bitácora, la remedida y el recibo cuando se imprimen sin driver. Existe
 * por lo mismo que `papel.ts` para el HTML: los tres salen por la misma impresora, así que
 * cada byte que costó acertar vale para los tres. Duplicado, el primer ajuste en uno deja a
 * los otros atrás y no se nota hasta el papel.
 */

/** Lo que el comando GS v 0 necesita para dibujar el logo. */
export interface LogoRaster {
  anchoBytes: number;
  alto: number;
  b64: string;
}

/** Comandos ESC/POS, tal como los usa el procedimiento del legacy. */
export const ESC = "\x1B";
export const GS = "\x1D";
export const LF = "\r\n";

export const cmd = {
  /** Énfasis — el "tamaño mediano" del legacy. */
  medio: `${ESC}!\x0A`,
  /** Doble alto — el "tamaño grande". */
  grande: `${ESC}!\x14`,
  izquierda: `${ESC}a\x00`,
  centrado: `${ESC}a\x01`,
  negritaOn: `${ESC}E\x01`,
  negritaOff: `${ESC}E\x00`,
  /** Unidireccional. El legacy lo manda y lo dejó marcado con un "?"; se respeta. */
  uniOn: `${ESC}U\x01`,
  uniOff: `${ESC}U\x00`,
  /**
   * Cortar papel. ⚠️ Estas impresoras NO tienen cuchilla — el recibidor arranca el papel a
   * mano. El comando se manda igual porque el legacy lo manda y es inocuo en un equipo sin
   * cutter, pero no hay que contar con él: el avance para poder arrancar lo dan las líneas
   * en blanco del final.
   */
  cortar: `${GS}V\x00`,
};

/**
 * Ancho imprimible del papel, en BYTES. 72 mm a 203 dpi son 576 puntos = 72 bytes.
 *
 * Sólo se usa para centrar el logo: el texto lo centra la impresora sola con ESC a 1.
 */
const ANCHO_PAPEL_BYTES = 72;

/** Ancho útil de la fuente interna a 80 mm. La raya del legacy mide 31. */
export const RAYA = "-".repeat(32);

/**
 * Decodifica base64 a una cadena donde cada carácter ES un byte.
 *
 * Se escribe a mano porque `atob` no está garantizado en Hermes y `Buffer` no existe en
 * React Native. Son diez líneas y evita una dependencia para algo que se usa una vez.
 *
 * ⚠️ El resultado se manda con `latin1`, que mapea cada carácter 0-255 a su byte. En utf8
 * cualquier valor sobre 127 se codificaría en dos bytes y la imagen saldría corrupta.
 */
function deBase64(b64: string): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0;
  let acum = 0;
  let salida = "";
  for (const ch of b64) {
    if (ch === "=") break;
    const v = abc.indexOf(ch);
    if (v < 0) continue;
    acum = (acum << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      salida += String.fromCharCode((acum >> bits) & 0xff);
    }
  }
  return salida;
}

/**
 * El logo, como imagen ráster.
 *
 * `GS v 0 m xL xH yL yH` + los bytes del mapa de bits. `m = 0` es tamaño normal; el ancho va
 * en BYTES (no en puntos) y el alto en puntos, los dos en little-endian.
 *
 * El logo sale del catálogo del cliente, igual que la IP y el color — ver `logo.ts`.
 */
export function logoRaster(logo: LogoRaster): string {
  const { anchoBytes, alto, b64 } = logo;
  const datos = deBase64(b64);

  /**
   * ⚠️ EL CENTRADO SE HACE EN LOS BYTES, NO CON `ESC a 1`. Ese comando centra el TEXTO, y
   * muchas impresoras lo ignoran para las imágenes ráster: el logo salía pegado al margen
   * izquierdo aunque el comando estuviera puesto.
   *
   * La forma que no depende del firmware es mandar la imagen del ancho COMPLETO del papel,
   * con el logo corrido a su lugar y blanco a los lados. El relleno va en bytes enteros, así
   * que el centro puede quedar hasta cuatro puntos corrido — medio milímetro, invisible.
   */
  const relleno = Math.max(0, Math.floor((ANCHO_PAPEL_BYTES - anchoBytes) / 2));
  const anchoFinal = relleno > 0 ? ANCHO_PAPEL_BYTES : anchoBytes;

  let centrado = "";
  if (relleno > 0) {
    const izq = "\x00".repeat(relleno);
    const der = "\x00".repeat(anchoFinal - relleno - anchoBytes);
    for (let y = 0; y < alto; y++) {
      centrado += izq + datos.slice(y * anchoBytes, (y + 1) * anchoBytes) + der;
    }
  } else {
    centrado = datos;
  }

  const cabecera =
    `${GS}v0\x00` +
    String.fromCharCode(
      anchoFinal & 0xff,
      (anchoFinal >> 8) & 0xff,
      alto & 0xff,
      (alto >> 8) & 0xff
    );
  return cabecera + centrado;
}

