import { create } from "zustand";
import { Q } from "@nozbe/watermelondb";
import { runSync, type FalloPull } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";
import { COLLECTIONS, SOLO_ENVIO } from "../db/schema";
import type { Bitacora, Remedida } from "../db/models";
import { config } from "./config";
import { useSesion } from "./sesion";
import { cargarPoliticas, puedeEnviarse } from "./politicas";
import { prepararFechas } from "./fechas";
import { purgarAntiguos } from "./purga";

/** Las dos colecciones que el teléfono origina, y por lo tanto pueden tener pendientes. */
const ESCRIBIBLES = ["bitacoras", "recibos"] as const;

/**
 * Sincronización manual. No hay automática, y eso es del diseño, no una simplificación:
 * **nada sale del teléfono hasta que el recibidor imprime la bitácora**, cerrando el
 * día. Ahí se envían la bitácora y sus recibos juntos.
 *
 * Como todo viaja en un solo acto, el padre nunca llega después que sus hijos, y por eso
 * el orden de COLLECTIONS pone `bitacoras` antes que `recibos`: el push respeta ese
 * orden para que el BE pueda resolver la FK contra mt.MobileIdMap.
 */
export async function syncNow(): Promise<FalloPull[]> {
  const api = getSyncClient();

  // Las políticas se refrescan en cada sync: son configuración del servidor y pueden
  // cambiar sin republicar la app. Si el manifest falla se sigue con lo que haya — no
  // vale abortar el sync por esto.
  try {
    useSesion.getState().setPoliticas(await cargarPoliticas());
  } catch (err) {
    console.info("no se pudo refrescar el manifest de políticas", err);
  }
  const politicas = useSesion.getState().politicas;

  /**
   * Las remedidas que TODAVÍA no pueden salir, para retener también sus rutas.
   *
   * ⚠️ UN HIJO NO PUEDE VIAJAR SIN SU PADRE. La remedida espera a estar impresa
   * (`hasta-evento`), pero sus rutas no tienen campo de cierre propio y salían solas: el
   * BE las rechazaba con UNRESOLVED_PARENT una y otra vez, en cada sync, hasta que la
   * remedida se imprimiera. Ruido permanente en el log por algo que no es un error.
   *
   * La retención de `puedeEnviar` es por fila y sólo ve sus propios campos, así que la
   * condición del padre hay que traerla de afuera. Se arma acá, una vez por sync.
   */
  const remedidasRetenidas = new Set(
    (
      await database
        .get<Remedida>("remedidas")
        .query(Q.where("impreso", 0))
        .fetch()
    ).map((r) => r.id)
  );

  /**
   * Las bitácoras TODAVÍA ABIERTAS, para retener también sus recibos.
   *
   * Mismo caso que las rutas, y por eso está al lado: el recibo se suelta al imprimirse,
   * pero su bitácora espera a cerrarse (`hora_final`). Entre una cosa y otra hay un rato
   * largo —toda la jornada— en el que el recibo ya está firme y su padre no ha subido, y
   * ahí el BE lo rechazaba con UNRESOLVED_PARENT en CADA sincronización del día.
   *
   * No perdía nada —al cerrar la bitácora suben los dos juntos— pero llenaba el log del
   * servidor de rechazos que no son errores, que es justo lo que hace difícil ver los que
   * sí lo son.
   */
  const bitacorasAbiertas = new Set(
    (
      await database
        .get<Bitacora>("bitacoras")
        .query(Q.where("hora_final", null))
        .fetch()
    ).map((b) => b.id)
  );

  const { fallos } = await runSync(database, {
    api,
    collections: [...COLLECTIONS],
    // Los documentos no se piden de vuelta: el teléfono los emite y el servidor los
    // guarda. Ver SOLO_ENVIO en db/schema.ts.
    soloEnvio: SOLO_ENVIO,
    schemaVersion: config.schemaVersion,
    // Retiene las filas que todavía no cumplen su condición de cierre. Para los recibos
    // esa condición es `impreso`: un recibo sin imprimir es trabajo a medio hacer.
    puedeEnviar: (coleccion, fila) => {
      // La ruta espera a su remedida: sin ella el servidor no tiene a qué colgarla.
      if (coleccion === "remedida_rutas") {
        return !remedidasRetenidas.has(String(fila.id_remedida ?? ""));
      }
      // Y el recibo espera a que su bitácora cierre, por lo mismo.
      if (coleccion === "recibos" && bitacorasAbiertas.has(String(fila.id_bitacora ?? ""))) {
        return false;
      }
      return puedeEnviarse(politicas, coleccion, fila);
    },
    // Fechas y horas LOCALES, no instantes: varias columnas del servidor son `date` o
    // `time` y el BE interpreta los milisegundos como UTC. Con UTC-6, una bitácora de
    // la tarde se archivaba en el día siguiente. Ver lib/fechas.ts.
    prepararEnvio: prepararFechas,
  });

  /**
   * Se limpia lo viejo DESPUÉS de sincronizar, que es el único momento en que se sabe con
   * certeza qué llegó al servidor. Nunca lanza: una purga que falle no puede romper el
   * sync, que es lo que de verdad importa. Ver lib/purga.ts.
   */
  await purgarAntiguos();

  // Las listas muestran una marca "Enviado" que sale de `_status`, una columna interna de
  // WatermelonDB que no se puede observar. Este aviso es lo que las hace releer.
  useSesion.getState().marcarSync();

  // Llegar aca significa que hablamos con el servidor. Aunque `fallos` traiga
  // colecciones, hubo ida y vuelta: la puerta del cambio de clave se apoya en esto
  // para no exigirle la clave a un recibidor sin red — el endpoint es remoto y lo
  // dejaria encerrado afuera de la app en pleno recibo.
  useSyncEstado.getState().marcarOk();

  return fallos;
}

