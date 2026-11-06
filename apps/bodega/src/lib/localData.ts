import * as FileSystem from "expo-file-system/legacy";
import { OtsLocales } from "./otLocal";
import { TomaLocal } from "./tomaLocal";

/**
 * Lo que la app guarda en el aparato, visto en conjunto.
 *
 * POR QUE EXISTE ESTE ARCHIVO. La app arrancó sin nada local: el cambio de
 * ubicación se confirma contra el servidor en el momento. Después llegaron la
 * toma física y las OT, que sí guardan trabajo sin enviar, y entonces cambiar
 * de servidor —que antes era inocuo— pasó a ser peligroso sin que nada en la
 * pantalla de Servidor lo dijera. Su comentario seguía afirmando que la app no
 * guardaba datos de negocio.
 *
 * POR QUE CAMBIAR DE SERVIDOR TIENE QUE BORRAR. Los archivos locales están
 * indexados por id de bodega y guardan ids de partidas y de OT. Esos ids
 * pertenecen a UNA base: apuntar la app a otra los deja referenciando filas que
 * allá son otra cosa, o que no existen. Enviarlos escribiría en el documento
 * equivocado, y el servidor no tendría cómo notarlo — los ids serían válidos.
 */

const CARPETAS = [
  `${FileSystem.documentDirectory}toma-fisica/`,
  `${FileSystem.documentDirectory}ot/`,
];

export interface Pendientes {
  conteos: number;
  ots: number;
  total: number;
}

async function archivosDe(carpeta: string): Promise<string[]> {
  try {
    const info = await FileSystem.getInfoAsync(carpeta);
    if (!info.exists) return [];
    return (await FileSystem.readDirectoryAsync(carpeta)).map((n) => carpeta + n);
  } catch {
    return [];
  }
}

async function leerJson<T>(ruta: string): Promise<T | null> {
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(ruta)) as T;
  } catch {
    return null;
  }
}

/**
 * Cuánto trabajo hay en el teléfono que todavía no salió.
 *
 * Se cuenta leyendo los archivos y no un contador aparte: un contador se
 * desincroniza en cuanto algo falla a mitad de camino, y este número es el que
 * decide si se le avisa a alguien que está por perder su turno de conteo.
 */
export async function pendientesLocales(): Promise<Pendientes> {
  let conteos = 0;
  let ots = 0;

  for (const ruta of await archivosDe(CARPETAS[0]!)) {
    const t = await leerJson<TomaLocal>(ruta);
    conteos += Object.keys(t?.conteos ?? {}).length;
  }
  for (const ruta of await archivosDe(CARPETAS[1]!)) {
    const o = await leerJson<OtsLocales>(ruta);
    ots += Object.keys(o?.cambios ?? {}).length;
  }

  return { conteos, ots, total: conteos + ots };
}

/** Borra TODO lo guardado: tomas físicas y OT, enviadas o no. */
export async function borrarTodoLocal(): Promise<void> {
  for (const carpeta of CARPETAS) {
    await FileSystem.deleteAsync(carpeta, { idempotent: true });
  }
}
