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

/**
 * Flag del servidor a booleano, tolerando número y booleano.
 *
 * Hace falta porque el wire mezcla los dos: una columna TINYINT llega como 1, una
 * BIT como `true`. Un `=== 1` sobre un BIT da false y el síntoma es silencioso —
 * pasó con `requiere_solicitud` de tipos_visita: la app no pedía la solicitud en la
 * visita de validación de crédito y el hook del BE nunca disparaba. La proyección
 * ahora convierte los BIT a TINYINT (v1.53/RC/12), pero esto queda como red de
 * seguridad para el próximo flag que aparezca sin convertir.
 */
function esVerdadero(v: number | boolean | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  return (v ?? 0) !== 0;
}

// ─── Catálogos (pull-only) ────────────────────────────────────────────

export class TipoVisita extends Model {
  static readonly table = "tipos_visita";

  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("tipos_visita") tiposVisita!: number | null;
  // number | boolean: ver esVerdadero(). requierefinca es TINYINT y
  // RequiereSolicitud era BIT, así que históricamente llegaron con tipos distintos.
  @readonly @field("requiere_finca") requiereFinca!: number | boolean | null;
  @readonly @field("requiere_solicitud") requiereSolicitud!: number | boolean | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  /**
   * A QUÉ se visita. El nombre de la columna engaña: `requierefinca` no es un
   * booleano "pide finca" sino el DESTINO, con tres valores. Sale del código
   * legacy WinDev, que muestra u oculta los combos según su valor:
   *
   *   0 → recibidor  (combo recibidor; sin productor ni finca)
   *   1 → finca      (productor + finca)
   *   2 → productor  (sólo productor)
   *
   * Es ortogonal a `requiereSolicitud`: un tipo puede tener cualquier destino y
   * además ligarse a una solicitud de crédito.
   */
  get destino(): "recibidor" | "finca" | "productor" {
    let v: number;
    if (typeof this.requiereFinca === "boolean") {
      v = this.requiereFinca ? 1 : 0;
    } else {
      // Default 1 (finca) cuando falta: es el destino de 8 de los 11 tipos.
      v = this.requiereFinca ?? 1;
    }
    if (v === 0) return "recibidor";
    if (v === 2) return "productor";
    return "finca";
  }

  get exigeProductor(): boolean {
    return this.destino !== "recibidor";
  }

  get exigeFinca(): boolean {
    return this.destino === "finca";
  }

  get exigeRecibidor(): boolean {
    return this.destino === "recibidor";
  }

  /** Liga la visita a una solicitud y habilita la producción estimada. */
  get exigeSolicitud(): boolean {
    return esVerdadero(this.requiereSolicitud);
  }
}

export class Productor extends Model {
  static readonly table = "productores";

  @readonly @field("codigo") codigo!: string | null;
  /** El código que usa la relación entregador→solicitud. Ver nota en schema.ts. */
  @readonly @field("rc_codigo") rcCodigo!: string | null;
  /**
   * OJO: `nombre` en ge_Socio ya es el COMPUESTO —
   * apellido1 + apellido2 + nombrep ("ALVARADO ARIAS EULALIO")—, no el nombre de
   * pila. Concatenarlo con los apellidos los duplica.
   */
  @readonly @field("nombre") nombre!: string | null;
  /** Sólo el nombre de pila ("EULALIO"). */
  @readonly @field("nombrep") nombrep!: string | null;
  @readonly @field("apellido1") apellido1!: string | null;
  @readonly @field("apellido2") apellido2!: string | null;
  /** Zona del productor. La solicitud la hereda de acá en vez de pedirla. */
  @readonly @field("rc_zona") rcZona!: string | null;
  @readonly @field("nombrecomercial") nombrecomercial!: string | null;
  @readonly @field("identificacion") identificacion!: string | null;
  @readonly @field("telefonos") telefonos!: string | null;
  @readonly @field("email") email!: string | null;
  @readonly @field("compania") compania!: number;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  /**
   * `nombre` tal cual: ya viene compuesto desde ge_Socio. Antes esto concatenaba
   * nombre + apellido1 + apellido2 y mostraba "ALVARADO ARIAS EULALIO ALVARADO
   * ARIAS". Fallback a las partes sueltas por si `nombre` viniera vacío.
   */
  get displayName(): string {
    const compuesto = this.nombre?.trim();
    if (compuesto) return compuesto;

    const partes = [this.apellido1, this.apellido2, this.nombrep]
      .map((p) => p?.trim())
      .filter(Boolean);
    if (partes.length > 0) return partes.join(" ");

    return this.nombrecomercial?.trim() || "(sin nombre)";
  }

