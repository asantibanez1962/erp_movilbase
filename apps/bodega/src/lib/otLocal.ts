import * as FileSystem from "expo-file-system/legacy";

/**
 * Las OT abiertas guardadas en el aparato.
 *
 * Mismo razonamiento que la toma física: el operario baja las OT, va marcando
 * en el piso —donde puede no haber wifi— y manda cuando vuelve a tener señal.
 * Un archivo JSON por bodega alcanza; no hay deltas ni sincronización
 * incremental que justifiquen una base local.
 *
 * A DIFERENCIA DE LA TOMA FISICA, el archivo NO lleva fecha en el nombre. La
 * toma es de un día; las OT abiertas son las que hay, y una que quedó abierta
 * de la semana pasada se sigue trabajando hoy.
 */

export interface OtLocal {
  /** IdMovimiento. */
  id: number;
  documento: string;
  fecha: string;
  socio: string;
  estado: number;
  avance: number;
  horaInicio: string | null;
  horaFin: string | null;
  notas: string;
  /**
   * El sello del servidor cuando se bajó. Viaja de vuelta al enviar para que
   * el servidor detecte si otro operario tocó la OT en el medio. Sin esto, el
   * último en enviar pisaría al otro sin que nadie se entere.
   */
  actualizadoAt: string | null;
}

export interface CambioOt {
  estado: number;
  avance: number;
  horaInicio: string | null;
  horaFin: string | null;
  notas: string;
}

export interface OtsLocales {
  idBodega: number;
  bajadaAt: string;
  ots: OtLocal[];
  /** Lo tocado y todavía no enviado, por id de OT. */
  cambios: Record<string, CambioOt>;
}

const CARPETA = `${FileSystem.documentDirectory}ot/`;

const archivo = (idBodega: number) => `${CARPETA}b${idBodega}.json`;

async function asegurarCarpeta() {
  const info = await FileSystem.getInfoAsync(CARPETA);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CARPETA, { intermediates: true });
}

export async function guardarOts(datos: OtsLocales): Promise<void> {
  await asegurarCarpeta();
  await FileSystem.writeAsStringAsync(archivo(datos.idBodega), JSON.stringify(datos));
}

/** Un archivo a medio escribir no puede dejar al operario sin poder abrir la pantalla. */
export async function leerOts(idBodega: number): Promise<OtsLocales | null> {
  try {
    const ruta = archivo(idBodega);
    const info = await FileSystem.getInfoAsync(ruta);
    if (!info.exists) return null;
    const dato = JSON.parse(await FileSystem.readAsStringAsync(ruta)) as OtsLocales;
    if (!Array.isArray(dato?.ots)) return null;
    return { ...dato, cambios: dato.cambios ?? {} };
  } catch {
    return null;
  }
}

export async function borrarOts(idBodega: number): Promise<void> {
  await FileSystem.deleteAsync(archivo(idBodega), { idempotent: true });
}

/** El estado vigente de una OT: lo tocado si hay, si no lo del servidor. */
export function vigente(datos: OtsLocales, ot: OtLocal): CambioOt {
  return datos.cambios[String(ot.id)] ?? {
    estado: ot.estado,
    avance: ot.avance,
    horaInicio: ot.horaInicio,
    horaFin: ot.horaFin,
    notas: ot.notas,
  };
}

export function conCambio(datos: OtsLocales, id: number, cambio: CambioOt): OtsLocales {
  return { ...datos, cambios: { ...datos.cambios, [String(id)]: cambio } };
}

/**
 * Después de enviar: lo aceptado pasa a ser lo del servidor y deja de estar
 * pendiente. Lo rechazado por conflicto también se saca —reintentarlo lo
 * volvería a rechazar— y en su lugar se toma lo que el servidor dice.
 */
export function trasEnviarOts(
  datos: OtsLocales,
  resueltos: number[],
  delServidor: Record<string, Partial<OtLocal>> = {},
): OtsLocales {
  const hechos = new Set(resueltos.map(String));
  const cambios: Record<string, CambioOt> = {};
  for (const [id, c] of Object.entries(datos.cambios)) if (!hechos.has(id)) cambios[id] = c;

  const ots = datos.ots.map((o) => {
    const clave = String(o.id);
    if (!hechos.has(clave)) return o;
    const local = datos.cambios[clave];
    return { ...o, ...(local ? {
      estado: local.estado, avance: local.avance,
      horaInicio: local.horaInicio, horaFin: local.horaFin, notas: local.notas,
    } : {}), ...(delServidor[clave] ?? {}) };
  });

  return { ...datos, ots, cambios };
}

export function pendientesDeEnviar(datos: OtsLocales): number {
  return Object.keys(datos.cambios).length;
}

/** "HH:mm" de la hora actual, que es la precisión con la que se trabaja. */
export function horaAhora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export const ESTADOS: Record<number, string> = {
  0: "Pendiente",
  1: "Sin Iniciar",
  2: "Iniciada",
  3: "En Espera",
  4: "Terminada",
};

export const EST_PENDIENTE = 0;
export const EST_SIN_INICIAR = 1;
export const EST_INICIADA = 2;
export const EST_EN_ESPERA = 3;
export const EST_TERMINADA = 4;

export const COLOR_ESTADO: Record<number, string> = {
  0: "#94a3b8",
  1: "#94a3b8",
  2: "#2563eb",
  3: "#b45309",
  4: "#3f8f2e",
};
