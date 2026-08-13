import { Model } from "@nozbe/watermelondb";
import { field, readonly } from "@nozbe/watermelondb/decorators";

/**
 * Models WMDB de la app `recibos`. Todos en un archivo: son envoltorios finos sobre
 * las columnas del schema y separarlos en veinte archivos de quince líneas no compra
 * nada.
 *
 * CONVENCIÓN DE LOS PULL-ONLY: todos sus campos van `@readonly`. La app nunca los
 * escribe y el servidor es la fuente de verdad. Escribir uno pondría `_status` en
 * 'updated' y WMDB intentaría pushear una colección que el BE rechaza.
 */

// ─── Catálogos del cálculo (sin pantalla) ───────────────────────────────────

export class CastigoBroca extends Model {
  static readonly table = "castigos_broca";
  @readonly @field("granosbroca") granosbroca!: number;
  @readonly @field("cantidad") cantidad!: number;
  @readonly @field("cuartilloscastigo") cuartilloscastigo!: number;
}

export class CastigoCosecha extends Model {
  static readonly table = "castigos_cosecha";
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("nivel") nivel!: number;
  @readonly @field("tipocastigo") tipocastigo!: number;
  @readonly @field("topeaceptado") topeaceptado!: number | null;
  @readonly @field("pctcastigo") pctcastigo!: number | null;
}

export class RecibidorNivel extends Model {
  static readonly table = "recibidor_nivel";
  @readonly @field("recibidor") recibidor!: string;
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("nivel") nivel!: number;
}

export class Precio extends Model {
  static readonly table = "precios";
  @readonly @field("idreprecio") idreprecio!: number;
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("tipocafe") tipocafe!: string | null;
  @readonly @field("calidad") calidad!: string | null;
  @readonly @field("zona") zona!: string | null;
  @readonly @field("recibidor") recibidor!: string | null;
  @readonly @field("tipo") tipo!: string | null;
  @readonly @field("codigo") codigo!: string | null;
  @readonly @field("monto") monto!: number;
  @readonly @field("moneda") moneda!: number;
  @readonly @field("recalcula") recalcula!: number;
  @readonly @field("flete") flete!: number;
}

export class Nivel extends Model {
  static readonly table = "niveles";
  @readonly @field("nivel") nivel!: number;
  @readonly @field("nombre") nombre!: string | null;
}

export class Talonario extends Model {
  static readonly table = "talonarios";
  @readonly @field("recibidor") recibidor!: string;
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("inicio") inicio!: string;
  @readonly @field("final") final!: string;
  /** ⚠️ NO es el último usado: es el PRÓXIMO. Leerlo como "el último" y sumarle uno
   *  salta un número por recarga, y eso se descubre cuando la oficina ve huecos con los
   *  papeles ya entregados. */
  @readonly @field("ultimo") ultimo!: string;
  @readonly @field("tipo") tipo!: number;
}

// ─── Catálogos de selección ─────────────────────────────────────────────────

export class Zona extends Model {
  static readonly table = "zonas";
  @readonly @field("zona") zona!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("tipocafe") tipocafe!: string | null;
}

export class TipoCafe extends Model {
  static readonly table = "tipos_cafe";
  @readonly @field("tipocafe") tipocafe!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("idcertificado") idcertificado!: number | null;
}

export class TipoCastigo extends Model {
  static readonly table = "tipos_castigo";
  @readonly @field("tipocastigo") tipocastigo!: number;
  @readonly @field("nombre") nombre!: string | null;
}

export class Calidad extends Model {
  static readonly table = "calidades";
  @readonly @field("calidad") calidad!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("idcertificado") idcertificado!: number | null;
}

export class Certificado extends Model {
  static readonly table = "certificados";
  @readonly @field("idcertificado") idcertificado!: number;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("premio") premio!: number | null;
  @readonly @field("porcentaje") porcentaje!: number | null;
}

export class Cosecha extends Model {
  static readonly table = "cosechas";
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("descripcion") descripcion!: string | null;
  @readonly @field("digitarrecibos") digitarrecibos!: number | null;
}

export class Recibidor extends Model {
  static readonly table = "recibidores";
  @readonly @field("recibidor") recibidor!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("zona") zona!: string | null;
  /** ⚠️ Éste, y no `zona`, es el que cruza con la zona del productor. */
  @readonly @field("codigozona") codigozona!: string | null;
  @readonly @field("tipocafe") tipocafe!: string | null;
  @readonly @field("tipo") tipo!: string | null;
}

