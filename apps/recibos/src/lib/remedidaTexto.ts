import { enLetras, cuartillosEnLetras } from "./enletras";
import { LF, RAYA, cmd, logoRaster, type LogoRaster } from "./escpos";

/**
 * El RECIBO DE TRANSPORTE en ESC/POS, para imprimir sin el driver.
 *
 * ── POR QUÉ EXISTEN DOS VERSIONES DEL MISMO PAPEL ───────────────────────────
 *
 * La otra —`comprobanteRemedida.ts`— va como HTML por el diálogo de Android y conserva la
 * tipografía del web. Pero exige que el teléfono tenga instalado y configurado **ESCprint
 * Service**, y no todos los usuarios pueden o quieren hacerlo. Ésta no necesita nada: abre
 * el socket y escribe.
 *
 * Y de paso gana algo que no es menor: **sin diálogo son un toque por remedida en vez de
 * cuatro**. En un sitio que emite decenas al día, eso pesa más que la tipografía.
 *
 * Lo que se pierde es la fuente proporcional. **El logo NO se pierde**: va como ráster,
 * igual que en la bitácora.
 *
 * Cuál se usa lo decide un parámetro por teléfono — ver `lib/modoImpresion.ts`.
 *
 * ── ES EL PROCEDIMIENTO DEL LEGACY, CALCADO ─────────────────────────────────
 *
 * Mismos comandos, mismo orden, mismas rayas. Seguirlo al pie ya rindió antes: de ahí
 * salieron el troceado en bloques y las reglas de cierre. Tres cosas que trae y el `.frx`
 * del web no:
 *
 *  - **ORIGINAL / COPIA**, que el .frx de la remedida no imprime aunque el del recibo sí.
 *  - **"HECHO POR <usuario>"** al pie, junto a la firma.
 *  - El **bruto** (`cantidadinicial`), no el neto.
 */
export interface RemedidaImpresa {
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
  transportista: string;
  placa: string;
  tipoCafe: string;
  calidad: string;
  cajuelas: number;
  cuartillos: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  granosbrocados: number;
  recibidores: string[];
  observaciones: string;
  /** Quién la hizo. El legacy lo imprime al pie, bajo la firma. */
  medidor: string;
}

/** `NumToString(x, "3.2")` del legacy: dos decimales. */
const dec = (v: number) => v.toFixed(2);

export function armarRemedida(r: RemedidaImpresa): string {
  const p: string[] = [];

  if (r.logo) p.push(`${cmd.centrado}${logoRaster(r.logo)}${LF}`);

  // Encabezado: la empresa en grande, el resto mediano. Idéntico al del legacy.
  p.push(`${cmd.medio}${cmd.izquierda}${cmd.negritaOff}${LF}`);
  p.push(`${cmd.centrado}${RAYA}${LF}`);
  p.push(cmd.grande, cmd.uniOn, cmd.negritaOn);
  p.push(`${r.empresa.nombre}${LF}`);
  p.push(cmd.medio, cmd.uniOff);
  p.push(`${r.empresa.direccion1}${LF}`);
  p.push(`${r.empresa.direccion2}${LF}`);
  // El legacy sólo imprime la tercera si tiene contenido; las otras dos van siempre.
  if (r.empresa.direccion3) p.push(`${r.empresa.direccion3}${LF}`);
  p.push(`CODIGO ICAFE ${r.empresa.codigoicafe}${LF}`);
  p.push(`${r.empresa.telefono}${LF}`);
  p.push(`${r.empresa.email}${LF}`);
  p.push(`${RAYA}${LF}`);

  p.push(`RECIBO DE TRANSPORTE${LF}`);
  p.push(`COSECHA:${r.cosecha}${LF}`);
  p.push(`No. ${r.recibo}${LF}`);
  p.push(`FECHA:${r.fecha}${LF}`);

  // ORIGINAL o COPIA, en grande y centrado.
  p.push(`${cmd.grande}${cmd.centrado}${LF}`);
  p.push(`${r.copia ? "COPIA" : "ORIGINAL"}${LF}`);
  p.push(`${cmd.medio}${cmd.izquierda}${LF}${LF}`);

  // ⚠️ Esta raya es MÁS LARGA que las demás en el legacy (42 caracteres contra 30). Se
  // respeta: en la fuente interna a 80 mm entra, y el papel del transportista quedó así
  // durante años.
  p.push(`${"-".repeat(42)}${LF}`);

  p.push(`TRANSPORTISTA:${LF}`);
  p.push(`${r.transportista}${LF}`);
  p.push(`PLACA:${r.placa}${LF}${LF}`);

  // Tipo de café y calidad, en grande y centrado.
  p.push(`${LF}${cmd.grande}${cmd.centrado}${cmd.negritaOn}${LF}`);
  p.push(`${r.tipoCafe}${LF}`);
  p.push(`${r.calidad}${LF}`);
  p.push(`${cmd.medio}${cmd.izquierda}${cmd.negritaOff}${LF}`);

  p.push(`${RAYA}${LF}`);
  p.push(`CAFE EN FRUTA:${LF}`);
  p.push(`${RAYA}${LF}`);
  // Las cantidades en grande, con la etiqueta en tamaño normal. Los puntos de "CAJUELAS:.."
  // están en el legacy tal cual.
  p.push(`CAJUELAS:..${cmd.grande}${r.cajuelas}${cmd.medio}${cmd.negritaOff}${LF}`);
  p.push(`CUARTILLOS: ${cmd.grande}${r.cuartillos}${cmd.medio}${cmd.negritaOff}${LF}${LF}`);

  p.push(`${cmd.negritaOff}${enLetras(r.cajuelas)} CAJUELA(S)${LF}`);
  p.push(`Y ${cuartillosEnLetras(r.cuartillos)} CUARTILLO(S)${LF}${LF}`);

  // Los porcentajes van sangrados diez espacios, como en el legacy.
  p.push(`          VERDE:     ${dec(r.verdes)}%   ${LF}`);
  p.push(`          FLOTE M:   ${dec(r.flotemaduro)}%   ${LF}`);
  p.push(`          FLOTE S:   ${dec(r.floteseco)}%   ${LF}`);
  p.push(`          BROCA:${r.granosbrocados} (GRANOS) ${LF}${LF}`);

  p.push(`RECIBIDORES:${LF}${LF}`);
  for (const nombre of r.recibidores) p.push(`${nombre}${LF}`);
  p.push(LF);

  p.push(`OBSERVACIONES:${LF}`);
  p.push(`${r.observaciones}${LF}`);
  p.push(LF.repeat(4));

  p.push(`${"-".repeat(31)}${LF}`);
  p.push(`FIRMA${LF}${LF}`);
  p.push(`HECHO POR ${r.medidor}${LF}`);
  p.push(LF.repeat(4));

  // ⚠️ El legacy manda acá `ESC V 66 0`, no `GS V 0`. `ESC V` es rotación 90°, no corte —
  // parece un error de tipeo que quedó y es inocuo en una impresora sin cuchilla. Se manda
  // el corte de verdad, que también es inocuo, y el avance lo dan las líneas en blanco.
  p.push(cmd.cortar);
  p.push(LF.repeat(3));

  return p.join("");
}
