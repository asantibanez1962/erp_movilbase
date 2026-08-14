import { enLetras, cuartillosEnLetras } from "./enletras";
import { ESTILO_PAPEL } from "./papel";

/**
 * El papel de la remedida: el **RECIBO DE TRANSPORTE**.
 *
 * Réplica de `vw_rc_remedida_impreso` + `rc_remedida.frx`, igual que se hizo con el recibo,
 * para que el transportista reciba el mismo documento venga del web o del teléfono. Comparte
 * tipografía y márgenes con el recibo a través de `papel.ts`.
 *
 * Es más corto que el recibo: no lleva firma ni la nota legal. Pero **no es de largo fijo**,
 * y ahí está la trampa: la lista de RECIBIDORES sale de las rutas y va de 1 a 15 en los
 * datos reales de la cosecha. Son hasta 14 renglones de diferencia sobre una página que el
 * driver fija en 210 mm, así que el margen hay que medirlo, no suponerlo.
 *
 * ── LO QUE NO SE IMPRIME, Y POR QUÉ ─────────────────────────────────────────
 *
 * El .frx tiene `Llegada:` y `Salida:`. Acá salen sólo si traen valor, y en el móvil hoy
 * nunca lo traen: no se capturan.
 *
 * ⚠️ Y NO ES UNA CARENCIA DEL MÓVIL. En el servidor, 2 009 de las 2 012 remedidas de la
 * cosecha tienen `llegada` en NULL. `salida` sí está llena casi siempre, pero con valores
 * que no son la hora de salida del camión: una remedida del 20-mar tiene salida el 8-abr —
 * es el momento en que alguien guardó la fila. Copiar ese campo pondría una fecha
 * equivocada en el papel del transportista, que es peor que no ponerla.
 *
 * `angarilla` tampoco se imprime: la vista lo expone pero el .frx no lo bindea.
 */
export interface ComprobanteRemedida {
  /**
   * El logo como data URI, o vacío si el cliente no tiene uno definido.
   *
   * ⚠️ VIENE COMO DATO Y NO SE IMPORTA ACÁ A PROPÓSITO. Elegir el logo del cliente
   * obliga a leer el branding, que arrastra los PNG de la interfaz — y con eso esta
   * plantilla dejaría de poder generarse fuera del teléfono, que es lo que permite
   * revisar el papel sin gastar rollo.
   */
  logo: string;
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
  /** El número: sifón de 3 dígitos + consecutivo de 6. */
  recibo: string;
  /** `dd/MM/yyyy`. */
  fecha: string;
  medidor: string;
  /** `dd/MM/yyyy HH:mm`, o vacío. Hoy el móvil no los captura. */
  llegada: string;
  salida: string;
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
  /** Los recibidores de la ruta, uno por renglón. De 1 a 15. */
  recibidores: string[];
  observaciones: string;
}

const esc = (s: string | null | undefined) =>
  (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const dec = (v: number | null | undefined, n: number) => (v == null ? "" : v.toFixed(n));

export function armarComprobanteRemedida(c: ComprobanteRemedida): string {
  // Una línea vacía igual ocupa renglón, y con el papel contado eso es desperdicio.
  const linea = (texto: string, clase = "") =>
    texto.trim() === "" ? "" : `<div${clase ? ` class="${clase}"` : ""}>${esc(texto)}</div>`;

  const par = (etiqueta: string, valor: string) =>
    valor.trim() === ""
      ? ""
      : `<div class="par"><span>${etiqueta}</span><span>${esc(valor)}</span></div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${ESTILO_PAPEL}
  /* La lista de recibidores es lo único que crece acá, así que se mantiene junta: partirla
     entre dos páginas dejaría media ruta en cada mitad. */
  .ruta { break-inside: avoid; page-break-inside: avoid; }
</style></head><body>

  ${c.logo ? `<img class="logo" src="${c.logo}" alt="" />` : ""}

  ${linea(c.empresa.nombre, "c")}
  ${linea(c.empresa.direccion1, "c")}
  ${linea(c.empresa.direccion2, "c")}
  ${linea(c.empresa.direccion3, "c")}
  ${linea(`CODIGO ICAFE:${c.empresa.codigoicafe}`, "c")}
  ${linea(c.empresa.telefono, "c")}
  ${linea(c.empresa.email, "c")}

  <div class="titulo">RECIBO DE TRANSPORTE</div>

  <div>COSECHA: ${esc(c.cosecha)}</div>
  ${par("No.:", c.recibo)}
  ${par("Fecha:", c.fecha)}
  ${par("Medidor:", c.medidor)}
  ${par("Llegada:", c.llegada)}
  ${par("Salida:", c.salida)}
  ${par("Transportista:", c.transportista)}
  ${par("Placa:", c.placa)}

  <div class="bloque">${esc(c.tipoCafe)}</div>
  <div>${esc(c.calidad)}</div>

  <div class="caja">CAFE EN FRUTA</div>
  <!-- ⚠️ En una línea cada uno, no lado a lado como en el recibo: así lo pone el .frx de
       la remedida, y el papel del transportista se lee de un vistazo. -->
  <div class="par"><span>CAJUELAS:</span><span>${c.cajuelas}</span></div>
  <div class="par"><span>CUARTILLOS:</span><span>${c.cuartillos}</span></div>
  <div class="bloque">${esc(enLetras(c.cajuelas))} CAJUELA(S )</div>
  <div>${esc(cuartillosEnLetras(c.cuartillos))} CUARTILLO(S)</div>

  <!-- Sin encabezado "AJUSTES:" — el .frx de la remedida no lo lleva. Y como en el recibo,
       van los PORCENTAJES y nunca los castigos que producen. -->
  <div class="par bloque"><span>VERDE:</span><span>${dec(c.verdes, 2)} %</span></div>
  <div class="par"><span>FLOTE M.:</span><span>${dec(c.flotemaduro, 2)} %</span></div>
  <div class="par"><span>FLOTE S:</span><span>${dec(c.floteseco, 2)} %</span></div>
  <div class="par"><span>BROCA:</span><span>${c.granosbrocados} (granos)</span></div>

  <div class="ruta">
    <div class="bloque">RECIBIDORES:</div>
    ${c.recibidores.map((r) => `<div>${esc(r)}</div>`).join("\n    ")}
  </div>

  ${c.observaciones.trim() === "" ? "" : `<div class="bloque">OBSERVACIONES:</div>
  <div>${esc(c.observaciones)}</div>`}

</body></html>`;
}
