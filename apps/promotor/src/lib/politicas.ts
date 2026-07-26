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
  if (politica !== "hasta-evento" || !campoCierre) return true;

  const v = fila[campoCierre];
  return v != null && v !== "" && v !== false && v !== 0;
}

/**
 * ¿Se puede editar en el móvil?
 *
 * `automatica`   → nunca (son maestras del servidor).
 * `hasta-sync`   → mientras no subió.
 * `hasta-evento` → mientras no se cerró; el envío viene después.
 *
 * Ya sincronizado es siempre read-only: corregirlo es trabajo de la web.
 */
export function esEditable(
  mapa: MapaPoliticas,
  coleccion: string,
  // Un Model de WatermelonDB, del que sólo se leen syncStatus y —en hasta-evento—
  // el campo de cierre. No se tipa como Record<string, unknown> porque las clases
  // de WMDB no tienen index signature.
  fila: { syncStatus?: string }
): boolean {
  const { politica, campoCierre } = politicaDe(mapa, coleccion);
  if (politica === "automatica") return false;
  if (fila.syncStatus !== "created") return false;
  if (politica === "hasta-evento" && campoCierre) {
    return !puedeEnviarse(mapa, coleccion, fila as Record<string, unknown>);
  }
  return true;
}
