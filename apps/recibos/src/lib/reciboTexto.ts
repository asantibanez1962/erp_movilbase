import { enLetras, cuartillosEnLetras } from "./enletras";
import { LF, RAYA, cmd, logoRaster, type LogoRaster } from "./escpos";

/**
 * El COMPROBANTE DE RECIBO DE CAFE en ESC/POS, para imprimir sin el driver.
 *
 * La otra versión —`comprobante.ts`— va como HTML por el diálogo y conserva la tipografía
 * del web. Cuál se usa lo decide el parámetro del teléfono; ver `modoImpresion.ts`.
 *
 * ── ⚠️ DIFERENCIAS DE FONDO CON EL PAPEL DEL WEB ────────────────────────────
 *
 * No son de estilo: el legacy y el `.frx` dicen cosas distintas, y hubo que elegir.
 *
 * **1. El título dice "COMPROBANTE DE RECIBO DE CAFE"**, no "RECIBO DE CAFE".
 *
 * **2. No lleva la nota legal.** El `.frx` cierra con los tres párrafos de "ESTE RECIBO NO
 * ES NEGOCIABLE…"; el legacy no imprime ninguno. Se respeta el legacy, pero conviene
 * revisarlo: si esa nota es obligatoria, falta en todos los recibos que el legacy imprimió.
 *
 * Y una que sí se corrigió: el legacy imprime `UBICACION:` con la DIRECCIÓN del productor.
 * Acá va provincia · cantón · distrito, igual que el web, que es la estructura nueva de
 * `ge_Socio` y no un texto libre. Ver la nota en `imprimir.ts`.
 */
export interface ReciboTexto {
  /** Ver la nota en `ComprobanteRecibo.logo`: viene como dato, no se importa acá. */
  logo: LogoRaster | null;
  /** ORIGINAL la primera vez, COPIA de ahí en adelante. */
  copia: boolean;
  empresa: {
    nombre: string;
    direccion1: string;
    direccion2: string;
    direccion3: string;
    codigoicafe: string;
    telefono: string;
    email: string;
  };
  cosecha: string;
  recibo: string;
  /** `dd/MM/yyyy`. */
  fecha: string;
  codigo: string;
  productor: string;
  cedula: string;
  ubicacion: string;
  /** La ubicación de la finca, cuando el recibo lleva una. */
  finca: string;
  /** El precio POR FANEGA. `null` cuando no hay ninguno que aplique. */
  adelanto: number | null;
  recibidor: string;
  tipoCafe: string;
  /** `SELLO: CLDD` o vacío. */
  cldd: string;
  /** Nombre del certificado, o vacío. */
  certificado: string;
  calidad: string;
  cajuelas: number;
  cuartillos: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  granosbrocados: number;
  medidor: string;
  /** `dd/MM/yyyy HH:mm:ss`. */
  agregado: string;
}

const dec = (v: number) => v.toFixed(2);

