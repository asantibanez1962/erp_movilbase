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

export interface CollectionInfo {
  name: string;
  /** "pull-only" | "push-only" | "bidirectional" */
  sync_policy: "pull-only" | "push-only" | "bidirectional";
  last_server_change: number;
}
