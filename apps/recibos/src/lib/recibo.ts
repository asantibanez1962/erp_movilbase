import { Q } from "@nozbe/watermelondb";
import {
  calcularRecibo,
  buscarPrecio,
  type Catalogos,
  type EntradaCalculo,
  type ResultadoCalculo,
} from "@erp/recibos-calc";
import { database } from "./db";
import { crearConUuid } from "./crear";
import { useSesion } from "./sesion";
import { cliente } from "../branding";
import type {
  Bitacora,
  CastigoBroca,
  CastigoCosecha,
  Cuota,
  CuotaEntregador,
  Finca,
  Precio,
  Productor,
  Recibidor,
  Recibo,
  RecibidorNivel,
  Talonario,
} from "../db/models";

/**
 * Todo lo que decide un recibo antes de imprimirlo: su número, sus defaults y su
 * cálculo. Nada de esto toca la red — el recibo se emite y se entrega firmado en un
 * recibidor donde puede no haber señal, y ése es el problema central de la app.
 */

// ─── Numeración ─────────────────────────────────────────────────────────────

/**
 * El próximo número del recibidor: `recibidor(3) + 6 dígitos`, el mismo formato que arma
 * el modo automático del servidor.
 *
 * ⚠️ LA REGLA ES `MAX(local, servidor)` Y LAS DOS MITADES IMPORTAN.
 *
 *  - El local, porque el servidor puede venir atrasado —una sincronización que no
 *    llegó— y el teléfono no puede reusar un número que ya imprimió.
 *  - El del servidor, porque un teléfono reinstalado, uno con la base rebajada o un
 *    equipo de reemplazo arrancan sin historia local y repetirían números ya entregados
 *    en papel. Eso se descubre días después, en la oficina, con el papel ya firmado.
 *
 * ⚠️ `rc_Talonario.ultimo` NO es el último usado: es el PRÓXIMO. El procedimiento del
 * servidor consume `ultimo` y después lo incrementa. Leerlo como "el último" y sumarle
 * uno salta un número por recarga, y eso aparece como huecos en la numeración.
 */
