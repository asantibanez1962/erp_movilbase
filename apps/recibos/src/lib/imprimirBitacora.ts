import { Q, type Model } from "@nozbe/watermelondb";
import { database } from "./db";
import { recibosDe } from "./bitacora";
import { imprimirTexto } from "./impresoraBt";
import { armarBitacora, castigoTotal, type BitacoraImpresa } from "./bitacoraTexto";
import type { Bitacora, Compania, Recibidor, TipoCafe, Transportista } from "../db/models";

/**
 * Reúne los datos de la bitácora y la manda a la impresora.
 *
 * La plantilla vive en `jornadaTexto.ts` y el transporte en `impresoraBt.ts`; acá está sólo
 * de dónde sale cada dato, que es la parte que se puede equivocar en silencio.
 *
 * Los catálogos se resuelven POR NOMBRE. La bitácora guarda códigos —`063` de recibidor,
 * `2` de tipo de café— y el recibidor eligió "RECIBIDOR AMBULANTE (MIRAMAR)" y "DIF O-01".
 * Imprimir el crudo no da ningún error: sale un papel que la persona no reconoce.
 */
export async function imprimirBitacora(bitacora: Bitacora): Promise<void> {
  await imprimirTexto(armarBitacora(await reunirBitacora(bitacora)));
}

async function reunirBitacora(bitacora: Bitacora): Promise<BitacoraImpresa> {
  const uno = async <T extends Model>(tabla: string, col?: string, val?: unknown) => {
    const filas = await database
      .get<T>(tabla)
      .query(...(col == null ? [] : [Q.where(col, val as string)]))
      .fetch();
    return filas[0] ?? null;
  };

  const [empresa, recibidor, transportista, tiposCafe] = await Promise.all([
    uno<Compania>("companias"),
    uno<Recibidor>("recibidores", "recibidor", bitacora.recibidor),
    bitacora.transportista
      ? uno<Transportista>("transportistas", "transportista", bitacora.transportista)
      : Promise.resolve(null),
    database.get<TipoCafe>("tipos_cafe").query().fetch(),
  ]);

  const nombreTipo = (codigo: string | null) => {
    const c = (codigo ?? "").trim();
    return tiposCafe.find((t) => t.tipocafe.trim() === c)?.nombre ?? c;
  };

  // Los recibos del día, en el orden en que se emitieron: es como el recibidor los recuerda
  // y como quedaron en el talonario.
  const recibos = await recibosDe(bitacora.id).fetch();
  recibos.sort((a, b) => (a.recibo ?? "").localeCompare(b.recibo ?? ""));

  return {
    empresa: {
      nombre: empresa?.nombre ?? "",
      direccion1: empresa?.direccion1 ?? "",
      direccion2: empresa?.direccion2 ?? "",
      codigoicafe: empresa?.codigoicafe ?? "",
    },
    recibidor: recibidor?.nombre ?? bitacora.recibidor,
    cosecha: bitacora.cosecha,
    medidor: bitacora.medidor ?? "",
    transportista: transportista?.nombre ?? bitacora.transportista ?? "",
    placa: bitacora.placacamion ?? "",
    fecha: comoFecha(bitacora.fecha),
    horaInicio: comoHora(bitacora.horaInicio),
    // Se imprime la hora de AHORA y no la guardada: `cerrarBitacora` imprime ANTES de
    // marcar `horaFinal`, justamente para que un fallo de la impresora deje la bitácora
    // abierta. O sea que al armar este papel el campo todavía está en null.
    horaFinal: comoHora(Date.now()),
    observaciones: bitacora.observaciones ?? "",
    recibos: recibos.map((r) => ({
      recibo: r.recibo ?? "",
      codigo: (r.codigo ?? "").trim(),
      calidad: (r.calidad ?? "").trim(),
      tipoCafe: nombreTipo(r.tipoCafe),
      productor: r.nombre ?? "",
      cantidadinicial: r.cantidadinicial,
      cuartillosinicial: r.cuartillosinicial,
      castigo: castigoTotal(r),
      // El neto ya viene partido en cajuelas y cuartillos enteros: es el mismo par que la
      // pantalla muestra como TOTAL RECIBO y el que salió impreso en el comprobante.
      neto: r.rcantidad,
      netoCuartillos: r.rcantidadcuartillos,
      verdes: r.verdes,
      flotemaduro: r.flotemaduro,
      floteseco: r.floteseco,
      granosbrocados: r.granosbrocados,
      agregado: comoFechaHora(r.agregado),
    })),
  };
}

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

function comoFecha(ms: number | null | undefined): string {
  if (ms == null) return "";
  const f = new Date(ms);
  return `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${f.getFullYear()}`;
}

function comoHora(ms: number | null | undefined): string {
  if (ms == null) return "";
  const f = new Date(ms);
  return `${dosDigitos(f.getHours())}:${dosDigitos(f.getMinutes())}`;
}

function comoFechaHora(ms: number | null | undefined): string {
  if (ms == null) return "";
  const f = new Date(ms);
  return `${comoFecha(ms)} ${comoHora(ms)}:${dosDigitos(f.getSeconds())}`;
}