export class Transportista extends Model {
  static readonly table = "transportistas";
  @readonly @field("transportista") transportista!: string;
  @readonly @field("nombre") nombre!: string | null;
}

export class Provincia extends Model {
  static readonly table = "provincias";
  @readonly @field("codigo") codigo!: number | null;
  @readonly @field("provincia") provincia!: string | null;
}

export class Canton extends Model {
  static readonly table = "cantones";
  @readonly @field("id_provincia") idProvincia!: number;
  @readonly @field("codigo") codigo!: number | null;
  @readonly @field("canton") canton!: string | null;
}

export class Distrito extends Model {
  static readonly table = "distritos";
  @readonly @field("id_provincia") idProvincia!: number;
  @readonly @field("id_canton") idCanton!: number;
  @readonly @field("codigo") codigo!: number | null;
  @readonly @field("distrito") distrito!: string | null;
}

// ─── Productores y lo que cuelga ────────────────────────────────────────────

export class Productor extends Model {
  static readonly table = "productores";
  @readonly @field("codigo") codigo!: string;
  @readonly @field("nombre") nombre!: string | null;
  @readonly @field("cedula") cedula!: string | null;
  @readonly @field("email") email!: string | null;
  @readonly @field("telefono") telefono!: string | null;
  /** Entra al criterio del precio, no es informativo. */
  @readonly @field("tipo") tipo!: string | null;
  @readonly @field("zona") zona!: string | null;
  @readonly @field("recibidor") recibidor!: string | null;
}

export class Finca extends Model {
  static readonly table = "fincas";
  @readonly @field("id_socio") idSocio!: number;
  @readonly @field("nombre") nombre!: string | null;
  /** Atributo de la finca. De acá sale el `cldd` del recibo; no se digita. */
  @readonly @field("cldd") cldd!: number;
}

export class Cuota extends Model {
  static readonly table = "cuotas";
  /** `idcuotaprod`: la llave por la que la referencian los entregadores. */
  @readonly @field("id_cuota") idCuota!: number;
  @readonly @field("id_socio") idSocio!: number;
  @readonly @field("id_certificado") idCertificado!: number;
  @readonly @field("cosecha") cosecha!: string;
  @readonly @field("activo") activo!: number;
}

export class CuotaEntregador extends Model {
  static readonly table = "cuota_entregadores";
  @readonly @field("id_cuota") idCuota!: number;
  @readonly @field("id_socio") idSocio!: number;
  @readonly @field("activo") activo!: number;
}

// ─── Bidireccionales: las que crea el teléfono ──────────────────────────────

/**
 * El camión que llega de los recibidores, medido en el sitio de recepción.
 *
 * ⚠️ ACÁ EL MÓVIL NO CALCULA NADA, al revés que el recibo. Los porcentajes se registran y
 * el servidor recalcula los agregados del día por su cuenta: tr_rc_remedida_remdirty
 * marca el día como sucio al insertar y un proceso aparte lo recompone.
 */
export class Remedida extends Model {
  static readonly table = "remedidas";
  @field("server_id") serverId!: string | null;
  /** sifón(3) + 6 dígitos, con los ceros de relleno. */
  @field("recibo") recibo!: string;
  @field("sifon") sifon!: string;
  @field("recibidor") recibidor!: string | null;
  @field("cosecha") cosecha!: string;
  @field("fecha") fecha!: number | null;
  @field("calidad") calidad!: string | null;
  @field("tipocafe") tipocafe!: string | null;
  @field("transportista") transportista!: number | null;
  @field("placa") placa!: string | null;
  @field("angarilla") angarilla!: number | null;
  /** Cajuelas con cuartillos en decimales: 29,50 son 29 cajuelas y 2 cuartillos. */
  @field("cantidad") cantidad!: number;
  @field("verdes") verdes!: number;
  @field("flotemaduro") flotemaduro!: number;
  @field("floteseco") floteseco!: number;
  @field("granosbrocados") granosbrocados!: number;
  @field("medidor") medidor!: string | null;
  @field("observaciones") observaciones!: string | null;
  /** 0 sin imprimir · 1 original · 2+ copias. Es el campo de cierre del sync. */
  @field("impreso") impreso!: number;
}

/** Un recibidor del que venía el camión. Varios por remedida — de 1 a 17 en la práctica. */
export class RemedidaRuta extends Model {
  static readonly table = "remedida_rutas";
  @field("server_id") serverId!: string | null;
  @field("id_remedida") idRemedida!: string;
  @field("recibidor") recibidor!: string;
}