export async function proximoNumero(): Promise<string> {
  const { recibidor, cosecha } = useSesion.getState();
  if (!recibidor || !cosecha) throw new Error("Falta el contexto de recibidor y cosecha.");

  const locales = await database
    .get<Recibo>("recibos")
    .query(Q.where("recibidor", recibidor), Q.where("cosecha", cosecha))
    .fetch();

  // El máximo local + 1. Sin recibos locales queda en 0 y manda el del servidor.
  const maxLocal = locales.reduce((m, r) => {
    const seq = secuenciaDe(r.recibo);
    return seq != null && seq > m ? seq : m;
  }, 0);
  const proximoLocal = maxLocal > 0 ? maxLocal + 1 : 0;

  const talonarios = await database
    .get<Talonario>("talonarios")
    .query(Q.where("recibidor", recibidor), Q.where("cosecha", cosecha))
    .fetch();

  // ⚠️ LA CONDICIÓN ES QUE EXISTA LA FILA, NO QUE SU VALOR SEA > 0. Un talonario recién
  // sembrado tiene `ultimo = '000000'`, y confundir "arranca en cero" con "no hay
  // talonario" bloquea justo el primer recibo de un recibidor nuevo — que es cuando
  // nadie tiene todavía forma de saber si el problema es de datos o de la app.
  if (talonarios.length === 0 && proximoLocal === 0) {
    throw new Error(
      "No hay talonario para este recibidor. Sincronizá antes de emitir el primer " +
        "recibo; si sigue faltando, hay que crearlo desde el web."
    );
  }

  const delServidor = talonarios.reduce((m, t) => {
    const n = Number.parseInt((t.ultimo ?? "").trim(), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);

  // El piso en 1 es de la operación, no del código: un recibo numerado `063-000000` no
  // se le entrega a nadie. El servidor arranca su seed en el mismo valor (v1.71/RC/36),
  // así que las dos numeraciones coinciden desde el primer recibo.
  const proximo = Math.max(proximoLocal, delServidor, 1);

  return `${recibidor.padStart(3, "0")}${String(proximo).padStart(6, "0")}`;
}

/** Los 6 últimos dígitos, que es donde vive la secuencia venga con guión o sin él. */
function secuenciaDe(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const n = Number.parseInt(numero.trim().slice(-6), 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Defaults al elegir el productor ────────────────────────────────────────

export interface DefaultsProductor {
  idFinca: number | null;
  /** Sale de la FINCA, no se digita. Por eso un productor genérico no puede tenerlo. */
  cldd: number;
  idCertificado: number | null;
  /**
   * Los certificados a los que ESTE productor tiene derecho, y no el catálogo entero.
   *
   * El certificado no es una etiqueta libre: es contra qué cuota se le recibe el café.
   * Ofrecer los ocho del catálogo invita a elegir uno que el productor no tiene, y eso
   * no da error — da un recibo imputado a una cuota ajena, que se descubre cuadrando
   * certificados en la oficina.
   */
  certificados: number[];
}

/**
 * Reproduce offline lo que el web resuelve con `sp_rc_recibo_finca_default`:
 * la primera finca del socio, su `cldd`, y el certificado de su cuota ACTIVA —propia o
 * a través del grupo de entregadores— para la cosecha en curso.
 *
 * Se replica el `ORDER BY` del original, no un criterio propio: si el web y el móvil
 * eligieran fincas distintas para el mismo productor, los dos recibos serían válidos y
 * nadie notaría la diferencia hasta cuadrar certificados.
 */
export async function defaultsDeProductor(idSocio: number): Promise<DefaultsProductor> {
  const { cosecha } = useSesion.getState();

  const fincas = await database
    .get<Finca>("fincas")
    .query(Q.where("id_socio", idSocio), Q.sortBy("id", Q.asc))
    .fetch();
  const finca = fincas[0] ?? null;

  const cuotas = await database
    .get<Cuota>("cuotas")
    .query(Q.where("cosecha", cosecha ?? ""), Q.where("activo", 1))
    .fetch();

  // Del socio, o de un grupo del que sea entregador activo.
  const propias = cuotas.filter((c) => c.idSocio === idSocio);
  let elegidas = propias;
  if (elegidas.length === 0) {
    const grupos = await database
      .get<CuotaEntregador>("cuota_entregadores")
      .query(Q.where("id_socio", idSocio), Q.where("activo", 1))
      .fetch();
    const ids = new Set(grupos.map((g) => g.idCuota));
    elegidas = cuotas.filter((c) => ids.has(c.idCuota));
  }
  // ORDER BY pc.IdCertificado, igual que el procedimiento.
  elegidas.sort((a, b) => a.idCertificado - b.idCertificado);

  return {
    idFinca: finca ? Number(finca.id) : null,
    cldd: finca?.cldd ?? 0,
    idCertificado: elegidas[0]?.idCertificado ?? null,
    certificados: [...new Set(elegidas.map((c) => c.idCertificado))],
  };
}

// ─── Cálculo ────────────────────────────────────────────────────────────────

/** Los catálogos que necesita `recibos-calc`, leídos del SQLite local. */
export async function catalogosDelCalculo(): Promise<Catalogos> {
  const [broca, cosecha, nivel] = await Promise.all([
    database.get<CastigoBroca>("castigos_broca").query().fetch(),
    database.get<CastigoCosecha>("castigos_cosecha").query().fetch(),
    database.get<RecibidorNivel>("recibidor_nivel").query().fetch(),
  ]);
  return {
    castigosBroca: broca.map((c) => ({
      granosbroca: c.granosbroca,
      cantidad: c.cantidad,
      cuartilloscastigo: c.cuartilloscastigo,
    })),
    castigosCosecha: cosecha.map((c) => ({
      cosecha: c.cosecha,
      nivel: c.nivel,
      tipocastigo: c.tipocastigo,
      topeaceptado: c.topeaceptado,
      pctcastigo: c.pctcastigo,
    })),
    recibidorNivel: nivel.map((n) => ({
      recibidor: n.recibidor,
      cosecha: n.cosecha,
      nivel: n.nivel,
    })),
  };
}

/** El nivel del recibidor en la cosecha. Entra al cálculo de los castigos. */
export async function nivelDelRecibidor(): Promise<number | null> {
  const { recibidor, cosecha } = useSesion.getState();
  const filas = await database
    .get<RecibidorNivel>("recibidor_nivel")
    .query(Q.where("recibidor", recibidor ?? ""), Q.where("cosecha", cosecha ?? ""))
    .fetch();
  return filas[0]?.nivel ?? null;
}

export interface MedidaCapturada {
  cantidadinicial: number;
  cuartillosinicial: number;
  granosbrocados: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
}

/**
 * El cálculo, con `errormedidor` SIEMPRE en 0.
 *
 * No es un default que se pueda cambiar: `errormedidor` es del que hace recibos a mano, y
 * su ausencia es lo que mantiene la invariante de que toda cantidad sea múltiplo de un
 * cuartillo. Capturarlo en el móvil rompería esa garantía sin que nadie lo note.
 */
export function calcular(
  medida: MedidaCapturada,
  nivel: number,
  cat: Catalogos
): ResultadoCalculo {
  const { recibidor, cosecha } = useSesion.getState();
  const entrada: EntradaCalculo = {
    cosecha: cosecha ?? "",
    recibidor: recibidor ?? "",
    nivel,
    ...medida,
    errormedidor: 0,
  };
  return calcularRecibo(entrada, cat);
}

/** El precio, con el mismo orden de preferencia que `f_rc_busca_precio`. */
export async function precioDe(opts: {
  tipoCafe: string;
  calidad: string;
  codigoProductor: string;
  tipoProductor: string;
}) {
  const { recibidor, cosecha } = useSesion.getState();
  const [precios, recibidores] = await Promise.all([
    database.get<Precio>("precios").query().fetch(),
    database.get<Recibidor>("recibidores").query(Q.where("recibidor", recibidor ?? "")).fetch(),
  ]);

  return buscarPrecio(
    {
      cosecha: cosecha ?? "",
      tipocafe: opts.tipoCafe,
      calidad: opts.calidad,
      // ⚠️ `codigozona` y no `zona`: en rc_recibidores la columna `zona` es otra escala.
      zona: recibidores[0]?.codigozona?.trim() ?? "",
      recibidor: recibidor ?? "",
      codigo: opts.codigoProductor,
      tipo: opts.tipoProductor,
    },
    precios.map((p) => ({
      idreprecio: p.idreprecio,
      cosecha: p.cosecha,
      tipocafe: p.tipocafe,
      calidad: p.calidad,
      zona: p.zona,
      recibidor: p.recibidor,
      tipo: p.tipo,
      codigo: p.codigo,
      monto: p.monto,
      moneda: p.moneda,
      recalcula: p.recalcula,
      flete: p.flete,
    }))
  );
}

/**
 * Corrige un recibo que TODAVÍA NO SE IMPRIMIÓ.
 *
 * Es la política `hasta-evento` con `impreso` como campo de cierre: mientras no salga en
 * papel, el recibo es trabajo en curso y se corrige; al imprimirse queda firme. La misma
 * condición que lo retiene en el teléfono es la que lo deja editar, y por eso no hay
 * forma de que un recibo ya sincronizado se pueda cambiar acá.
 *
 * El número NO se recalcula: se asignó al crearlo y es lo único que no cambia.
 */
export async function actualizarRecibo(recibo: Recibo, d: DatosRecibo): Promise<void> {
  if ((recibo.impreso ?? 0) >= 1) {
    throw new Error(
      "Este recibo ya se imprimió y no se puede modificar: el papel está en manos del " +
        "productor. Si hay que dejarlo sin efecto, se anula."
    );
  }

  await database.write(async () => {
    await recibo.update((r) => {
      aplicarDatos(r, d);
    });
  });
}

// ─── Anular ─────────────────────────────────────────────────────────────────

/**
 * Anula un recibo YA IMPRESO: pone las cantidades en cero y escribe `ANULADO`.
 *
 * ⚠️ SÓLO SI ESTÁ IMPRESO, y la restricción es lo que le da sentido. Un recibo sin
 * imprimir no salió del teléfono ni existe en papel: ése se corrige o se descarta, sin
 * dejar rastro. Anular es para cuando el papel YA está en manos del productor y hay que
 * dejar constancia de que ese número no vale.
 *
 * POR QUÉ SE ANULA EN VEZ DE BORRAR. Lo que importa es **preservar el número en la
 * secuencia**. Un recibo borrado deja un hueco imposible de distinguir de uno perdido, y
 * ésa es justo la duda cara: alguien tendría que salir a buscar un papel que nunca
 * existió. No es un caso raro — hay entre 900 y 1.250 anulados por cosecha.
 *
 * `recibos` NO tiene columna de anulación: sólo `observaciones` e `impreso`. Un recibo
 * anulado *es* uno con las cantidades en cero.
 *
 * El texto lo pone la app y no el recibidor, y eso es lo que hace la regla utilizable: la
 * oficina filtra por un valor conocido en vez de interpretar lo que tecleó cada quien.
 * Sin eso, un anulado y un cero legítimo son indistinguibles en la base.
 *
 * `impreso` NO se toca: el recibo se imprimió de verdad, y como sigue en 1 o más el sync
 * lo envía sin necesitar ninguna excepción a la retención.
 */
export const TEXTO_ANULADO = "ANULADO";

export async function anularRecibo(recibo: Recibo, motivo?: string): Promise<void> {
  if ((recibo.impreso ?? 0) < 1) {
    throw new Error(
      "Este recibo todavía no se imprimió, así que no hay nada que anular: se puede " +
        "descartar sin dejar rastro."
    );
  }
  if (esAnulado(recibo)) throw new Error("Este recibo ya está anulado.");

  await database.write(async () => {
    await recibo.update((r) => {
      r.cantidadinicial = 0;
      r.cuartillosinicial = 0;
      r.granosbrocados = 0;
      r.verdes = 0;
      r.flotemaduro = 0;
      r.floteseco = 0;
      r.broca = 0;
      r.cuartillosbroca = 0;
      r.rebajoverde = 0;
      r.cuartillosrebajoverde = 0;
      r.rebajoflote = 0;
      r.cuartillosrebajoflote = 0;
      r.rebajofloteseco = 0;
      r.cuartillosrebajofloteseco = 0;
      r.cantidad = 0;
      r.rcantidad = 0;
      r.rcantidadcuartillos = 0;
      // El valor también: un recibo anulado no puede quedar con monto.
      r.valor = 0;
      r.pagado = 0;
      r.saldo = 0;
      r.observaciones = [TEXTO_ANULADO, motivo?.trim()].filter(Boolean).join(" · ");
    });
  });
}

export function esAnulado(recibo: Recibo): boolean {
  return (recibo.observaciones ?? "").trim().toUpperCase().startsWith(TEXTO_ANULADO);
}

// ─── El productor genérico ──────────────────────────────────────────────────

/**
 * Quién entregó: un productor registrado, o alguien que todavía no lo es.
 *
 * Al recibidor puede llegar alguien nuevo. **No se le puede crear como productor ahí** —
 * el alta exige revisión fiscal— pero el café SÍ se le recibe. Se usa el productor
 * genérico ("PENDIENTE"), y el nombre y la identificación de la persona se guardan EN EL
 * RECIBO, que es lo que el legacy perdía: capturaba esos datos sólo para el papel y nunca
 * salían del dispositivo.
 *
 * El genérico se identifica por `idsocio` y no por código: el formato del código varía
 * por cliente (C00000 en unos, 00-00000 en otros) y no hay nada que parsear.
 */
export function esGenerico(idSocio: number | null): boolean {
  return idSocio != null && idSocio === cliente.idSocioGenerico;
}

/** `null` ⇒ el APK se compiló sin el dato y la app no ofrece la opción. */
export function idSocioGenerico(): number | null {
  return cliente.idSocioGenerico;
}

// ─── Alta ───────────────────────────────────────────────────────────────────

export interface DatosRecibo {
  bitacora: Bitacora;
  productor: Productor | null;
  /** Con genérico son obligatorios: un recibo impreso sin nadie identificado es peor
   *  que el estado actual, donde al menos se sabe que el dato está en el papel. */
  nombre: string;
  cedula: string;
  idFinca: number | null;
  idCertificado: number | null;
  cldd: number;
  calidad: string;
  tipoCafe: string;
  nivel: number;
  medida: MedidaCapturada;
  calculo: ResultadoCalculo;
  /** Texto libre del recibidor. Va impreso, así que se guarda con el recibo. */
  observaciones?: string | null;
  precio: { idreprecio: number; monto: number; moneda: number; flete: number } | null;
}

/**
 * Guarda el recibo. Nace con `impreso = 0`, y eso es lo que lo retiene en el teléfono:
 * `impreso` es el CampoCierre de la colección, así que un recibo sin imprimir no
 * sincroniza. Lo pone en 1 la impresión del ORIGINAL.
 */
export async function crearRecibo(d: DatosRecibo): Promise<Recibo> {
  const { recibidor, cosecha } = useSesion.getState();
  const numero = await proximoNumero();
  const ahora = Date.now();

  return database.write(async () =>
    crearConUuid<Recibo>("recibos", (r, uuid) => {
      r.clientUuid = uuid;
      r.idBitacora = d.bitacora.id;
      r.recibo = numero;
      r.fecha = ahora;
      r.recibidor = recibidor!;
      r.cosecha = cosecha!;
      // Nace SIN IMPRIMIR, y eso es lo que lo retiene en el teléfono: `impreso` es el
      // campo de cierre de la colección. Lo pone en 1 la impresión del ORIGINAL.
      r.impreso = 0;
      // origen=1 ⇒ vino del móvil. Lo usa la oficina para distinguirlo de un digitado.
      r.origen = 1;
      r.agregado = ahora;
      aplicarDatos(r, d);
    })
  );
}

/**
 * Los campos que crear y actualizar escriben IGUAL.
 *
 * Están en una sola función a propósito: cuando estaban duplicados, cualquier campo nuevo
 * había que acordarse de agregarlo en los dos lados, y olvidarlo del lado de la edición
 * no da error — simplemente ese dato deja de guardarse al corregir.
 */
function aplicarDatos(r: Recibo, d: DatosRecibo): void {
  r.idBitacora = d.bitacora.id;
  r.calidad = d.calidad;
  r.tipoCafe = d.tipoCafe;
  r.nivel = d.nivel;

  r.idSocio = d.productor ? Number(d.productor.id) : cliente.idSocioGenerico;
  if (r.idSocio == null) {
    throw new Error(
      "Este APK se compiló sin el productor genérico, así que no puede recibirle a " +
        "alguien no registrado."
    );
  }
  r.codigo = d.productor?.codigo ?? null;
  // El nombre se guarda EN EL RECIBO y la impresión sale siempre de acá, nunca del
  // maestro: una copia impresa meses después tiene que reproducir el original que firmó
  // la persona, aunque el productor se haya corregido desde entonces.
  r.nombre = d.nombre;
  r.cedula = d.cedula;
  r.idFinca = d.idFinca;
  r.idCertificado = d.idCertificado;
  r.cldd = d.cldd;
  r.observaciones = d.observaciones ?? null;

  r.cantidadinicial = d.medida.cantidadinicial;
  r.cuartillosinicial = d.medida.cuartillosinicial;
  r.granosbrocados = d.medida.granosbrocados;
  r.verdes = d.medida.verdes;
  r.flotemaduro = d.medida.flotemaduro;
  r.floteseco = d.medida.floteseco;

  r.broca = d.calculo.broca;
  r.cuartillosbroca = d.calculo.cuartillosbroca;
  r.rebajoverde = d.calculo.rebajoverde;
  r.cuartillosrebajoverde = d.calculo.cuartillosrebajoverde;
  r.rebajoflote = d.calculo.rebajoflote;
  r.cuartillosrebajoflote = d.calculo.cuartillosrebajoflote;
  r.rebajofloteseco = d.calculo.rebajofloteseco;
  r.cuartillosrebajofloteseco = d.calculo.cuartillosrebajofloteseco;
  r.cantidad = d.calculo.cantidad;
  r.rcantidad = d.calculo.rcantidad;
  r.rcantidadcuartillos = d.calculo.rcantidadcuartillos;

  // El precio y el valor NO se muestran ni se imprimen —el recibo del móvil no es un
  // documento de pago, eso se resuelve en el servidor— pero se guardan con la fila para
  // que el dato exista desde el origen.
  //
  // `valor = cantidad × precio`, la misma fórmula del servidor: se comprobó contra los
  // recibos de la cosecha (6 cajuelas × ₡6450 = ₡38 700). Ojo que multiplica `cantidad`
  // —el neto decimal— y no `rcantidad`, que son sólo las cajuelas enteras.
  r.idreprecio = d.precio?.idreprecio ?? null;
  r.precio = d.precio?.monto ?? null;
  r.imoneda = d.precio?.moneda ?? null;
  r.flete = d.precio?.flete ?? null;
  r.valor = d.precio ? Number((d.calculo.cantidad * d.precio.monto).toFixed(2)) : null;
}