/** `NumToString(x, "10.2fS")` del legacy: dos decimales con separador de miles. */
const colones = (v: number | null) =>
  v == null ? "0.00" : v.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function armarReciboTexto(r: ReciboTexto): string {
  const p: string[] = [];

  // ⚠️ `ESC @` reinicia la impresora y `ESC t 0` fija la tabla de caracteres. El legacy los
  // manda sólo en el recibo, pero valen para todos: sin reiniciar, la impresora arrastra el
  // estado del documento anterior —negrita, tamaño, alineación— y el papel sale distinto
  // según qué se imprimió antes.
  p.push(cmd.reiniciar);

  if (r.logo) p.push(`${cmd.centrado}${logoRaster(r.logo)}${LF}`);

  p.push(`${cmd.medio}${cmd.izquierda}${cmd.negritaOff}${LF}`);
  p.push(`${cmd.centrado}${RAYA}${LF}`);
  p.push(cmd.grande, cmd.uniOn, cmd.negritaOn);
  p.push(`${r.empresa.nombre}${LF}`);
  p.push(cmd.medio, cmd.uniOff);
  p.push(`${r.empresa.direccion1}${LF}`);
  p.push(`${r.empresa.direccion2}${LF}`);
  if (r.empresa.direccion3) p.push(`${r.empresa.direccion3}${LF}`);
  p.push(`CODIGO ICAFE ${r.empresa.codigoicafe}${LF}`);
  p.push(`${r.empresa.telefono}${LF}`);
  p.push(`${r.empresa.email}${LF}`);
  p.push(`${RAYA}${LF}`);

  p.push(`COMPROBANTE DE RECIBO DE CAFE${LF}`);
  p.push(`COSECHA:${r.cosecha}${LF}`);
  p.push(`No. ${r.recibo}${LF}`);
  p.push(`FECHA:${r.fecha}${LF}`);

  p.push(`${cmd.grande}${cmd.centrado}${LF}`);
  p.push(`${r.copia ? "COPIA" : "ORIGINAL"}${LF}`);
  p.push(`${cmd.medio}${cmd.izquierda}${LF}${LF}`);
  p.push(`${"-".repeat(42)}${LF}`);

  // El código va sangrado diez espacios y el nombre en negrita, como en el legacy.
  p.push(`          ${r.codigo}${LF}`);
  p.push(`${cmd.negritaOn}${r.productor}${LF}${cmd.negritaOff}`);
  p.push(`CEDULA:${r.cedula}${LF}`);
  p.push(`UBICACION:${r.ubicacion}${LF}`);
  if (r.finca) p.push(`${r.finca}${LF}`);

  p.push(`ADELANTO:${colones(r.adelanto)}${LF}`);
  p.push(`${"-".repeat(42)}${LF}`);

  p.push(`RECIBIDOR:${r.recibidor}${LF}`);
  // Tipo de café, sello, certificado y calidad: en grande y centrado.
  p.push(`${cmd.grande}${cmd.centrado}${cmd.negritaOn}${LF}`);
  p.push(`${r.tipoCafe}${LF}`);
  if (r.cldd) p.push(`${cmd.grande}${r.cldd}${cmd.medio}${cmd.izquierda}${LF}${cmd.centrado}${cmd.grande}`);
  if (r.certificado) p.push(`${r.certificado}${LF}`);
  p.push(`${r.calidad}${LF}`);
  p.push(`${cmd.medio}${cmd.izquierda}${cmd.negritaOff}`);

  p.push(`${RAYA}${LF}`);
  p.push(`CAFE EN FRUTA:${LF}`);
  p.push(`${RAYA}${LF}`);
  p.push(`CAJUELAS:..${cmd.grande}${r.cajuelas}${cmd.medio}${cmd.negritaOff}${LF}`);
  p.push(`CUARTILLOS: ${cmd.grande}${r.cuartillos}${cmd.medio}${cmd.negritaOff}${LF}${LF}`);

  p.push(`${cmd.negritaOff}${enLetras(r.cajuelas)} CAJUELA(S)${LF}`);
  p.push(`Y ${cuartillosEnLetras(r.cuartillos)} CUARTILLO(S)${LF}${LF}`);

  // ⚠️ SÓLO LOS PORCENTAJES, nunca los castigos que producen: es por ley, y vale igual acá
  // que en la versión con driver. Los comentarios del legacy muestran las líneas de rebajo
  // escritas y después comentadas — alguien las puso y las tuvo que sacar.
  p.push(`          AJUSTES:${LF}`);
  p.push(`          VERDE:     ${dec(r.verdes)}%   ${LF}`);
  p.push(`          FLOTE M:   ${dec(r.flotemaduro)}%   ${LF}`);
  p.push(`          FLOTE S:   ${dec(r.floteseco)}%   ${LF}`);
  p.push(`          BROCA:${r.granosbrocados} (GRANOS) ${LF}`);
  p.push(LF.repeat(4));

  p.push(`${"-".repeat(31)}${LF}`);
  p.push(`FIRMA${LF}${LF}`);
  p.push(`HECHO POR ${r.medidor}${LF}`);
  p.push(`${r.agregado}${LF}`);
  p.push(LF.repeat(4));

  p.push(cmd.cortar);
  p.push(LF.repeat(3));

  return p.join("");
}
