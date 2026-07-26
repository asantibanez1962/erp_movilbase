import { Model } from "@nozbe/watermelondb";
import { field, readonly } from "@nozbe/watermelondb/decorators";

/**
 * Models WMDB de la app 'promotor'. Todos en un archivo: son thin wrappers sobre
 * las columnas del schema y separarlos en 7 archivos de 15 líneas no compra nada.
 *
 * Convención de los pull-only (productores, fincas, tipos de visita): TODOS los
 * campos van @readonly — la app nunca los escribe, el server es la fuente de
 * verdad. Escribir uno flipearía _status a 'updated' y WMDB intentaría pushear
 * una colección que el BE rechaza por pull-only.
 */

// ─── Catálogos (pull-only) ────────────────────────────────────────────

export class TipoVisita extends Model {
  static readonly table = "tipos_visita";

  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("tipos_visita") tiposVisita!: number | null;
  @readonly @field("requiere_finca") requiereFinca!: number | null;
  @readonly @field("requiere_solicitud") requiereSolicitud!: number | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  /**
   * El form obliga a elegir finca cuando el tipo lo pide.
   *
   * OJO: `requierefinca` es TINYINT, no BIT, y en sci_altura_2026 hay tipos con
   * valor 2 ("Visita Productor" = 2, "Visita Recibidores" = 0). El valor viene
   * heredado del legacy re_tiposvisita y NINGÚN código de la web ni del BE lo
   * consume, así que qué significa el 2 no está definido en ningún lado.
   *
   * Tomamos "distinto de cero" = exige finca, que es lo conservador: un `=== 1`
   * dejaría sin picker de finca a "Visita Productor", donde casi seguro hace
   * falta. Confirmar con negocio y ajustar si el 2 quiere decir otra cosa
   * (¿opcional? ¿varias fincas?).
   */
  get exigeFinca(): boolean {
    return (this.requiereFinca ?? 0) !== 0;
  }

  /** El tipo "Validación de Crédito": la visita se liga a una solicitud. */
  get exigeSolicitud(): boolean {
    return this.requiereSolicitud === 1;
  }
}

export class Productor extends Model {
  static readonly table = "productores";

  @readonly @field("codigo") codigo!: string | null;
  /** El código que usa la relación entregador→solicitud. Ver nota en schema.ts. */
  @readonly @field("rc_codigo") rcCodigo!: string | null;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("apellido1") apellido1!: string | null;
  @readonly @field("apellido2") apellido2!: string | null;
  @readonly @field("nombrecomercial") nombrecomercial!: string | null;
  @readonly @field("identificacion") identificacion!: string | null;
  @readonly @field("telefonos") telefonos!: string | null;
  @readonly @field("email") email!: string | null;
  @readonly @field("compania") compania!: number;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  get displayName(): string {
    const parts = [this.nombre, this.apellido1, this.apellido2].filter(Boolean);
    return parts.length > 0
      ? parts.join(" ")
      : (this.nombrecomercial ?? "(sin nombre)");
  }

  /** Texto contra el que filtra el buscador de la lista. */
  get searchBlob(): string {
    return [this.codigo, this.rcCodigo, this.displayName, this.identificacion]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
}

export class Finca extends Model {
  static readonly table = "fincas";

  @readonly @field("id_socio") idSocio!: number;
  @readonly @field("nombre_finca") nombreFinca!: string | null;
  @readonly @field("ubicacion") ubicacion!: string | null;
  @readonly @field("area") area!: number | null;
  @readonly @field("altitud") altitud!: number | null;
  @readonly @field("id_region") idRegion!: number | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  get displayName(): string {
    return this.nombreFinca?.trim() || `Finca #${this.id}`;
  }
}

// ─── Solicitudes de crédito (bidireccional) ───────────────────────────

export class Solicitud extends Model {
  static readonly table = "solicitudes";

  @field("id_socio") idSocio!: number | null;
  @field("codigo") codigo!: string | null;
  @field("fecha") fecha!: number | null;
  @field("cosecha") cosecha!: string | null;
  @field("zona") zona!: string | null;

