import { Q } from "@nozbe/watermelondb";
import { useAuthStore } from "@erp/shared-api";
import { database } from "./db";
import type { CampoDefecto } from "./defectos";
import { crearConUuid } from "./crear";
import { useSesion } from "./sesion";
import { TEXTO_ANULADO } from "./recibo";
import type { Remedida, RemedidaRuta } from "../db/models";

/**
 * La remedida: el camión que llega de los recibidores, medido en el sitio de recepción.
 *
 * Ese sitio NO tiene PC ni red — de ahí que se capture en el teléfono. Hoy se anota en
 * papel y alguien lo redigita después, que es donde se cuelan los errores y el atraso.
 *
 * ⚠️ ACÁ NO SE CALCULA NADA, al revés que en el recibo. Los porcentajes se registran tal
 * como se miden y el servidor recompone los agregados del día por su cuenta
 * (tr_rc_remedida_remdirty marca el día como sucio al insertar). Meter un cálculo local
 * sería inventar una segunda verdad.
 */

/** Todas las del sifón en la cosecha, la más nueva primero. */
export function remedidasDelSifon(sifon: string) {
  const { cosecha } = useSesion.getState();
  return database
    .get<Remedida>("remedidas")
    .query(
      Q.where("sifon", sifon),
      Q.where("cosecha", cosecha ?? ""),
      Q.sortBy("recibo", Q.desc)
    );
}

export function rutasDe(idRemedida: string) {
  return database
    .get<RemedidaRuta>("remedida_rutas")
    .query(Q.where("id_remedida", idRemedida), Q.sortBy("recibidor", Q.asc));
}

// ─── Numeración ─────────────────────────────────────────────────────────────

/**
 * El próximo número: `sifón(3) + 6 dígitos`.
 *
 * POR QUÉ UN PREFIJO. En el servidor la remedida lleva un consecutivo ÚNICO por cosecha
 * —van del 1 al 2 125 este año— que se asigna con MERGE + HOLDLOCK. Sin prefijo por
 * origen, dos lugares que numeren a la vez chocan; y como el papel se entrega firmado,
 * eso no se arregla después. El sitio de la remedida es el SIFÓN, que ya se anota en el
 * documento, así que sirve de espacio propio igual que el recibidor en el recibo.
 *
 * ⚠️ NO HACE FALTA UN TALONARIO como el del recibo. Acá el teléfono se baja las remedidas
 * de su sifón —unas 2 000 por cosecha, nada— así que el máximo del servidor lo tiene en
 * la mano. Es la misma regla `MAX(local, servidor)` sin una tabla de contadores que
 * mantener: al pull volver a traer las suyas, un equipo reinstalado recupera el contador
 * solo.
 *
 * Las remedidas del móvil arrancan en 1 000 001 y las digitadas van del 1 al 2 125:
 * imposible que se crucen, y se distinguen de un vistazo.
 */
export async function proximoNumero(sifon: string): Promise<string> {
  if (!sifon.trim()) throw new Error("Falta el sifón: de él sale el número de la remedida.");

  const propias = await remedidasDelSifon(sifon).fetch();
  const maximo = propias.reduce((m, r) => {
    const seq = secuenciaDe(r.recibo);
    return seq != null && seq > m ? seq : m;
  }, 0);

  return `${sifon.trim().padStart(3, "0")}${String(maximo + 1).padStart(6, "0")}`;
}

