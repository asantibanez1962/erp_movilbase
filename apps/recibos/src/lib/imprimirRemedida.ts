import { Q, type Model } from "@nozbe/watermelondb";
import * as Print from "expo-print";
import { modoImpresion } from "./modoImpresion";
import { imprimirTexto } from "./impresoraBt";
import { armarRemedida } from "./remedidaTexto";
import { database } from "./db";
import { LOGO, LOGO_ESCPOS } from "./logo";
import { rutasDe, partir } from "./remedida";
import {
  armarComprobanteRemedida,
  type ComprobanteRemedida,
} from "./comprobanteRemedida";
import type {
  Calidad,
  Compania,
  Cosecha,
  Recibidor,
  Remedida,
  TipoCafe,
  Transportista,
} from "../db/models";

/**
 * Impresión del RECIBO DE TRANSPORTE: reunir los datos y mandarlo a la impresora.
 *
 * Va por el mismo camino que el recibo —HTML → diálogo de Android → ESCprint— y no por el
 * socket directo de la bitácora. Es documento del transportista, así que conserva logo y
 * tipografía; y aunque su largo varía con la lista de recibidores, el peor caso real
 * (15 recibidores) mide 198 mm contra los 210 de la página, así que no se parte.
 */

/**
 * Mismo tamaño que el recibo, y por la misma razón: es una SUGERENCIA que el diálogo puede
 * pisar, pero omitir el alto hace que `printAsync` use 792 pt —el de una hoja Carta— y eso
 * sí cambia el resultado. Ver la nota larga en `imprimir.ts`.
 */
const PAGINA = { width: 226, height: 940 };

export async function imprimirRemedida(remedida: Remedida): Promise<void> {
  const datos = await reunirDatos(remedida);

  // Los dos caminos parten de los MISMOS datos: lo único que cambia es cómo se dibujan. Si
  // alguna vez difieren en el contenido, el papel dependería de qué teléfono lo emitió.
  if (modoImpresion() === "directo") {
    await imprimirTexto(
      armarRemedida({
        ...datos,
        logo: LOGO_ESCPOS,
        copia: (remedida.impreso ?? 0) > 0,
        medidor: remedida.medidor ?? "",
      })
    );
    return;
  }

  await Print.printAsync({ html: armarComprobanteRemedida(datos), ...PAGINA });
}

async function reunirDatos(remedida: Remedida): Promise<ComprobanteRemedida> {
  const uno = async <T extends Model>(tabla: string, col?: string, val?: unknown) => {
    const filas = await database
      .get<T>(tabla)
      .query(...(col == null ? [] : [Q.where(col, val as string)]))
      .fetch();
    return filas[0] ?? null;
  };

  const [empresa, cosecha, tipoCafe, calidad, transportista, rutas, recibidores] =
    await Promise.all([
      uno<Compania>("companias"),
      uno<Cosecha>("cosechas", "cosecha", remedida.cosecha),
      uno<TipoCafe>("tipos_cafe", "tipocafe", remedida.tipocafe ?? ""),
      uno<Calidad>("calidades", "calidad", remedida.calidad ?? ""),
      // ⚠️ La remedida guarda el transportista como NÚMERO y el catálogo lo indexa como
      // texto. Los códigos van sin relleno —1, 23, 28— así que `String()` alcanza; con
      // ceros a la izquierda habría que igualar el formato antes de comparar.
      remedida.transportista == null
        ? Promise.resolve(null)
        : uno<Transportista>(
            "transportistas",
            "transportista",
            String(remedida.transportista)
          ),
      rutasDe(remedida.id).fetch(),
      database.get<Recibidor>("recibidores").query().fetch(),
    ]);

  // La ruta se imprime POR NOMBRE. La tabla guarda códigos de tres dígitos, y el
  // transportista tiene que reconocer los sitios por los que pasa, no descifrarlos.
  const nombreRecibidor = (codigo: string) =>
    recibidores.find((r) => r.recibidor.trim() === codigo.trim())?.nombre ?? codigo;

  const { cajuelas, cuartillos } = partir(remedida.cantidad);

  return {
    logo: LOGO,
    empresa: {
      nombre: empresa?.nombre ?? "",
      direccion1: empresa?.direccion1 ?? "",
      direccion2: empresa?.direccion2 ?? "",
      direccion3: empresa?.direccion3 ?? "",
      codigoicafe: empresa?.codigoicafe ?? "",
      telefono: empresa?.telefono ?? "",
      email: empresa?.email ?? "",
    },
    cosecha: cosecha?.descripcion ?? remedida.cosecha,
    recibo: remedida.recibo ?? "",
    fecha: comoFecha(remedida.fecha),
    medidor: remedida.medidor ?? "",
    // ⚠️ VACÍOS A PROPÓSITO — el móvil no captura llegada ni salida, y copiarlas del
    // servidor sería peor: allá 2 009 de 2 012 remedidas tienen `llegada` en NULL, y
    // `salida` guarda el momento en que se grabó la fila, no la hora del camión. Ver la
    // nota en `comprobanteRemedida.ts`. Vacías, la plantilla omite el renglón.
    llegada: "",
    salida: "",
    transportista: transportista?.nombre ?? String(remedida.transportista ?? ""),
    placa: remedida.placa ?? "",
    tipoCafe: tipoCafe?.nombre ?? remedida.tipocafe ?? "",
    calidad: calidad?.nombre ?? remedida.calidad ?? "",
    cajuelas,
    cuartillos,
    verdes: remedida.verdes,
    flotemaduro: remedida.flotemaduro,
    floteseco: remedida.floteseco,
    granosbrocados: remedida.granosbrocados,
    recibidores: rutas.map((r) => nombreRecibidor(r.recibidor)),
    observaciones: remedida.observaciones ?? "",
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
