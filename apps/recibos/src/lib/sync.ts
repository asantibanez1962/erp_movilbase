import { Q } from "@nozbe/watermelondb";
import { runSync, type FalloPull } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";
import { COLLECTIONS } from "../db/schema";
import { config } from "./config";
import { useSesion } from "./sesion";
import { cargarPoliticas, puedeEnviarse } from "./politicas";

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

  const { fallos } = await runSync(database, {
    api,
    collections: [...COLLECTIONS],
    schemaVersion: config.schemaVersion,
    // Retiene las filas que todavía no cumplen su condición de cierre. Para los recibos
    // esa condición es `impreso`: un recibo sin imprimir es trabajo a medio hacer.
    puedeEnviar: (coleccion, fila) => puedeEnviarse(politicas, coleccion, fila),
  });

  return fallos;
}

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
      if (puedeEnviarse(politicas, nombre, raw)) porEnviar++;
      else retenidas++;
    }
  }
  return { porEnviar, retenidas, total: porEnviar + retenidas };
}
