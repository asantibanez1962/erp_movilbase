import { Q } from "@nozbe/watermelondb";
import { useAuthStore } from "@erp/shared-api";
import { describirFallos } from "@erp/shared-sync";
import { database } from "./db";
import { useSesion } from "./sesion";
import { syncNow } from "./sync";
import type { Bitacora, Recibo } from "../db/models";

/**
 * La jornada de trabajo en un recibidor.
 *
 * VOCABULARIO — la palabra "bitácora" nombra cuatro cosas distintas en este sistema, y
 * ésta es UNA de ellas: la jornada de un recibidor (`re_Bitacora_recibos`). No es la
 * bitácora de auditoría del móvil, ni `bitacora_recibos` (el versionado de un recibo),
 * ni la bitácora de precios. Ver §1 del design doc.
 *
 * NADA SALE DEL TELÉFONO HASTA EL CIERRE, y eso lo decide la operación, no el software:
 * el camión se lleva el papel, y el envío al servidor es un solo acto con la bitácora y
 * sus recibos juntos. Como consecuencia el padre nunca llega después que sus hijos y
 * todo es alta — no hay updates que resolver.
 */

/** Abierta ⇔ `horaFinal` nula. Una condición sobre los datos no puede quedar
 *  inconsistente con ellos; un flag aparte, sí. */
export function bitacorasAbiertas() {
  const { recibidor, cosecha } = useSesion.getState();
  return database
    .get<Bitacora>("bitacoras")
    .query(
      Q.where("recibidor", recibidor ?? ""),
      Q.where("cosecha", cosecha ?? ""),
      Q.where("hora_final", null),
      Q.sortBy("fecha", Q.desc)
    );
}

/** Todas las del recibidor y la cosecha en curso, abiertas primero. */
export function todasLasBitacoras() {
  const { recibidor, cosecha } = useSesion.getState();
  return database
    .get<Bitacora>("bitacoras")
    .query(
      Q.where("recibidor", recibidor ?? ""),
      Q.where("cosecha", cosecha ?? ""),
      Q.sortBy("fecha", Q.desc)
    );
}

export function recibosDe(idBitacora: string) {
  return database
    .get<Recibo>("recibos")
    .query(Q.where("id_bitacora", idBitacora), Q.sortBy("recibo", Q.asc));
}

export interface DatosApertura {
  tipocafe: string | null;
  transportista: string | null;
  placacamion: string | null;
  observaciones: string | null;
}

/**
 * Abre la jornada. Es local y no toca la red: a las cinco de la mañana en un recibidor
 * puede no haber señal, y esperar a tenerla para poder empezar a recibir café no es una
 * opción.
 *
 * `medidor` se llena solo con el usuario de la app — es quien mide, y pedirlo sería
 * pedir algo que ya sabemos. ⚠️ No confundirlo con el medidor de la remedida.
 *
 * Puede haber VARIAS abiertas a la vez: algunos clientes separan la jornada por
 * categoría de café. Por eso esta función no valida que no haya otra abierta.
 */
export async function abrirBitacora(datos: DatosApertura): Promise<Bitacora> {
  const { recibidor, cosecha } = useSesion.getState();
  if (!recibidor || !cosecha) throw new Error("Falta el contexto de recibidor y cosecha.");

  const usuario = useAuthStore.getState().user?.usuario ?? null;
  const ahora = Date.now();

  return database.write(async () =>
    database.get<Bitacora>("bitacoras").create((b) => {
      b.recibidor = recibidor;
      b.cosecha = cosecha;
      b.fecha = ahora;
      b.horaInicio = ahora;
      b.horaFinal = null;
      b.medidor = usuario;
      b.tipocafe = datos.tipocafe;
      b.transportista = datos.transportista;
      b.placacamion = datos.placacamion;
      b.observaciones = datos.observaciones;
      b.impresiones = 0;
    })
  );
}

/**
 * Cierra la jornada y la manda al servidor con sus recibos.
 *
 * ⚠️ CERRAR ES IMPRIMIR. No existe un "cerrada pero sin papel": ese estado intermedio es
 * el que genera dudas en el campo. La impresión del reporte del día ocurre ANTES de
 * marcar `horaFinal`, para que un fallo de la impresora deje la jornada abierta y se
 * pueda reintentar — y no cerrada sin el papel que el camión tiene que llevarse.
 *
 * `imprimir` se recibe como parámetro y no se llama acá adentro para que esa garantía de
 * orden viva en un solo lugar. Hoy la pantalla pasa la impresión simulada; cuando entre
 * ESC/POS por Bluetooth se pasa la real y esta función no cambia.
 *
 * `simulada` es la válvula de escape de la operación: si se acabó el rollo a las cinco de
 * la tarde, el día no puede quedar atrapado en el teléfono sin que la oficina sepa que
 * existió. Queda anotado en las observaciones porque después nadie se acuerda.
 */
export async function cerrarBitacora(
  bitacora: Bitacora,
  imprimir: () => Promise<void>,
  opts: { simulada: boolean } = { simulada: false }
): Promise<{ falloSync: string | null }> {
  if (!bitacora.estaAbierta) throw new Error("Esta bitácora ya está cerrada.");

  const cuantos = await recibosDe(bitacora.id).fetchCount();
  if (cuantos === 0) {
    throw new Error(
      "La bitácora no tiene recibos. Si el día no se trabajó, no hace falta cerrarla."
    );
  }

  await imprimir();

  await database.write(async () => {
    await bitacora.update((b) => {
      b.horaFinal = Date.now();
      b.impresiones = (b.impresiones ?? 0) + 1;
      if (opts.simulada) {
        b.observaciones = [b.observaciones, "Impresión simulada (sin papel)"]
          .filter(Boolean)
          .join(" · ");
      }
    });
  });

  // El envío es parte del cierre, pero su fallo NO lo deshace: la jornada quedó cerrada
  // e impresa, y eso es cierto aunque no haya señal. El sync se reintenta después; que
  // el papel ya esté en el camión no depende de la red.
  try {
    const fallos = await syncNow();
    return { falloSync: fallos.length > 0 ? describirFallos(fallos) : null };
  } catch (e) {
    return { falloSync: (e as Error)?.message ?? "No se pudo sincronizar" };
  }
}
