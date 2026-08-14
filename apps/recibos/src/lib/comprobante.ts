import { enLetras, cuartillosEnLetras } from "./enletras";
import { LOGO } from "./logo";

/**
 * El papel del recibo: sólo la plantilla, sin base de datos.
 *
 * Está separado de `imprimir.ts` a propósito. Acá no se importa WatermelonDB ni nada
 * nativo, así que el comprobante se puede generar y mirar fuera del teléfono —comparándolo
 * contra el que sale del web— sin levantar la app ni esperar un build. Un papel que sólo
 * se puede revisar imprimiéndolo se revisa poco.
 *
 * ── ES EL DEL WEB, CALCADO ──────────────────────────────────────────────────
 *
 * Réplica de `vw_rc_recibo_impreso` + `rc_recibo.frx`, que es lo que hoy sale en
 * producción, para que el productor reciba el MISMO documento venga del web o del
 * teléfono: mismo orden de líneas, misma caja de CAFE EN FRUTA, misma nota legal al pie y
 * el mismo logo, extraído del propio .frx (ver `logo.ts`).
 *
 * El procedimiento WinDev del legacy se descartó: difiere en cosas visibles —usa la
 * dirección del productor en vez de provincia/cantón/distrito— y seguirlo habría dado dos
 * papeles distintos para el mismo recibo.
 */
export interface ComprobanteRecibo {
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
  /** `dd/MM/yyyy HH:mm`. */
  agregado: string;
  /** `dd/MM/yyyy HH:mm` — el momento de esta impresión. */
  hoy: string;
  productor: string;
  cedula: string;
  provincia: string;
  canton: string;
  distrito: string;
  /** El precio genérico. `null` cuando no hay ninguno que aplique. */
  precio: number | null;
  recibidor: string;
  tipoCafe: string;
  calidad: string;
  /**
   * Línea completa (`SELLO CLDD`) o vacía, como la arma la vista.
   *
   * ⚠️ EL WEB HOY NO LA IMPRIME, y es un descuido, no una decisión. `vw_rc_recibo_impreso`
   * la prepara desde v1.68/RC/87 —con el comentario explícito de bindear un TextObject con
   * CanShrink— pero el objeto nunca se agregó al `rc_recibo.frx`. En `cldd` la columna
   * aparece sólo en el diccionario de datos del reporte. Son 9.211 recibos de la cosecha
   * 2025-2026 a los que les falta el sello en el papel.
   *
   * Acá SÍ se imprime, en el hueco que el .frx dejó entre CALIDAD y el certificado. Hasta
   * que se agregue el objeto al reporte, los dos papeles difieren en esta línea.
   */
  cldd: string;
  /** Línea completa (`CERTIFICADO: X`) o vacía, como la arma la vista. */
  certificado: string;
  cajuelas: number;
  cuartillos: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  granosbrocados: number;
}

