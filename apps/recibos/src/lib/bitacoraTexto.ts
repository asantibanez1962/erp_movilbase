/**
 * El papel de la bitácora, en texto plano de 32 columnas.
 *
 * ── POR QUÉ ÉSTE NO ES HTML COMO EL RECIBO ──────────────────────────────────
 *
 * El recibo va al productor: lleva logo y tipografía, y se imprime pasando HTML por el
 * diálogo de Android. Ese camino impone una **página de tamaño fijo** que el driver decide
 * y la app no puede cambiar — se comprobó pidiendo 763 y 940 pt sin ninguna diferencia.
 *
 * La bitácora NO tiene largo fijo: depende de cuántos recibos lleve. Con página fija, una
 * jornada de 30 recibos se parte en un punto arbitrario, y ya vimos lo que hace un corte
 * arbitrario — en el recibo llegó a imprimir "FIRMA" encima de "NOTA:". No hay forma de
 * controlarlo desde acá.
 *
 * Por eso va como el legacy: **texto plano con comandos ESC/POS, directo a la impresora**.
 * Sin páginas, sin diálogo, sin driver. La impresora imprime lo que recibe y se detiene.
 *
 * El costo es la tipografía —fuente interna monoespaciada en vez de Verdana— y acá no
 * importa: **la bitácora es control interno del recibidor**, no el documento del cliente.
 *
 * ── ⚠️ LOS CASTIGOS SÍ SE IMPRIMEN ACÁ ──────────────────────────────────────
 *
 * Y no contradice la regla del recibo. La ley prohíbe imprimir el castigo en **el
 * documento que se entrega al productor**; la bitácora se la queda el recibidor para
 * cuadrar el día. El legacy los imprime, y por eso van.
 *
 * Si alguien ve el recibo sin castigos y "corrige" esto por coherencia, rompe el control
 * del recibidor sin arreglar nada.
 */

/** Comandos ESC/POS, tal como los usa el procedimiento del legacy. */
const ESC = "\x1B";
const GS = "\x1D";
const LF = "\r\n";