  /** Texto contra el que filtra el buscador de la lista. */
  get searchBlob(): string {
    return [this.codigo, this.rcCodigo, this.displayName, this.identificacion]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
}

export class Recibidor extends Model {
  static readonly table = "recibidores";

  @readonly @field("codigo") codigo!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("zona") zona!: string | null;
  @readonly @field("ubicacion") ubicacion!: string | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  get displayName(): string {
    return this.nombre?.trim() || this.codigo;
  }
}

export class Zona extends Model {
  static readonly table = "zonas";

  @readonly @field("codigo") codigo!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("id_region") idRegion!: number | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;

  get displayName(): string {
    return this.nombre?.trim() || this.codigo;
  }
}

export class TipoDesembolso extends Model {
  static readonly table = "tipos_desembolso";

  @readonly @field("id_tipo_desembolso") idTipoDesembolso!: number;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("requiere_insumo") requiereInsumo!: number | null;
  @readonly @field("requiere_banco") requiereBanco!: number | null;
  @readonly @field("requiere_fe") requiereFe!: number | null;
  @readonly @field("compania") compania!: number | null;
  @readonly @field("sync_updated_at") syncUpdatedAt!: number;
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
  /** Tipo de desembolso. Es la variante vigente: tipo + total. */
  @field("tipo_credito") tipoCredito!: number | null;

  // Rubros: la otra variante del master. Se muestran si vienen del servidor, pero
  // el móvil no los captura.
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
  /** Código del recibidor. Sólo en tipos con destino 'recibidor'. */
  @field("recibidor") recibidor!: string | null;
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

/**
 * Traducción local id → id de servidor de una fila que ya subió. Ver la nota en
 * schema.ts sobre por qué no vive como columna de la fila misma.
 */
export class ServerId extends Model {
  static readonly table = "server_ids";

  @field("coleccion") coleccion!: string;
  @field("local_id") localId!: string;
  @field("server_id") serverId!: string;
  @field("created_at") createdAt!: number;
}

/**
 * Adjunto pendiente de subir (o ya subido, con su copia local conservada).
 *
 * Genérico por (coleccion, registroLocalId): sirve para las fotos de una visita y
 * para la cédula y respaldos de una solicitud. El platform ya guarda los adjuntos
 * por (EntityId, RecordKey), así que atarlo a visitas era una limitación nuestra.
 */
export class PendingUpload extends Model {
  static readonly table = "pending_uploads";

  @field("coleccion") coleccion!: string;
  @field("registro_local_id") registroLocalId!: string;
  @field("file_uri") fileUri!: string;
  /** 'pending' | 'subida' | 'error' */
  @field("status") status!: string;
  @field("error") error!: string | null;
  @field("created_at") createdAt!: number;
  @field("subida_at") subidaAt!: number | null;

  get yaSubio(): boolean {
    return this.status === "subida";
  }
}

/** Lo que espera createDatabase. El orden no importa. */
export const MODEL_CLASSES = [
  TipoVisita,
  Recibidor,
  Zona,
  TipoDesembolso,
  Productor,
  Finca,
  Solicitud,
  Entregador,
  Visita,
  ServerId,
  PendingUpload,
];
