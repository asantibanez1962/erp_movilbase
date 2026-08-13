import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { config } from "./config";
import type { MapaPoliticas } from "./politicas";

/**
 * Contexto de trabajo del recibidor: empresa, cosecha y **recibidor**.
 *
 * DÓNDE SE PARECE Y DÓNDE NO A PROMOTOR
 * -------------------------------------
 * Promotor trabaja por ZONAS: un usuario puede tener varias y ve todo lo de ellas. Acá
 * el eje es el RECIBIDOR — el lugar físico donde la persona recibe café hoy—, y de él se
 * deriva la zona que recorta los productores (`rc_recibidores.codigozona`).
 *
 * ⚠️ La zona del productor cruza con `codigozona` del recibidor, NO con su columna
 * `zona`, que es otra cosa ('A'). Filtrar por la equivocada devuelve CERO productores sin
 * ningún error, y el síntoma —"no me aparece nadie"— manda a buscar por el lado
 * equivocado. El recorte real lo hace el servidor desde el JWT; que la app conozca la
 * zona no le da acceso a otras.
 *
 * Se persiste en SecureStore para que reabrir la app no vuelva a preguntar.
 */

const K_EMPRESA = "recibos.companyId";
const K_COSECHA = "recibos.cosecha";
const K_RECIBIDOR = "recibos.recibidor";
const K_RECIBIDOR_NOMBRE = "recibos.recibidorNombre";

export interface SesionState {
  companyId: number | null;
  cosecha: string | null;
  /** Código del recibidor asignado al usuario (rc_usuario_zona.Recibidor). */
  recibidor: string | null;
  /** Para mostrar "BENEFICIO" y no "001". */
  recibidorNombre: string | null;
  politicas: MapaPoliticas;
  hidratando: boolean;

  hidratar: () => Promise<void>;
  elegir: (v: {
    companyId: number;
    cosecha: string;
    recibidor: string;
    recibidorNombre?: string | null;
  }) => Promise<void>;
  /**
   * Se incrementa para forzar que toda la app se vuelva a montar.
   *
   * Hace falta después de `unsafeResetDatabase`: WatermelonDB mata las suscripciones
   * vivas al resetear, y las pantallas quedan con objetos viejos y observadores muertos.
   * Los datos se borraron de verdad, pero la pantalla muestra una foto de antes.
   */
  generacion: number;
  remontar: () => void;
  setPoliticas: (p: MapaPoliticas) => void;
  limpiar: () => Promise<void>;
}

export const useSesion = create<SesionState>((set) => ({
  companyId: null,
  cosecha: null,
  recibidor: null,
  recibidorNombre: null,
  politicas: {},
  generacion: 0,
  hidratando: true,

  hidratar: async () => {
    try {
      const [empresa, cosecha, recibidor, nombre] = await Promise.all([
        SecureStore.getItemAsync(K_EMPRESA),
        SecureStore.getItemAsync(K_COSECHA),
        SecureStore.getItemAsync(K_RECIBIDOR),
        SecureStore.getItemAsync(K_RECIBIDOR_NOMBRE),
      ]);
      const companyId = empresa ? Number(empresa) : null;
      set({
        companyId: companyId != null && !Number.isNaN(companyId) ? companyId : null,
        cosecha: cosecha ?? null,
        recibidor: recibidor ?? null,
        recibidorNombre: nombre ?? null,
        hidratando: false,
      });
    } catch {
      // Sin contexto persistido se vuelve a preguntar. No vale bloquear la app por eso.
      set({ hidratando: false });
    }
  },

  elegir: async ({ companyId, cosecha, recibidor, recibidorNombre }) => {
    await Promise.all([
      SecureStore.setItemAsync(K_EMPRESA, String(companyId)),
      SecureStore.setItemAsync(K_COSECHA, cosecha),
      SecureStore.setItemAsync(K_RECIBIDOR, recibidor),
      SecureStore.setItemAsync(K_RECIBIDOR_NOMBRE, recibidorNombre ?? ""),
    ]);
    set({ companyId, cosecha, recibidor, recibidorNombre: recibidorNombre ?? null });
  },

  remontar: () => set((e) => ({ generacion: e.generacion + 1 })),
  setPoliticas: (politicas) => set({ politicas }),

  limpiar: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(K_EMPRESA),
      SecureStore.deleteItemAsync(K_COSECHA),
      SecureStore.deleteItemAsync(K_RECIBIDOR),
      SecureStore.deleteItemAsync(K_RECIBIDOR_NOMBRE),
    ]);
    set({ companyId: null, cosecha: null, recibidor: null, recibidorNombre: null, politicas: {} });
  },
}));

/** Lectura sincrónica para el getter de contexto del SyncApi. */
export function contextoActual(): {
  companyId: number;
  cosecha?: string | null;
  appId: string;
} {
  const s = useSesion.getState();
  return {
    // El 0 no debería usarse nunca: el sync no arranca sin contexto. Mandarlo hace que
    // el BE devuelva vacío en vez de sincronizar la empresa equivocada, que es el modo
    // de fallar correcto.
    companyId: s.companyId ?? 0,
    cosecha: s.cosecha,
    appId: config.appId,
  };
}
