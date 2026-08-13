import type { PoliticaEdicion } from "@erp/shared-types";
import { getSyncClient } from "./api";
import { config } from "./config";

/**
 * Política de edición y envío por colección, declarada en mt.MobileCollections y
 * traída del manifest.
 *
 * Vive en el servidor y no en el código de la app para que sumar una colección
 * —o cambiarle el ciclo de vida— sea configuración. Antes esto estaba
 * hardcodeado: el getter `esLocal` decidía si mostrar "Editar" y el sync
 * automático se sacó a mano de cada pantalla.
 */
export interface PoliticaColeccion {
  politica: PoliticaEdicion;
  /** Sólo en hasta-evento: campo que marca la fila como cerrada. */
  campoCierre: string | null;
  /**
   * Entity del platform (mt.Entities.Name). La necesitan los endpoints que van
   * por entidad y no por colección — hoy los adjuntos:
   * POST /attachments/{entidad}/{serverId}.
   */
  entidad: string | null;
}

export type MapaPoliticas = Record<string, PoliticaColeccion>;

/**
 * Default si el manifest no se pudo traer (primera corrida sin señal, o un BE
 * viejo que todavía no manda el campo).
 *
 * `hasta-sync` y no `automatica`: es el default conservador. Con `automatica` la
 * app enviaría apenas guarda y el usuario perdería la ventana de edición; con
 * `hasta-sync` a lo sumo sincroniza a mano de más.
 */
const POR_DEFECTO: PoliticaColeccion = {
  politica: "hasta-sync",
  campoCierre: null,
  entidad: null,
};

export async function cargarPoliticas(): Promise<MapaPoliticas> {
  const api = getSyncClient();
  const manifest = await api.manifest({
    app_id: config.appId,
    schema_version: config.schemaVersion,
  });

  const mapa: MapaPoliticas = {};
  for (const c of manifest.collections ?? []) {
    mapa[c.name] = {
      politica: c.politica_edicion ?? POR_DEFECTO.politica,
      campoCierre: c.campo_cierre ?? null,
      entidad: c.entity_name || null,
    };
  }
  return mapa;
}

export function politicaDe(
  mapa: MapaPoliticas,
  coleccion: string
): PoliticaColeccion {
  return mapa[coleccion] ?? POR_DEFECTO;
}

/**
 * Entity del platform de una colección, para los endpoints que van por entidad
 * (adjuntos). Null si el manifest todavía no bajó — quien llame debe esperar en
 * vez de inventar un nombre.
 */
export function entidadDe(
  mapa: MapaPoliticas,
  coleccion: string
): string | null {
  return politicaDe(mapa, coleccion).entidad;
}

/**
 * ¿La fila ya puede salir del teléfono?
 *
 * Sólo `hasta-evento` retiene: la fila espera a que su campo de cierre tenga
 * valor (ej. un recibo hasta que se imprime). Las otras políticas envían siempre
 * — la diferencia entre ellas es CUÁNDO se dispara el sync, no si la fila puede ir.
 */
export function puedeEnviarse(
  mapa: MapaPoliticas,
  coleccion: string,
  fila: Record<string, unknown>
): boolean {
  const { politica, campoCierre } = politicaDe(mapa, coleccion);
  // `hasta-resolucion` NO retiene: comparte con hasta-evento el criterio de edición,
  // pero envía siempre. Es la diferencia entre las dos.
  if (politica !== "hasta-evento" || !campoCierre) return true;

  return !estaAbierta(fila, campoCierre);
}

/**
 * ¿El campo de cierre está vacío, o sea la fila sigue abierta?
 *
 * Vacío es null, cadena vacía, false o 0. El 0 importa: el campo de cierre de una
 * solicitud es `estado`, donde 0 significa pendiente — tratarlo como "cerrado" por ser
 * falsy dejaría toda solicitud pendiente como no editable, que es exactamente lo
 * contrario de lo que se quiere.
 *
 * `campoCierre` es un nombre de COLUMNA (viene de la metadata del servidor), y estas
 * funciones reciben dos formas distintas: el engine pasa raws —donde las claves son
 * columnas— y las pantallas pasan modelos de WatermelonDB, donde son propiedades
 * camelCase. Se mira primero `_raw`, que siempre tiene la columna, y se cae a la
 * propiedad para el caso en que coincidan (`estado`) o venga un objeto plano.
 */
function estaAbierta(fila: Record<string, unknown>, campoCierre: string): boolean {
  const raw = (fila as { _raw?: Record<string, unknown> })._raw;
  const v = raw && campoCierre in raw ? raw[campoCierre] : fila[campoCierre];
  return v == null || v === "" || v === false || v === 0;
}

/**
 * ¿Se puede editar en el móvil?
 *
 * `automatica`       → nunca (son maestras del servidor).
 * `hasta-sync`       → mientras no subió. Arriba queda read-only.
 * `hasta-evento`     → mientras el campo de cierre esté vacío; el envío viene después.
 * `hasta-resolucion` → mientras el campo de cierre esté vacío, INCLUSO ya sincronizada.
 *
 * El último es el que rompe la regla vieja de "sincronizado ⇒ read-only", y a propósito:
 * una solicitud se sigue pudiendo corregir mientras la oficina no la resolvió, y el push
 * lleva sólo los campos que cambiaron. Una visita, en cambio, queda firme al enviarse —
 * de ahí que hagan falta dos políticas y no una sola más permisiva.
 */
export function esEditable(
  mapa: MapaPoliticas,
  coleccion: string,
  // Un Model de WatermelonDB, del que sólo se leen syncStatus y —cuando la política lo
  // usa— el campo de cierre. No se tipa como Record<string, unknown> porque las clases
  // de WMDB no tienen index signature.
  fila: { syncStatus?: string }
): boolean {
  const { politica, campoCierre } = politicaDe(mapa, coleccion);
  if (politica === "automatica") return false;

  // Único caso en que la fila sincronizada sigue abierta. Sin campo de cierre no hay
  // forma de saber si lo está, así que se cae al criterio conservador de hasta-sync.
  if (politica === "hasta-resolucion" && campoCierre) {
    return estaAbierta(fila as Record<string, unknown>, campoCierre);
  }

  if (fila.syncStatus !== "created") return false;

  if (politica === "hasta-evento" && campoCierre) {
    return estaAbierta(fila as Record<string, unknown>, campoCierre);
  }
  return true;
}