const esc = (s: string | null | undefined) =>
  (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const dec = (v: number | null | undefined, n: number) => (v == null ? "" : v.toFixed(n));

export function armarComprobante(c: ComprobanteRecibo): string {
  // Las dos van después de CALIDAD y antes de CAFE EN FRUTA. Cuando no aplican no ocupan
  // renglón: el .frx deja el objeto vacío, que es el efecto de su CanShrink.
  const sello = c.cldd.trim() === "" ? "" : `<div class="bloque c m">${esc(c.cldd)}</div>`;
  const certificado =
    c.certificado.trim() === "" ? "" : `<div class="bloque">${esc(c.certificado)}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  /* ⚠️ TIPOGRAFÍA DEL WEB, TAL CUAL: Verdana 8.25 pt, con el título a 12 pt en negrita.
     Costó llegar a estos valores contra la impresora y no se tocan sin volver a probar EN
     PAPEL. Android no trae Verdana y el WebView cae a Roboto, que es más angosto: las
     líneas salen algo más cortas que en el web y nada se desborda. Para que fueran
     idénticas habría que empotrar la fuente, y Verdana es de Microsoft. */
  @page { size: 76.2mm auto; margin: 3.81mm 1.78mm 3.81mm 2.03mm; }
  /* ⚠️ EL ANCHO VA FIJO, NO HEREDADO. 76.2 mm de papel menos los márgenes de la página son
     72.39 mm útiles. Sin declararlo, las filas de dos columnas (que son flex, y un flex no
     se encoge por debajo de su contenido) empujan la página más ancha que el papel: todo
     lo centrado se descentra y el rollo corta el borde derecho. Con el ancho puesto, el
     texto largo parte de línea, que es lo que hace un recibo. */
  body { font-family: Verdana, "DejaVu Sans", Tahoma, Geneva, sans-serif;
         font-size: 8.25pt; line-height: 1.45; margin: 0; padding: 0; color: #000;
         width: 72.39mm; overflow-wrap: break-word; }
  .c { text-align: center; }
  .m { font-weight: bold; }
  .titulo { font-size: 12pt; font-weight: bold; text-align: center; margin: 4mm 0 2mm; }
  .estado { font-weight: bold; text-align: center; margin: 1mm 0 2mm; }
  .logo { display: block; margin: 0 auto 1mm; width: 36.6mm; }
  /* Dos columnas: la etiqueta llega hasta los 23 mm, que es donde el .frx pone el valor. */
  .par { display: flex; }
  .par > span:first-child { flex: 0 0 23mm; }
  /* Que el valor pueda partirse en vez de estirar la fila más allá del papel. */
  .par > span:last-child { min-width: 0; }
  .bloque { margin-top: 2mm; }
  /* La caja de CAFE EN FRUTA es lo único con recuadro en todo el comprobante. */
  .caja { border: 1px solid #000; width: 34.3mm; margin: 2mm auto 1mm; text-align: center; }
  .fruta { display: flex; }
  .fruta > .etq { flex: 0 0 20mm; }
  .fruta > .val { flex: 0 0 11mm; }
  /* El blanco sobre la raya es donde firma el productor: no es margen suelto. */
  .firma { margin: 17mm auto 0; width: 58.6mm; border-top: 1px solid #000;
           text-align: center; }
  .nota { margin-top: 3mm; text-align: center; white-space: pre-line; }
</style></head><body>

  <img class="logo" src="${LOGO}" alt="" />
  <div class="estado">${c.copia ? "COPIA" : "ORIGINAL"}</div>

  <div class="c">${esc(c.empresa.nombre)}</div>
  <div class="c">${esc(c.empresa.direccion1)}</div>
  <div class="c">${esc(c.empresa.direccion2)}</div>
  <div class="c">${esc(c.empresa.direccion3)}</div>
  <div class="c">CODIGO ICAFE:${esc(c.empresa.codigoicafe)}</div>
  <div class="c">${esc(c.empresa.telefono)}</div>
  <div class="c">${esc(c.empresa.email)}</div>

  <div class="titulo">RECIBO DE CAFE</div>

  <div>COSECHA: ${esc(c.cosecha)}</div>
  <div>RECIBO:${esc(c.recibo)}</div>
  <div class="par"><span>FECHA:</span><span>${esc(c.fecha)}</span></div>
  <div class="par"><span>AGREGADO:</span><span>${esc(c.agregado)}</span></div>
  <div class="par"><span>IMPRESO:</span><span>${esc(c.hoy)}</span></div>

  <div class="bloque">RECIBIMOS DE:</div>
  <div>${esc(c.productor)}</div>
  <div>CEDULA:${esc(c.cedula)}</div>
  <div>UBICACION: ${esc(c.provincia)}</div>
  <div>${esc(c.canton)}</div>
  <div>${esc(c.distrito)}</div>

  <div class="par bloque"><span>ADELANTO:</span><span>${dec(c.precio, 2)}</span></div>
  <div class="par"><span>RECIBIDOR:</span><span>${esc(c.recibidor)}</span></div>
  <div class="par"><span>TIPO CAFE:</span><span>${esc(c.tipoCafe)}</span></div>
  <div class="par"><span>CALIDAD:</span><span>${esc(c.calidad)}</span></div>
  ${sello}
  ${certificado}

  <div class="caja">CAFE EN FRUTA</div>
  <div class="fruta">
    <span class="etq">CAJUELAS:</span><span class="val">${c.cajuelas}</span>
    <span class="etq">CUARTILLOS:</span><span class="val">${c.cuartillos}</span>
  </div>
  <div class="bloque">${esc(enLetras(c.cajuelas))} CAJUELA(S )</div>
  <div>${esc(cuartillosEnLetras(c.cuartillos))} CUARTILLO(S)</div>

  <!-- ⚠️ SÓLO LOS PORCENTAJES. Los castigos en cajuelas que estos porcentajes producen NO
       se imprimen: es por ley. La app los calcula y los guarda con el recibo, así que
       agregarlos acá "ya que están a mano" es justo el cambio que no se puede hacer. -->
  <div class="bloque">AJUSTES:</div>
  <div class="par"><span>VERDE:</span><span>${dec(c.verdes, 2)} %</span></div>
  <div class="par"><span>FLOTE M.:</span><span>${dec(c.flotemaduro, 2)} %</span></div>
  <div class="par"><span>FLOTE S:</span><span>${dec(c.floteseco, 2)} %</span></div>
  <div class="par"><span>BROCA:</span><span>${c.granosbrocados} (granos)</span></div>

  <div class="firma">FIRMA</div>

  <div class="nota">NOTA: ESTE RECIBO NO ES NEGOCIBLE Y
DEBE CONSERVARLO EL PRODUCTOR PARA
HACER VALER SUS DERECHOS EN LA
LIQUIDACION DEFINITIVA.

EL PRECIO DE ESTE CAFE SERA CONFORME
CON LAS LEYES VIGENTES.

CUIDE ESTE RECBO, NO SE ATENDERAN
RECLAMOS POR PERDIDA.</div>

</body></html>`;
}
