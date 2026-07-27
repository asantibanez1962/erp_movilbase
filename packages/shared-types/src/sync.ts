/**
 * WatermelonDB-compatible sync DTOs. Mirror del BE en
 * ERP.Backend/Modules/Mobile/Models/SyncDtos.cs.
 *
 * Cualquier cambio acá necesita cambio paralelo del BE — son contrato.
 */

// ---- Pull ----------------------------------------------------------------

export interface PullRequest {
  last_pulled_at: number | null;
  schema_version: number;
  migration?: unknown;
}

export interface PullResponse {
  changes: Record<string, CollectionChanges>;
  /** Server's "now" en unix ms. El cliente lo guarda como next last_pulled_at. */
  timestamp: number;
}

export interface CollectionChanges {
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  /** IDs como strings (WMDB convention). */
  deleted: string[];
}

// ---- Push ----------------------------------------------------------------

export interface PushRequest {
  changes: Record<string, CollectionChanges>;
  last_pulled_at: number | null;
}

export interface PushResponse {
  accepted: Record<string, AcceptedRow[]>;
  rejected: Record<string, RejectedRow[]>;
}

export interface AcceptedRow {
  local_id: string;
  server_id: string;
  codigo?: string | null;
  updated_at: number;
  row_version?: string | null;
}

export interface RejectedRow {
  local_id: string;
  /** Stable code: STALE_VERSION | DUPLICATE_KEY | VALIDATION_FAILED | ... */
  reason: string;
  message: string;
}

// ---- Manifest ------------------------------------------------------------

export interface ManifestRequest {
  app_id: string;
  schema_version: number;
}

export interface ManifestResponse {
  collections: CollectionInfo[];
  min_client_version: string;
  force_upgrade: boolean;
}

/**
 * Ciclo de vida de una fila en el teléfono. Eje ORTOGONAL a sync_policy, que dice
 * la dirección:
 *
 *   automatica    no se edita en el móvil; se envía apenas se guarda.
 *   hasta-sync    editable mientras no subió; la envía el usuario al sincronizar.
 *                 Después es read-only en el móvil.
 *   hasta-evento  editable hasta que un evento la cierra (ej. imprimir un recibo),
 *                 y RECIÉN AHÍ entra a la cola de envío.
 */
/**
 * CICLO DE VIDA de la fila en el teléfono: hasta cuándo se edita y cuándo se envía.
 * Eje ortogonal a sync_policy, que es la DIRECCIÓN.
 *
 *   automatica        no se edita; se envía apenas se guarda (catálogos)
 *   hasta-sync        editable mientras no subió. Una vez arriba es read-only
 *   hasta-evento      editable mientras campo_cierre esté vacío, y RECIÉN ENTONCES se
 *                     envía (recibo de café al imprimirse)
 *   hasta-resolucion  editable mientras campo_cierre esté vacío, INCLUSO ya
 *                     sincronizada, y se envía siempre
 *
 * Los dos últimos comparten el criterio de edición y difieren en el envío. Hacen
 * falta los dos porque una solicitud se sigue pudiendo corregir después de subir
 * —hasta que la oficina la aprueba o rechaza— mientras una visita, no: una vez
 * enviada queda firme. Con un solo valor habría que elegir cuál de las dos
 * romper.
 */
export type PoliticaEdicion =
  | "automatica"
  | "hasta-sync"
  | "hasta-evento"
  | "hasta-resolucion";

export interface CollectionInfo {
  name: string;
  /**
   * Entity del platform (mt.Entities.Name). La necesitan los endpoints que van por
   * entidad y no por colección — hoy los adjuntos:
   * POST /attachments/{entity_name}/{serverId}. Sin esto la app tendría que
   * mantener su propio mapa colección→entidad y desincronizarse.
   */
  entity_name?: string;
  /** "pull-only" | "push-only" | "bidirectional" */
  sync_policy: "pull-only" | "push-only" | "bidirectional";
  politica_edicion: PoliticaEdicion;
  /** En hasta-evento y hasta-resolucion: campo que marca la fila como cerrada. */
  campo_cierre?: string | null;
  last_server_change: number;
}