const cmd = {
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

/** Ancho útil de la fuente interna a 80 mm. La raya del legacy mide 31. */
const RAYA = "-".repeat(32);

/** Todo lo que el papel de la bitácora necesita, ya resuelto. */
export interface BitacoraImpresa {
  empresa: { nombre: string; direccion1: string; direccion2: string; codigoicafe: string };
  recibidor: string;
  cosecha: string;
  medidor: string;
  transportista: string;
  placa: string;
  /** `dd/MM/yyyy`. */
  fecha: string;
  /** `HH:mm`. */
  horaInicio: string;
  horaFinal: string;
  observaciones: string;
  recibos: ReciboEnBitacora[];
}

export interface ReciboEnBitacora {
  recibo: string;
  codigo: string;
  calidad: string;
  tipoCafe: string;
  productor: string;
  /** Lo que entró, antes de castigos. */
  cantidadinicial: number;
  cuartillosinicial: number;
  /** Los cuatro castigos, ya sumados en cajuelas decimales. */
  castigo: number;
  /** Lo que quedó, en cajuelas y cuartillos enteros. */
  neto: number;
  netoCuartillos: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  granosbrocados: number;
  /** `dd/MM/yyyy HH:mm:ss`. */
  agregado: string;
}

/**
 * Suma los cuatro castigos de un recibo en cajuelas decimales.
 *
 * Es la fórmula del legacy, tal cual: broca, verde, flote maduro y flote seco, cada uno con
 * su parte en cajuelas y su parte en cuartillos. Los cuartillos entran a 0.25 porque cuatro
 * cuartillos hacen una cajuela.
 */
export function castigoTotal(r: {
  broca: number;
  cuartillosbroca: number;
  rebajoverde: number;
  cuartillosrebajoverde: number;
  rebajoflote: number;
  cuartillosrebajoflote: number;
  rebajofloteseco: number;
  cuartillosrebajofloteseco: number;
}): number {
  return (
    r.broca +
    r.cuartillosbroca * 0.25 +
    r.rebajoverde +
    r.cuartillosrebajoverde * 0.25 +
    r.rebajoflote +
    r.cuartillosrebajoflote * 0.25 +
    r.rebajofloteseco +
    r.cuartillosrebajofloteseco * 0.25
  );
}

/**
 * Parte una cantidad decimal en cajuelas y cuartillos enteros, como hace el legacy con
 * `IntegerPart` y `DecimalPart(x)/0.25`.
 */
function partir(cajuelas: number): { enteras: number; cuartillos: number } {
  const enteras = Math.trunc(cajuelas);
  return { enteras, cuartillos: Math.round((cajuelas - enteras) / 0.25) };
}

const par = (v: { enteras: number; cuartillos: number }) => `${v.enteras}/ ${v.cuartillos}`;

/** Arma el texto completo, listo para mandarle los bytes a la impresora. */
export function armarBitacora(j: BitacoraImpresa): string {
  const p: string[] = [];

  // Encabezado: nombre grande y centrado, el resto mediano.
  p.push(`${cmd.medio}${cmd.izquierda}${cmd.negritaOff}${RAYA}${LF}`);
  p.push(cmd.centrado, cmd.grande, cmd.uniOn, cmd.negritaOn);
  p.push(`${j.empresa.nombre}${LF}`);
  p.push(cmd.medio, cmd.uniOff);
  if (j.empresa.direccion1) p.push(`${j.empresa.direccion1}${LF}`);
  if (j.empresa.direccion2) p.push(`${j.empresa.direccion2}${LF}`);
  if (j.empresa.codigoicafe) p.push(`CODIGO ICAFE ${j.empresa.codigoicafe}${LF}`);
  p.push(`${RAYA}${LF}`);
  p.push(`BITACORA DE RECIBIDOR${LF}`);

  // Datos de la bitácora, alineados a la izquierda.
  p.push(`${cmd.izquierda}${cmd.negritaOff}${LF}`);
  p.push(`RECIBIDOR: ${j.recibidor}${LF}`);
  p.push(`COSECHA: ${j.cosecha}${LF}`);
  if (j.medidor) p.push(`MEDIDOR: ${j.medidor}${LF}`);
  if (j.transportista) p.push(`TRANSPORTISTA: ${j.transportista}${LF}`);
  if (j.placa) p.push(`PLACA: ${j.placa}${LF}`);
  p.push(LF);
  p.push(`FECHA: ${j.fecha}${LF}`);
  p.push(`HORA INICIO: ${j.horaInicio}${LF}`);
  p.push(`HORA FINAL: ${j.horaFinal}${LF}`);
  p.push(`${RAYA}${LF}`);

  // Un bloque por recibo, y los acumulados del día.
  let totalCantidad = 0;
  let totalCastigo = 0;
  let totalNeto = 0;

  for (const r of j.recibos) {
    p.push(`${r.recibo} ${r.codigo} CAT:${r.calidad}${LF}`);
    p.push(`${r.tipoCafe}${LF}`);
    p.push(`${r.productor}${LF}`);

    const entro = r.cantidadinicial + r.cuartillosinicial * 0.25;
    p.push(
      `CANTIDAD: ${r.cantidadinicial}/ ${r.cuartillosinicial}` +
        `  CASTIGOS: ${par(partir(r.castigo))}${LF}`
    );
    p.push(`NETO: ${r.neto}/ ${r.netoCuartillos}${LF}`);
    p.push(
      `% V:${r.verdes}, % FM:${r.flotemaduro}, % FS:${r.floteseco},` +
        ` BROCADOS:${r.granosbrocados}${LF}`
    );
    p.push(`${r.agregado}${LF}`);
    p.push(`${RAYA}${LF}`);

    totalCantidad += entro;
    totalCastigo += r.castigo;
    totalNeto += r.neto + r.netoCuartillos * 0.25;
  }

  p.push(`TOTALES:${LF}`);
  p.push(
    `CANTIDAD: ${par(partir(totalCantidad))}` +
      `  CASTIGOS: ${par(partir(totalCastigo))}${LF}`
  );
  p.push(`NETO: ${par(partir(totalNeto))}${LF}${LF}`);

  p.push(`OBSERVACIONES:${LF}`);
  p.push(`${j.observaciones}${LF}`);

  // Las cuatro líneas en blanco son el espacio para firmar; las dos del final, el avance
  // para poder arrancar el papel sin llevarse texto.
  p.push(LF.repeat(4));
  p.push(`${RAYA}${LF}`);
  p.push(`FIRMA${LF}`);
  p.push(LF.repeat(2));
  p.push(cmd.cortar);

  return p.join("");
}