/** ¿Hubo, en esta corrida de la app, un sync que llego al servidor? */
export const useSyncEstado = create<{ huboSyncOk: boolean; marcarOk: () => void }>(
  (set) => ({ huboSyncOk: false, marcarOk: () => set({ huboSyncOk: true }) })
);

/**
 * Cuánto trabajo del teléfono todavía no llegó al servidor.
 *
 * Separa lo que **no se envió** de lo que está **retenido** porque son dos situaciones
 * distintas para quien lee el número: lo primero se resuelve sincronizando, lo segundo
 * espera un evento —imprimir la bitácora— y no se arregla tocando "Sincronizar". Con un
 * solo contador, uno sincroniza, el número no baja y no se entiende por qué.
 */
export async function resumenPendientes(): Promise<{
  porEnviar: number;
  retenidas: number;
  total: number;
}> {
  const politicas = useSesion.getState().politicas;

  /**
   * Las remedidas que TODAVÍA no pueden salir, para retener también sus rutas.
   *
   * ⚠️ UN HIJO NO PUEDE VIAJAR SIN SU PADRE. La remedida espera a estar impresa
   * (`hasta-evento`), pero sus rutas no tienen campo de cierre propio y salían solas: el
   * BE las rechazaba con UNRESOLVED_PARENT una y otra vez, en cada sync, hasta que la
   * remedida se imprimiera. Ruido permanente en el log por algo que no es un error.
   *
   * La retención de `puedeEnviar` es por fila y sólo ve sus propios campos, así que la
   * condición del padre hay que traerla de afuera. Se arma acá, una vez por sync.
   */
  const remedidasRetenidas = new Set(
    (
      await database
        .get<Remedida>("remedidas")
        .query(Q.where("impreso", 0))
        .fetch()
    ).map((r) => r.id)
  );

  /**
   * Las bitácoras TODAVÍA ABIERTAS, para retener también sus recibos.
   *
   * Mismo caso que las rutas, y por eso está al lado: el recibo se suelta al imprimirse,
   * pero su bitácora espera a cerrarse (`hora_final`). Entre una cosa y otra hay un rato
   * largo —toda la jornada— en el que el recibo ya está firme y su padre no ha subido, y
   * ahí el BE lo rechazaba con UNRESOLVED_PARENT en CADA sincronización del día.
   *
   * No perdía nada —al cerrar la bitácora suben los dos juntos— pero llenaba el log del
   * servidor de rechazos que no son errores, que es justo lo que hace difícil ver los que
   * sí lo son.
   */
  const bitacorasAbiertas = new Set(
    (
      await database
        .get<Bitacora>("bitacoras")
        .query(Q.where("hora_final", null))
        .fetch()
    ).map((b) => b.id)
  );
  let porEnviar = 0;
  let retenidas = 0;

  for (const nombre of ESCRIBIBLES) {
    const filas = await database
      .get(nombre)
      .query(Q.where("_status", Q.notEq("synced")))
      .fetch();
    for (const fila of filas) {
      // `_raw` y no la instancia: puedeEnviarse lee el campo de cierre por nombre de
      // columna, y el modelo lo expone camelCase.
      const raw = fila._raw as unknown as Record<string, unknown>;
      // Mismo criterio que el sync, incluida la espera del padre: un recibo ya impreso
      // cuya bitácora sigue abierta está RETENIDO, no listo para enviar. Contarlo como
      // "por enviar" hacía que el drawer prometiera un envío que no iba a ocurrir.
      const esperaAlPadre =
        nombre === "recibos" && bitacorasAbiertas.has(String(raw.id_bitacora ?? ""));
      if (!esperaAlPadre && puedeEnviarse(politicas, nombre, raw)) porEnviar++;
      else retenidas++;
    }
  }
  return { porEnviar, retenidas, total: porEnviar + retenidas };
}

/**
 * El resumen en palabras, para un aviso que alguien lee antes de decidir si descarta.
 *
 * Un número solo no alcanza: "3 pendientes" no dice si son tres recibos del día o tres
 * bitácoras cerradas que no subieron, y esa diferencia cambia la decisión.
 */
export function describirPendientes(p: {
  porEnviar: number;
  retenidas: number;
  total: number;
}): string {
  const partes: string[] = [];
  if (p.porEnviar > 0) partes.push(`${p.porEnviar} sin enviar`);
  if (p.retenidas > 0) partes.push(`${p.retenidas} sin imprimir`);
  return partes.length > 0 ? partes.join(" y ") : "nada";
}
