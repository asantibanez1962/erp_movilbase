import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

/**
 * WMDB Model para la tabla local "recibos".
 *
 * Lifecycle:
 *   - Created localmente al guardar en NewReciboScreen (push_status=null).
 *   - Push lo sube al BE → si accepted: syncEngine setea push_status='synced'
 *     + syncUpdatedAt = server timestamp (queda en cache local para "Enviados").
 *   - Si rejected: syncEngine setea push_status='rejected' + push_error.
 *   - Purge silencioso al boot: borra synced > 30 días (lib/db.ts).
 *
 * IMPORTANTE: el field se llama push_status (NO sync_status) porque
 * WMDB Model base ya tiene una propiedad syncStatus interna con un
 * tipo enum específico — declarar nuestro propio syncStatus shadowea
 * la base y rompe el typing.
 *
 * syncUpdatedAt NO es @readonly como en Productor — los recibos son
 * local-owned (no se pullean del server), así que el syncEngine escribe
 * el timestamp manualmente al aceptar el push.
 */
export class Recibo extends Model {
  static readonly table = "recibos";

  @field("numero_recibo") numeroRecibo!: string;
  @field("socio_id") socioId!: number;
  @field("fecha") fecha!: string; // ISO YYYY-MM-DD
  @field("cantidad") cantidad!: number;
  @field("precio") precio!: number;
  @field("compania") compania!: number;
  @field("push_status") pushStatus!: string | null; // null=pendiente | 'synced' | 'rejected'
  @field("push_error") pushError!: string | null;
  @field("sync_updated_at") syncUpdatedAt!: number;

  get total(): number {
    return this.cantidad * this.precio;
  }
}
