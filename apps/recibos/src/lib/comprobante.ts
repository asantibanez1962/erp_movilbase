import { enLetras, cuartillosEnLetras } from "./enletras";
import { ESTILO_PAPEL } from "./papel";

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
  /**
   * El logo como data URI, o vacío si el cliente no tiene uno definido.
   *
   * ⚠️ VIENE COMO DATO Y NO SE IMPORTA ACÁ A PROPÓSITO. Elegir el logo del cliente
   * obliga a leer el branding, que arrastra los PNG de la interfaz — y con eso esta
   * plantilla dejaría de poder generarse fuera del teléfono, que es lo que permite
   * revisar el papel sin gastar rollo.
   */
  logo: string;
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
  /**
   * ⚠️ NO SE IMPRIMEN, y es una decisión, no un olvido. El .frx del web saca tres fechas
   * —FECHA, AGREGADO (cuándo se digitó) e IMPRESO (cuándo salió el papel)— pero en el móvil
   * los dos renglones extra costaban 7 mm de los 57 que hubo que recortar para que el
   * comprobante entrara en la página de 210 mm del driver. Se guardan igual con el recibo.
   *
   * El costo: una COPIA ya no dice cuándo se emitió. Lo compensa el "COPIA" del encabezado,
   * que sí distingue el original de las reimpresiones.
   */
  agregado: string;
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
  // Una línea vacía igual ocupa renglón, y con el papel contado eso es desperdicio puro.
  // Pasa de verdad: hay ~780 productores sin geografía, y su UBICACION son tres blancos.
  const linea = (texto: string, clase = "") =>
    texto.trim() === "" ? "" : `<div${clase ? ` class="${clase}"` : ""}>${esc(texto)}</div>`;

  // ⚠️ LA UBICACION VA EN UNA LÍNEA, no en tres como el .frx. Es la misma información
  // —provincia, cantón y distrito— y ahorra dos renglones de los que hay que recortar para
  // que el comprobante entre en la página de 210 mm que impone el driver.
  const ubicacion = [c.provincia, c.canton, c.distrito]
    .map((x) => x.trim())
    .filter((x) => x !== "")
    .join(" · ");

  const sello = c.cldd.trim() === "" ? "" : `<div class="bloque c m">${esc(c.cldd)}</div>`;
  const certificado =
    c.certificado.trim() === "" ? "" : `<div class="bloque">${esc(c.certificado)}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${ESTILO_PAPEL}
  /* La fila de cajuelas y cuartillos va lado a lado SOLO en el recibo; en la remedida el
     .frx los pone en renglones separados. */
  .fruta { display: flex; }
  .fruta > .etq { flex: 0 0 20mm; }
  .fruta > .val { flex: 0 0 11mm; }
  .firma { margin: calc(8mm + 2.64em) auto 0; width: 58.6mm; border-top: 1px solid #000;
           text-align: center; }
  /* Y el de abajo separa la firma de la nota legal. En pantalla 3 mm parecían
     suficientes; impreso, "FIRMA" y "NOTA:" quedaban pegados y se leían como un bloque.
     El margen izquierdo NEGATIVO le devuelve a la nota un carácter (1.75 mm a 8.25 pt):
     es el bloque más ancho del comprobante y el sangrado que ayuda a leer los datos, acá
     sólo le aprieta las líneas. Va al revés que el resto a propósito. */
  .nota { margin: 5mm 0 0 -1.75mm; text-align: center; line-height: 1.1; }
  .nota p { margin: 0 0 2mm; white-space: pre-line; }
  .nota p:last-child { margin-bottom: 0; }
  /* ⚠️ RED DE SEGURIDAD. El comprobante entra en la página de 210 mm con unos milímetros
     de sobra, pero un nombre de productor largo puede partir en dos líneas y empujarlo.
     Si eso pasa, que la nota legal se vaya ENTERA a la página siguiente en vez de cortarse
     por la mitad: un párrafo legal partido a mitad de frase es peor que una hoja de más.
     Es exactamente lo que pasaba antes con FIRMA impreso encima de NOTA. */
  .nota, .firma { break-inside: avoid; page-break-inside: avoid; }
</style></head><body>

  ${c.logo ? `<img class="logo" src="${c.logo}" alt="" />` : ""}
  <div class="estado">${c.copia ? "COPIA" : "ORIGINAL"}</div>

  ${linea(c.empresa.nombre, "c")}
  ${linea(c.empresa.direccion1, "c")}
  ${linea(c.empresa.direccion2, "c")}
  ${linea(c.empresa.direccion3, "c")}
  ${linea(`CODIGO ICAFE:${c.empresa.codigoicafe}`, "c")}
  ${linea(c.empresa.telefono, "c")}
  ${linea(c.empresa.email, "c")}

  <div class="titulo">RECIBO DE CAFE</div>

  <div>COSECHA: ${esc(c.cosecha)}</div>
  <div>RECIBO:${esc(c.recibo)}</div>
  <div class="par"><span>FECHA:</span><span>${esc(c.fecha)}</span></div>

  <div class="bloque">RECIBIMOS DE:</div>
  <div>${esc(c.productor)}</div>
  <div>CEDULA:${esc(c.cedula)}</div>
  ${linea(`UBICACION: ${ubicacion}`)}

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
  <div>${esc(enLetras(c.cajuelas))} CAJUELA(S )</div>
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

  <div class="nota"><p>NOTA: ESTE RECIBO NO ES NEGOCIBLE Y
DEBE CONSERVARLO EL PRODUCTOR PARA
HACER VALER SUS DERECHOS EN LA
LIQUIDACION DEFINITIVA.</p><p>EL PRECIO DE ESTE CAFE SERA CONFORME
CON LAS LEYES VIGENTES.</p><p>CUIDE ESTE RECIBO, NO SE ATENDERAN
RECLAMOS POR PERDIDA.</p></div>

</body></html>`;
}
