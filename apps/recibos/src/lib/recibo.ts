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
import type { CampoDefecto } from "./defectos";
import type {
  Bitacora,
  CastigoBroca,
  CastigoCosecha,
  Compania,
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

/**
 * Colones. Es `sy_Moneda.Moneda = 2`, y es la moneda de todo recibo de café en el país.
 *
 * Está acá como constante y no como catálogo bajado porque no es una elección del
 * recibidor: el café se recibe en colones y el productor firma un papel en colones. Lo
 * que sí varía —el precio de la fanega— viene del catálogo `precios`. Ver `imoneda` más
 * abajo, donde se explica por qué esto no puede quedar nulo.
 */
const MONEDA_LOCAL = 2;

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

/**
 * De qué talonario salió este número.
 *
 * El id del talonario es el `id` del registro local, porque la proyección lo baja como
 * `CONVERT(NVARCHAR(30), base.Id) AS id` — o sea que el id de WatermelonDB **es** el
 * `rc_Talonario.Id` del servidor. No hace falta llevar una columna aparte.
 *
 * Con varios talonarios abiertos —pasa cuando a un recibidor se le asigna un rango nuevo
 * sin cerrar el anterior— se elige el que CUBRE el número. Si ninguno lo cubre se
 * devuelve null en vez de adivinar: un talonario equivocado es peor que ninguno, porque
 * cuadraría un rango con recibos que no le pertenecen.
 */
async function talonarioDe(numero: string): Promise<number | null> {
  const { recibidor, cosecha } = useSesion.getState();
  const talonarios = await database
    .get<Talonario>("talonarios")
    .query(Q.where("recibidor", recibidor ?? ""), Q.where("cosecha", cosecha ?? ""))
    .fetch();

  if (talonarios.length === 0) return null;

  const elegido =
    talonarios.length === 1
      ? talonarios[0]
      : talonarios.find((t) => {
          const seq = secuenciaDe(numero);
          const desde = Number.parseInt((t.inicio ?? "").trim(), 10);
          const hasta = Number.parseInt((t.final ?? "").trim(), 10);
          return (
            seq != null &&
            Number.isFinite(desde) &&
            Number.isFinite(hasta) &&
            seq >= desde &&
            seq <= hasta
          );
        });

  const id = Number(elegido?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
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

// ─── Marcar impreso ─────────────────────────────────────────────────────────

/**
 * Sube en uno el contador de impresiones. Es lo que suelta el recibo hacia el servidor:
 * `impreso` es el CampoCierre de la colección, así que hasta acá el recibo vivía sólo en
 * el teléfono.
 *
 * ⚠️ SE MARCA AUNQUE NO SE SEPA SI SALIÓ EL PAPEL, y es deliberado. Android entrega el
 * documento al driver y devuelve el control de inmediato; no hay confirmación de que la
 * 3nStar tuviera rollo. Las dos opciones son malas y ésta lo es menos:
 *
 *   - No marcar hasta confirmar → el recibo nunca sincroniza, porque la confirmación no
 *     existe. Se quedaría en el teléfono para siempre.
 *   - Marcar de una → si el papel no salió, el recibidor ANULA y vuelve a digitar. La
 *     anulación exige justamente que esté impreso, deja el número en la secuencia y el
 *     productor se va con su recibo. Es el flujo que la operación ya usa.
 *
 * El contador (y no un booleano) es lo que hace que la segunda impresión diga COPIA, igual
 * que en el web.
 */
export async function marcarImpreso(recibo: Recibo): Promise<void> {
  await database.write(async () => {
    await recibo.update((r) => {
      r.impreso = (r.impreso ?? 0) + 1;
    });
  });
}

// ─── El productor genérico ──────────────────────────────────────────────────

/**
 * Quién entregó: un productor registrado, o alguien que todavía no lo es.
 *
 * Al recibidor puede llegar alguien nuevo. **No se le puede crear como productor ahí** —
 * el alta exige revisión fiscal— pero el café SÍ se le recibe. Se usa el productor
 * genérico ("PENDIENTE"), y el nombre y la identificación de la persona se guardan EN EL
 * RECIBO, que es lo que el legacy perdía: capturaba esos datos sólo para el papel y nunca
 * salían del dispositivo. Ver docs/app-recibos-design.md §7.bis.
 *
 * ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
 *
 * De `ge_companias.ben_socio_generico`, o sea de la base de CADA beneficio, y no del APK.
 *
 * Antes venía compilado en `clientes.json`, con el mismo número —5109— para los seis
 * clientes. Ese es el PENDIENTE de Altura; en la base de otro cliente el 5109 es un
 * productor cualquiera. El café de alguien sin registrar se le habría cargado a una
 * persona real, con el recibo impreso y firmado y sincronizando sin un solo error.
 *
 * Y es el CÓDIGO, no el id, porque alguien lo teclea una vez al instalar: `5019` en vez
 * de `5109` es un productor válido pero equivocado; un `C00000` mal escrito no resuelve y
 * la app lo dice en pantalla. Un dato que no se puede verificar de un vistazo conviene
 * que falle fuerte.
 */
let idGenericoResuelto: number | null = null;
let codigoGenericoResuelto: string | null = null;

/**
 * Resuelve el código configurado contra los productores del teléfono. Se llama al abrir
 * la pantalla de recibo; el resultado queda en memoria porque no cambia durante la sesión.
 *
 * `null` ⇒ no hay genérico configurado, o el código no resuelve. En los dos casos la app
 * no ofrece la opción "No está registrado", que es preferible a ofrecerla y cargarle el
 * café a quien no corresponde.
 */
export async function resolverSocioGenerico(): Promise<number | null> {
  const empresas = await database.get<Compania>("companias").query().fetch();
  const codigo = (empresas[0]?.socioGenerico ?? "").trim();
  if (!codigo) {
    idGenericoResuelto = null;
    codigoGenericoResuelto = null;
    return null;
  }

  const encontrados = await database
    .get<Productor>("productores")
    .query(Q.where("codigo", codigo))
    .fetch();

  idGenericoResuelto = encontrados[0] ? Number(encontrados[0].id) : null;
  codigoGenericoResuelto = idGenericoResuelto != null ? codigo : null;
  if (idGenericoResuelto == null) {
    console.info(
      `[generico] el codigo "${codigo}" de ge_companias.ben_socio_generico no resuelve ` +
        "a ningun productor del telefono"
    );
  }
  return idGenericoResuelto;
}

export function esGenerico(idSocio: number | null): boolean {
  return idSocio != null && idSocio === idGenericoResuelto;
}

/** `null` ⇒ no está configurado o no resuelve, y la app no ofrece la opción. */
export function idSocioGenerico(): number | null {
  return idGenericoResuelto;
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
  /**
   * Defectos de control de calidad, sólo los que la empresa registra.
   *
   * ⚠️ APARTE DE `medida`, que es lo que entra al CÁLCULO. Éstos no castigan, y
   * mezclarlos invitaría a que alguien los pase al motor y cambie números ya
   * validados contra la cosecha entera. Ver `lib/defectos.ts`.
   */
  extras: Partial<Record<CampoDefecto, number>>;
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
  const idTalonario = await talonarioDe(numero);
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
      // De qué talonario salió el número. En el web lo pone el hook del consecutivo, que
      // acá no corre porque el número lo asigna el teléfono: sin esto quedaba en NULL y
      // el recibo del móvil era el único sin poder rastrear su talonario.
      r.idtalonario = idTalonario;
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

  r.idSocio = d.productor ? Number(d.productor.id) : idSocioGenerico();
  if (r.idSocio == null) {
    throw new Error(
      "Este APK se compiló sin el productor genérico, así que no puede recibirle a " +
        "alguien no registrado."
    );
  }
  /**
   * El código del productor, y con el genérico el CÓDIGO DEL GENÉRICO — no null.
   *
   * ⚠️ Antes quedaba nulo: al elegir "No está registrado" no hay productor seleccionado y
   * `d.productor?.codigo` no da nada. Eso dejaba la fila distinta de como la guarda el
   * legacy —que escribe `idsocio = 5109` Y `codigo = 'C00000'`— y, peor, el servidor no
   * podía reconocer que era el genérico para exceptuarlo de la validación de zona: el
   * recibo rebotaba con "La zona del precio no concuerda", con el papel ya firmado.
   */
  r.codigo = d.productor?.codigo ?? codigoGenericoResuelto;
  // El nombre se guarda EN EL RECIBO y la impresión sale siempre de acá, nunca del
  // maestro: una copia impresa meses después tiene que reproducir el original que firmó
  // la persona, aunque el productor se haya corregido desde entonces.
  r.nombre = d.nombre;
  r.cedula = d.cedula;
  r.idFinca = d.idFinca;
  r.idCertificado = d.idCertificado;
  r.cldd = d.cldd;
  // Los que la empresa no usa quedan en cero, que es su valor en la base.
  r.pinton = d.extras.pinton ?? 0;
  r.granopasa = d.extras.granopasa ?? 0;
  r.flotenegro = d.extras.flotenegro ?? 0;
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

  /**
   * ⚠️ EL FLETE DEL PRECIO ES UNA TARIFA, NO UNA BANDERA.
   *
   * `re_precios.flete` viene en colones —en esta cosecha hay 50,00 y −325,00— y
   * `recibos.flete` es un TINYINT. Antes se asignaba uno al otro directo: un −325 en un
   * TINYINT no cabe. Nunca explotó porque el servidor descartaba el campo por otro motivo,
   * pero era un error dormido esperando que alguien lo "arreglara" registrándolo.
   *
   * Lo que se guarda es la MISMA decisión que toma el compute del web
   * (`RcReciboComputeController:148`): si el precio trae tarifa, este recibo cobra flete.
   * El monto no se guarda con el recibo —en los 38.550 de la cosecha `tarifaflete` está
   * en cero— porque se resuelve por `idreprecio`, que sí viaja con la fila.
   */
  r.cobrarflete = (d.precio?.flete ?? 0) !== 0 ? 1 : 0;

  /**
   * `flete` acompaña a `cobrarflete` con el mismo valor.
   *
   * Son dos banderas para lo mismo y es cosa del legacy, no un diseño: en los recibos de
   * la cosecha que tienen `flete` lleno, vale exactamente lo que vale `cobrarflete`.
   * Escribirlo evita que el recibo del móvil sea el único con la columna en NULL.
   *
   * ⚠️ NO CONFUNDIR CON `re_precios.flete`, que es una TARIFA en colones. Asignar una a la
   * otra fue un error real: `recibos.flete` es TINYINT y la tarifa de la zona 5 es −325.
   */
  r.flete = r.cobrarflete;

  /**
   * ⚠️ LA MONEDA NUNCA VA VACÍA, AUNQUE NO HAYA PRECIO.
   *
   * `imoneda` es obligatorio en el servidor (`mt.Fields`, etiquetado "Moneda"), y antes
   * salía `null` cuando el productor no tenía precio genérico. El resultado no era un
   * recibo sin precio: era un recibo que **el servidor rechazaba entero**, con
   * `VALIDATION_ERROR: "Moneda es obligatorio"`, en cada sync, para siempre.
   *
   * Y le tocaba justo a los que más lo necesitan: 4.938 productores de las zonas 1, 2, 4
   * y 5 no tienen precio genérico cargado, así que sus recibos salían impresos, firmados
   * y entregados, y no subían nunca. En papel todo se veía bien.
   *
   * El arreglo es separar las dos cosas: **la moneda no es el precio**. Cuál es la
   * moneda del beneficio se sabe siempre —Altura recibe en colones y los 38.550 recibos
   * de la cosecha lo confirman: `imoneda = 2`, sin una sola excepción—; lo que puede
   * faltar es cuánto vale la fanega, y eso se resuelve en la oficina.
   */
  r.imoneda = d.precio?.moneda ?? MONEDA_LOCAL;

  /**
   * El código de una letra del legacy, que acompaña a `imoneda` en la misma fila.
   *
   * Se llena sólo para colones porque es el único valor que existe en la base: los
   * 38.530 recibos con moneda tienen `'C'`, y ninguno en dólares. Inventar la letra del
   * dólar sería adivinar un dato que nadie puede verificar hoy — mejor dejarlo nulo, que
   * se nota, que ponerle una letra equivocada, que no.
   */
  r.moneda = r.imoneda === MONEDA_LOCAL ? "C" : null;
  r.valor = d.precio ? Number((d.calculo.cantidad * d.precio.monto).toFixed(2)) : null;
}
