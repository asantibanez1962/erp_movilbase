import { Model } from "@nozbe/watermelondb";
import { field, date, readonly } from "@nozbe/watermelondb/decorators";

/**
 * WMDB Model para la tabla local "productores".
 *
 * Decorators (legacy stage-2):
 *   @field("col_name") → getter/setter contra la columna SQLite.
 *   @date(...)         → exposed como Date object (no se usa acá, solo number).
 *   @readonly          → solo lectura desde el code; cambia via _raw vía sync.
 *
 * El id (string) lo provee Model base — matchea el server_id del BE.
 */
export class Productor extends Model {
  static readonly table = "productores";

  @field("codigo") codigo!: string | null;
  @field("nombre") nombre!: string | null;
  @field("apellido1") apellido1!: string | null;
  @field("apellido2") apellido2!: string | null;
  @field("nombrecomercial") nombrecomercial!: string | null;
  @field("identificacion") identificacion!: string | null;
  @field("telefonos") telefonos!: string | null;
  @field("email") email!: string | null;
  @field("compania") compania!: number;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  /** Display name helper — concat de nombre + apellidos cuando aplica. */
  get displayName(): string {
    const parts = [this.nombre, this.apellido1, this.apellido2].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : (this.nombrecomercial ?? "(sin nombre)");
  }
}