export class Bitacora extends Model {
  static readonly table = "bitacoras";
  @field("server_id") serverId!: string | null;
  @field("recibidor") recibidor!: string;
  @field("cosecha") cosecha!: string;
  @field("tipocafe") tipocafe!: string | null;
  @field("fecha") fecha!: number | null;
  @field("hora_inicio") horaInicio!: number | null;
  /** Nula ⇒ abierta. Se llena al imprimir el reporte del día. */
  @field("hora_final") horaFinal!: number | null;
  @field("medidor") medidor!: string | null;
  @field("transportista") transportista!: string | null;
  @field("placacamion") placacamion!: string | null;
  @field("observaciones") observaciones!: string | null;
  @field("impresiones") impresiones!: number;

  get estaAbierta(): boolean {
    return this.horaFinal == null;
  }
}

export class Recibo extends Model {
  static readonly table = "recibos";
  @field("server_id") serverId!: string | null;
  @field("id_bitacora") idBitacora!: string;
  @field("recibo") recibo!: string;
  @field("fecha") fecha!: number | null;
  @field("recibidor") recibidor!: string;
  @field("cosecha") cosecha!: string;
  @field("calidad") calidad!: string | null;
  /** El código de tipo de café. En el servidor viaja en la columna `zona`. */
  @field("tipo_cafe") tipoCafe!: string | null;
  @field("nivel") nivel!: number | null;

  @field("id_socio") idSocio!: number | null;
  @field("codigo") codigo!: string | null;
  /** Nombre de quien entregó. Se copia del productor, o se digita si es genérico. */
  @field("nombre") nombre!: string | null;
  @field("cedula") cedula!: string | null;
  @field("id_finca") idFinca!: number | null;
  @field("id_certificado") idCertificado!: number | null;
  @field("cldd") cldd!: number | null;
  @field("observaciones") observaciones!: string | null;

  @field("cantidadinicial") cantidadinicial!: number;
  @field("cuartillosinicial") cuartillosinicial!: number;
  @field("granosbrocados") granosbrocados!: number;
  @field("verdes") verdes!: number;
  @field("flotemaduro") flotemaduro!: number;
  @field("floteseco") floteseco!: number;

  @field("broca") broca!: number;
  @field("cuartillosbroca") cuartillosbroca!: number;
  @field("rebajoverde") rebajoverde!: number;
  @field("cuartillosrebajoverde") cuartillosrebajoverde!: number;
  @field("rebajoflote") rebajoflote!: number;
  @field("cuartillosrebajoflote") cuartillosrebajoflote!: number;
  @field("rebajofloteseco") rebajofloteseco!: number;
  @field("cuartillosrebajofloteseco") cuartillosrebajofloteseco!: number;
  @field("cantidad") cantidad!: number;
  @field("rcantidad") rcantidad!: number;
  @field("rcantidadcuartillos") rcantidadcuartillos!: number;

  @field("idreprecio") idreprecio!: number | null;
  @field("precio") precio!: number | null;
  @field("imoneda") imoneda!: number | null;
  @field("moneda") moneda!: string | null;
  @field("manual") manual!: number | null;
  @field("cobrarflete") cobrarflete!: number | null;
  @field("flete") flete!: number | null;
  @field("tarifaflete") tarifaflete!: number | null;
  @field("valor") valor!: number | null;
  @field("pagado") pagado!: number | null;
  @field("saldo") saldo!: number | null;

  /** 0 sin imprimir · 1 original · 2+ copias. Es el campo de cierre del sync. */
  @field("impreso") impreso!: number;
  @field("origen") origen!: number;
  @field("agregado") agregado!: number | null;

  /** Mientras no se imprima, el recibo se queda en el teléfono. */
  get retenido(): boolean {
    return (this.impreso ?? 0) === 0;
  }
}

// ─── Local ──────────────────────────────────────────────────────────────────

/** "Eventos" y no "bitácora": esa palabra es el cuaderno del recibidor. */
export class Evento extends Model {
  static readonly table = "eventos";
  @field("tipo") tipo!: string;
  @field("ok") ok!: boolean;
  @field("resumen") resumen!: string;
  @field("detalle") detalle!: string | null;
  @field("creado_en") creadoEn!: number;
}

export const MODEL_CLASSES = [
  CastigoBroca, CastigoCosecha, RecibidorNivel, Precio, Talonario, Nivel,
  Zona, TipoCafe, TipoCastigo, Calidad, Certificado, Cosecha,
  Recibidor, Transportista, Provincia, Canton, Distrito,
  Productor, Finca, Cuota, CuotaEntregador,
  Bitacora, Recibo, Remedida, RemedidaRuta, Evento,
];