/** Los 6 últimos dígitos, que es donde vive la secuencia. */
function secuenciaDe(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const n = Number.parseInt(numero.trim().slice(-6), 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Alta y edición ─────────────────────────────────────────────────────────

export interface DatosRemedida {
  sifon: string;
  calidad: string | null;
  tipocafe: string | null;
  transportista: number | null;
  placa: string | null;
  angarilla: number | null;
  /** Cajuelas enteras. */
  cajuelas: number;
  /** 0–3. Cada uno vale 0,25 de cajuela. */
  cuartillos: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  granosbrocados: number;
  /**
   * Defectos de control de calidad, sólo los que la empresa registra.
   *
   * ⚠️ APARTE DE `medida`, que es lo que entra al CÁLCULO. Éstos no castigan, y
   * mezclarlos invitaría a que alguien los pase al motor y cambie números ya
   * validados contra la cosecha entera. Ver `lib/defectos.ts`.
   */
  extras: Partial<Record<CampoDefecto, number>>;
  observaciones: string | null;
  /** Los recibidores de los que venía el camión. De 1 a 17 en la práctica. */
  recibidores: string[];
}

/**
 * Crea la remedida y sus rutas en una sola escritura.
 *
 * Van juntas a propósito: una remedida sin recibidores no dice de dónde vino el café, y
 * dejar las dos escrituras separadas abre la puerta a que la segunda falle y quede un
 * documento a medias que igual se puede imprimir.
 */
export async function crearRemedida(d: DatosRemedida): Promise<Remedida> {
  const { cosecha, recibidor } = useSesion.getState();
  if (!cosecha) throw new Error("Falta la cosecha.");

  const numero = await proximoNumero(d.sifon);
  const usuario = useAuthStore.getState().user?.usuario ?? null;
  const ahora = Date.now();

  let creada!: Remedida;
  await database.write(async () => {
    creada = await crearConUuid<Remedida>("remedidas", (r, uuid) => {
      r.clientUuid = uuid;
      r.recibo = numero;
      r.sifon = d.sifon.trim();
      // El recibidor del contexto queda como referencia de quién capturó; los del camión
      // van en las rutas.
      r.recibidor = recibidor;
      r.cosecha = cosecha;
      r.fecha = ahora;
      // El medidor es el usuario de la app: es quien mide, y pedirlo sería pedir algo que
      // ya se sabe.
      r.medidor = usuario;
      // Nace SIN IMPRIMIR, y eso es lo que la retiene en el teléfono.
      r.impreso = 0;
      aplicar(r, d);
    });

    await Promise.all(
      d.recibidores.map((codigo) =>
        crearConUuid<RemedidaRuta>("remedida_rutas", (x, uuid) => {
          x.clientUuid = uuid;
          x.idRemedida = creada.id;
          x.recibidor = codigo;
        })
      )
    );
  });

  return creada;
}

/**
 * Corrige una remedida que TODAVÍA NO SE IMPRIMIÓ.
 *
 * Misma regla que el recibo: mientras no salga en papel es trabajo en curso; al
 * imprimirse queda firme. Y como es la misma condición que la retiene en el teléfono, una
 * remedida ya sincronizada no se puede editar por construcción.
 */
export async function actualizarRemedida(
  remedida: Remedida,
  d: DatosRemedida
): Promise<void> {
  if ((remedida.impreso ?? 0) >= 1) {
    throw new Error(
      "Esta remedida ya se imprimió y no se puede modificar. Si hay que dejarla sin " +
        "efecto, se anula."
    );
  }

  const previas = await rutasDe(remedida.id).fetch();

  await database.write(async () => {
    await remedida.update((r) => aplicar(r, d));

    // Las rutas se rehacen: son una lista de códigos sin datos propios, así que
    // compararlas una a una para decidir altas y bajas costaría más de lo que ahorra.
    await Promise.all(previas.map((x) => x.destroyPermanently()));
    await Promise.all(
      d.recibidores.map((codigo) =>
        crearConUuid<RemedidaRuta>("remedida_rutas", (x, uuid) => {
          x.clientUuid = uuid;
          x.idRemedida = remedida.id;
          x.recibidor = codigo;
        })
      )
    );
  });
}

function aplicar(r: Remedida, d: DatosRemedida): void {
  r.calidad = d.calidad;
  r.tipocafe = d.tipocafe;
  r.transportista = d.transportista;
  r.placa = d.placa;
  r.angarilla = d.angarilla;
  // El servidor guarda una sola cantidad decimal: 29,50 son 29 cajuelas y 2 cuartillos.
  // Se compone acá para que la pantalla pueda seguir capturando en las dos unidades con
  // que se mide de verdad.
  r.cantidad = Number((d.cajuelas + d.cuartillos * 0.25).toFixed(2));
  r.verdes = d.verdes;
  r.flotemaduro = d.flotemaduro;
  r.floteseco = d.floteseco;
  r.granosbrocados = d.granosbrocados;
  // Los que la empresa no usa quedan en cero, que es su valor en la base.
  r.pinton = d.extras.pinton ?? 0;
  r.granopasa = d.extras.granopasa ?? 0;
  r.flotenegro = d.extras.flotenegro ?? 0;
  r.observaciones = d.observaciones;
}

/** Descompone la cantidad guardada de vuelta en cajuelas y cuartillos. */
export function partir(cantidad: number): { cajuelas: number; cuartillos: number } {
  const cajuelas = Math.floor(cantidad);
  return {
    cajuelas,
    cuartillos: Math.round((cantidad - cajuelas) / 0.25),
  };
}

// ─── Anular ─────────────────────────────────────────────────────────────────

/**
 * Anula una remedida YA IMPRESA: cantidades en cero y `ANULADO` en observaciones.
 *
 * ⚠️ SÓLO SI ESTÁ IMPRESA, igual que el recibo. Una sin imprimir no salió del teléfono ni
 * existe en papel: ésa se corrige o se descarta. Anular es para cuando el documento ya
 * está en la calle y hay que dejar constancia de que ese número no vale — lo que importa
 * es PRESERVAR EL NÚMERO, porque un hueco es indistinguible de un documento perdido.
 *
 * Las rutas se borran: sin cantidad, decir de qué recibidores venía sólo confunde a quien
 * después sume por recibidor.
 */
export async function anularRemedida(remedida: Remedida, motivo?: string): Promise<void> {
  if ((remedida.impreso ?? 0) < 1) {
    throw new Error(
      "Esta remedida todavía no se imprimió, así que no hay nada que anular: se puede " +
        "descartar sin dejar rastro."
    );
  }
  if (esAnulada(remedida)) throw new Error("Esta remedida ya está anulada.");

  const rutas = await rutasDe(remedida.id).fetch();

  await database.write(async () => {
    await remedida.update((r) => {
      r.cantidad = 0;
      r.verdes = 0;
      r.flotemaduro = 0;
      r.floteseco = 0;
      r.granosbrocados = 0;
      r.angarilla = 0;
      r.observaciones = [TEXTO_ANULADO, motivo?.trim()].filter(Boolean).join(" · ");
    });
    await Promise.all(rutas.map((x) => x.destroyPermanently()));
  });
}

/**
 * Sube en uno el contador de impresiones. Es lo que suelta la remedida hacia el servidor:
 * `impreso` es el CampoCierre de la colección, así que hasta acá vivía sólo en el teléfono.
 *
 * ⚠️ Se marca aunque no se sepa si salió el papel — `printAsync` resuelve al abrir el
 * diálogo, no al imprimir. Es la misma decisión que en el recibo, y la recuperación es la
 * misma: anular y volver a digitar. Ver `marcarImpreso` en `recibo.ts`.
 */
export async function marcarRemedidaImpresa(remedida: Remedida): Promise<void> {
  await database.write(async () => {
    await remedida.update((r) => {
      r.impreso = (r.impreso ?? 0) + 1;
    });
  });
}

export function esAnulada(remedida: Remedida): boolean {
  return (remedida.observaciones ?? "").trim().toUpperCase().startsWith(TEXTO_ANULADO);
}
