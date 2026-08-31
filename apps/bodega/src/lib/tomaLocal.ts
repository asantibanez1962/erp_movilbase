import * as FileSystem from "expo-file-system/legacy";

/**
 * La toma física guardada en el aparato.
 *
 * POR QUE HAY ALMACENAMIENTO LOCAL ACA Y NO EN EL CAMBIO DE UBICACION. El
 * cambio se confirma en el momento: el café ya se movió cuando el operario
 * toca el botón, así que aceptar algo sin servidor sería aceptar algo que
 * después habría que rechazar. La toma física es al revés: el operario recorre
 * la bodega anotando, y entre los carriles puede no haber wifi. Baja, cuenta,
 * y envía cuando vuelve a tener señal.
 *
 * POR QUE UN ARCHIVO JSON Y NO LA BASE LOCAL DE LAS OTRAS APPS. Lo que se
 * guarda es un conjunto acotado y de un día —las partidas de UNA bodega en UNA
 * fecha— que se descarga entero, se digita y se manda. No hay deltas, ni
 * sincronización incremental, ni resolución de conflictos por fila: eso lo
 * decide el servidor al recibir. Un archivo se entiende leyéndolo; WatermelonDB
 * traería un esquema, migraciones y un motor de sync para un caso que no los
 * necesita.
 *
 * LO QUE EL ARCHIVO NO TIENE. Ni sacos ni peso del sistema. No es un olvido: el
 * servidor no los manda, para que el conteo sea a ciegas. Si algún día alguien
 * los agrega a la vista, van a aparecer acá sin que nadie lo pida — por eso la
 * conversión de filas de abajo es explícita campo por campo y no un spread.
 */

export interface FilaToma {
  /** id de cain_tomafisica — es lo que se manda al enviar. */
  id: number;
  partida: string;
  idUbicacion: number;
  ubicacion: string;
  calidad: string;
  /** Lo que el servidor ya tenía contado cuando se bajó. null = sin contar. */
  contadoServidor: number | null;
}

export interface TomaLocal {
  idBodega: number;
  /** yyyy-mm-dd */
  fecha: string;
  bajadaAt: string;
  filas: FilaToma[];
  /**
   * Lo digitado en el teléfono y TODAVIA NO ENVIADO, por id de fila.
   *
   * Se guarda aparte de `filas` a propósito: la diferencia entre las dos cosas
   * es exactamente "lo que se perdería si el aparato se apaga", y es lo que la
   * pantalla muestra como pendiente de enviar. Mezclarlas obligaría a comparar
   * contra el servidor para saberlo.
   */
  conteos: Record<string, number | null>;
}

const CARPETA = `${FileSystem.documentDirectory}toma-fisica/`;

function archivo(idBodega: number, fecha: string) {
  return `${CARPETA}b${idBodega}-${fecha}.json`;
}

async function asegurarCarpeta() {
  const info = await FileSystem.getInfoAsync(CARPETA);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CARPETA, { intermediates: true });
}

export async function guardarToma(toma: TomaLocal): Promise<void> {
  await asegurarCarpeta();
  await FileSystem.writeAsStringAsync(archivo(toma.idBodega, toma.fecha), JSON.stringify(toma));
}

/**
 * Lee la toma guardada. Si el archivo no está o está roto devuelve null en vez
 * de reventar: un JSON a medio escribir —el aparato se apagó mientras
 * guardaba— no puede dejar al operario sin poder abrir la pantalla.
 */
export async function leerToma(idBodega: number, fecha: string): Promise<TomaLocal | null> {
  try {
    const ruta = archivo(idBodega, fecha);
    const info = await FileSystem.getInfoAsync(ruta);
    if (!info.exists) return null;
    const crudo = await FileSystem.readAsStringAsync(ruta);
    const dato = JSON.parse(crudo) as TomaLocal;
    if (!Array.isArray(dato?.filas)) return null;
    return { ...dato, conteos: dato.conteos ?? {} };
  } catch {
    return null;
  }
}

export async function borrarToma(idBodega: number, fecha: string): Promise<void> {
  await FileSystem.deleteAsync(archivo(idBodega, fecha), { idempotent: true });
}

/** Digitar un conteo. `null` deja la partida como no contada. */
export function conConteo(toma: TomaLocal, id: number, valor: number | null): TomaLocal {
  return { ...toma, conteos: { ...toma.conteos, [String(id)]: valor } };
}

/**
 * Después de un envío exitoso: lo aceptado pasa a ser lo que dice el servidor y
 * deja de estar pendiente. Lo rechazado —una partida que ya contó otro
 * operario— se saca de pendientes también, porque reintentarlo lo volvería a
 * rechazar; el servidor manda.
 */
export function trasEnviar(toma: TomaLocal, idsResueltos: number[]): TomaLocal {
  const resueltos = new Set(idsResueltos.map(String));
  const conteos: Record<string, number | null> = {};
  for (const [id, valor] of Object.entries(toma.conteos)) {
    if (!resueltos.has(id)) conteos[id] = valor;
  }
  const filas = toma.filas.map((f) =>
    resueltos.has(String(f.id))
      ? { ...f, contadoServidor: toma.conteos[String(f.id)] ?? f.contadoServidor }
      : f,
  );
  return { ...toma, filas, conteos };
}

/** El valor vigente de una fila: lo digitado si hay, si no lo del servidor. */
export function valorDe(toma: TomaLocal, fila: FilaToma): number | null {
  const local = toma.conteos[String(fila.id)];
  return local !== undefined ? local : fila.contadoServidor;
}

export function resumenLocal(toma: TomaLocal) {
  const total = toma.filas.length;
  const contadas = toma.filas.filter((f) => valorDe(toma, f) !== null).length;
  return {
    total,
    contadas,
    pendientesDeContar: total - contadas,
    pendientesDeEnviar: Object.keys(toma.conteos).length,
  };
}

/** Fecha de hoy como yyyy-mm-dd, en hora local y no UTC. */
export function hoyLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
