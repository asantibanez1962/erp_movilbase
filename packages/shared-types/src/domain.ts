/**
 * Domain types shared across mobile apps. Mirrors the curated subset of
 * fields the BE exposes via /api/sync/*, NOT the full entity schema.
 *
 * Stays in snake_case to match the wire format from the sync endpoints.
 * Each row also gets WatermelonDB internals (_status, _changed) which
 * are managed by WMDB, not declared here.
 */

export interface Productor {
  /** Server bigint as string (WMDB convention). */
  id: string;
  codigo: string | null;
  nombre: string | null;
  apellido1: string | null;
  apellido2: string | null;
  nombrecomercial: string | null;
  identificacion: string | null;
  telefonos: string | null;
  email: string | null;
  compania: number;
  /** Server-time UTC unix ms. Set by BE trigger; client only reads. */
  sync_updated_at: number;
  sync_deleted_at: number | null;
}

export interface Recibo {
  /** Server bigint as string. Local rows use a temp "local-<uuid>" until sync. */
  id: string;
  record_id: number | null;
  version_number: number;
  is_current: boolean;
  compania: number;
  socio_id: number;
  /** Free-text número manual en el POC. Post-POC reservado por scope (cosecha+agencia+device). */
  numero_recibo: string | null;
  /** ISO date string (YYYY-MM-DD). */
  fecha: string;
  cantidad: number;
  precio: number;
  sync_updated_at: number;
  sync_deleted_at: number | null;
}
