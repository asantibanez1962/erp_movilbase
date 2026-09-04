import { create } from "zustand";
import { Q } from "@nozbe/watermelondb";
import { runSync } from "@erp/shared-sync";
import { database } from "./db";
import { getSyncClient } from "./api";

/**
 * Trigger manual de sincronización. Llamado desde:
 *   - bootstrapApi() post-login (sync inicial)
 *   - botón "Sincronizar" en ProductoresScreen
 *   - eventualmente desde FCM hint handler (Phase D)
 */
export async function syncNow(): Promise<void> {
  const api = getSyncClient();
  // El resultado trae `fallos` por colección desde que el sync es resiliente. Acá se
  // ignora a propósito: esta app tiene dos colecciones y todavía no muestra el detalle.
  await runSync(database, {
    api,
    collections: ["productores", "recibos"],
    schemaVersion: 2,
  });

  // Llegar aca prueba que se alcanzo el servidor. Lo usa la puerta del cambio de
  // clave: el endpoint es remoto, y exigirsela a un recibidor sin red lo dejaria
  // encerrado afuera de la app en pleno recibo.
  useSyncEstado.getState().marcarOk();
}

/** ¿Hubo, en esta corrida, un sync que llego al servidor? */
export const useSyncEstado = create<{ huboSyncOk: boolean; marcarOk: () => void }>(
  (set) => ({ huboSyncOk: false, marcarOk: () => set({ huboSyncOk: true }) })
);

/**
 * Recibos que todavia no salieron del aparato.
 *
 * `_status != 'synced'` cubre creados, modificados y rechazados — el mismo
 * criterio que el chip "pendientes" de la lista.
 */
export async function recibosPendientes(): Promise<number> {
  return database.get("recibos").query(Q.where("_status", Q.notEq("synced"))).fetchCount();
}