  @field("efectivo") efectivo!: number | null;
  @field("insumos") insumos!: number | null;
  @field("almacigo") almacigo!: number | null;
  @field("formalizacion") formalizacion!: number | null;
  @field("otros") otros!: number | null;
  @field("total") total!: number | null;

  @field("plan_inversion") planInversion!: string | null;
  @field("motivo") motivo!: string | null;
  @field("entrega_estimada") entregaEstimada!: number | null;
  @field("prod_estimada") prodEstimada!: number | null;
  @field("aprobado") aprobado!: number | null;
  @field("estado") estado!: number | null;

  // Escritos por el hook del BE desde la visita de validación de crédito.
  // Read-only acá igual que en el form web.
  @readonly @field("prod_estimada_promotor") prodEstimadaPromotor!: number | null;
  @readonly @field("inspeccion_campo") inspeccionCampo!: number | null;

  @field("client_uuid") clientUuid!: string | null;
  @field("compania") compania!: number | null;
  @field("push_status") pushStatus!: string | null;
  @field("push_error") pushError!: string | null;
  @field("sync_updated_at") syncUpdatedAt!: number;

  /** Suma de rubros — lo que el form muestra como total mientras se edita. */
  get totalRubros(): number {
    return (
      (this.efectivo ?? 0) +
      (this.insumos ?? 0) +
      (this.almacigo ?? 0) +
      (this.formalizacion ?? 0) +
      (this.otros ?? 0)
    );
  }

  /** Todavía no subió al servidor (el id local sigue siendo un uuid de WMDB). */
  get esLocal(): boolean {
    return this.syncStatus === "created";
  }
}

export class Entregador extends Model {
  static readonly table = "entregadores";

  /** Id LOCAL de la solicitud padre — server id si vino de un pull, uuid si no. */
  @field("id_solicitud") idSolicitud!: string;
  /** El productor entregador. Es la relación real. */
  @field("id_socio") idSocio!: number | null;
  /** Derivado de idSocio (su rc_codigo). Se manda por compatibilidad legacy. */
  @field("codigo") codigo!: string | null;
  @field("client_uuid") clientUuid!: string | null;
  @field("push_status") pushStatus!: string | null;
  @field("push_error") pushError!: string | null;
  @field("sync_updated_at") syncUpdatedAt!: number;
}

// ─── Visitas de campo (bidireccional) ─────────────────────────────────

export class Visita extends Model {
  static readonly table = "visitas";

  @field("id_tipo_visita") idTipoVisita!: number;
  @field("id_socio") idSocio!: number | null;
  @field("cosecha") cosecha!: string | null;
  @field("id_finca") idFinca!: number | null;
  @field("id_usuario_promotor") idUsuarioPromotor!: number | null;
  /** Mismo criterio que Entregador.idSolicitud. */
  @field("id_solicitud") idSolicitud!: string | null;
  @field("fecha") fecha!: number | null;
  @field("observaciones") observaciones!: string | null;
  @field("gps_lat") gpsLat!: number | null;
  @field("gps_lng") gpsLng!: number | null;
  @field("prod_estimada_promotor") prodEstimadaPromotor!: number | null;
  @field("estado") estado!: number | null;
  @field("client_uuid") clientUuid!: string | null;
  @field("compania") compania!: number | null;
  @field("push_status") pushStatus!: string | null;
  @field("push_error") pushError!: string | null;
  @field("sync_updated_at") syncUpdatedAt!: number;

  get tieneGps(): boolean {
    return this.gpsLat != null && this.gpsLng != null;
  }
}

// ─── Cola local de fotos (nunca se sincroniza) ────────────────────────

export class PendingUpload extends Model {
  static readonly table = "pending_uploads";

  @field("visita_local_id") visitaLocalId!: string;
  @field("file_uri") fileUri!: string;
  @field("status") status!: string; // 'pending' | 'error'
  @field("error") error!: string | null;
  @field("created_at") createdAt!: number;
}

/** Lo que espera createDatabase. El orden no importa. */
export const MODEL_CLASSES = [
  TipoVisita,
  Productor,
  Finca,
  Solicitud,
  Entregador,
  Visita,
  PendingUpload,
];
