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
/**
 * De QUIÉN son los datos que hay en este teléfono.
 *
 * Existe porque cerrar sesión ya NO borra la base: si vuelve el mismo recibidor encuentra
 * su trabajo intacto y no baja 12.825 productores de nuevo. Pero si entra OTRO, hereda
 * los productores, los precios y los recibos del anterior — y un delta jamás lo
 * corregiría, porque esas filas no cambiaron del lado del servidor: simplemente dejaron
 * de corresponderle.
 *
 * Guardarlo es lo que permite distinguir los dos casos AL ENTRAR, que es el único momento
 * en que se sabe quién es. Ver `esOtroDueno()` y lib/alcance.ts.
 */
const K_DUENO = "recibos.duenoDatos";

export interface SesionState {
  companyId: number | null;
  cosecha: string | null;
  /** Código del recibidor asignado al usuario (rc_usuario_zona.Recibidor). */
  recibidor: string | null;
  /** Para mostrar "BENEFICIO" y no "001". */
  recibidorNombre: string | null;
  politicas: MapaPoliticas;
  hidratando: boolean;
  /** Mientras esté en true el árbol se desmonta: sin suscripciones vivas se puede
   *  borrar la base sin dejar pantallas con observadores muertos. Ver alcance.ts. */
  reseteando: boolean;

  hidratar: () => Promise<void>;
  elegir: (v: {
    companyId: number;
    cosecha: string;
    recibidor: string;
    recibidorNombre?: string | null;
    /** Quién queda como dueño de los datos que se bajen. Ver `K_DUENO`. */
    usuario: string;
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
  /**
   * Sube en uno cada vez que TERMINA una sincronización.
   *
   * ⚠️ Existe porque WatermelonDB marca las filas como enviadas escribiendo `_status`, que
   * es una columna INTERNA suya: no está en el esquema, así que `observeWithColumns` no la
   * puede vigilar y las listas no se enteran de que algo se envió. La marca "Enviado"
   * aparecería recién al salir y volver a entrar a la pantalla — el mismo defecto que ya
   * nos costó tres arreglos hoy, en otro disfraz.
   *
   * Las pantallas lo ponen en las dependencias de su suscripción y así vuelven a leer.
   */
  syncTick: number;
  marcarSync: () => void;
  setReseteando: (v: boolean) => void;
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
  syncTick: 0,
  hidratando: true,
  reseteando: false,

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

  elegir: async ({ companyId, cosecha, recibidor, recibidorNombre, usuario }) => {
    await Promise.all([
      SecureStore.setItemAsync(K_EMPRESA, String(companyId)),
      SecureStore.setItemAsync(K_COSECHA, cosecha),
      SecureStore.setItemAsync(K_RECIBIDOR, recibidor),
      SecureStore.setItemAsync(K_RECIBIDOR_NOMBRE, recibidorNombre ?? ""),
      // Se sella acá y no al iniciar sesión: el dueño de los DATOS es quien eligió el
      // contexto con el que se bajaron, no quien simplemente se autenticó.
      SecureStore.setItemAsync(K_DUENO, usuario ?? ""),
    ]);
    set({ companyId, cosecha, recibidor, recibidorNombre: recibidorNombre ?? null });
  },

  remontar: () => set((e) => ({ generacion: e.generacion + 1 })),

  marcarSync: () => set((e) => ({ syncTick: e.syncTick + 1 })),
  setReseteando: (reseteando) => set({ reseteando }),
  setPoliticas: (politicas) => set({ politicas }),

  limpiar: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(K_EMPRESA),
      SecureStore.deleteItemAsync(K_COSECHA),
      SecureStore.deleteItemAsync(K_RECIBIDOR),
      SecureStore.deleteItemAsync(K_RECIBIDOR_NOMBRE),
      SecureStore.deleteItemAsync(K_DUENO),
    ]);
    set({ companyId: null, cosecha: null, recibidor: null, recibidorNombre: null, politicas: {} });
  },
}));

/** Lectura sincrónica para el getter de contexto del SyncApi. */
export function contextoActual(): {
  companyId: number;
  cosecha?: string | null;
  appId: string;
  recibidor?: string | null;
} {
  const s = useSesion.getState();
  return {
    // El 0 no debería usarse nunca: el sync no arranca sin contexto. Mandarlo hace que
    // el BE devuelva vacío en vez de sincronizar la empresa equivocada, que es el modo
    // de fallar correcto.
    companyId: s.companyId ?? 0,
    cosecha: s.cosecha,
    appId: config.appId,
    // Acota el pull a la zona de este recibidor. Sin esto un usuario con acceso amplio
    // se baja el país: el BE, al ver "todas las zonas autorizadas", omite el filtro.
    recibidor: s.recibidor,
  };
}

/**
 * ¿Los datos que hay en el teléfono son de OTRO usuario?
 *
 * Se pregunta al entrar, que es el único momento en que se sabe quién es. Sin dueño
 * sellado —teléfono nuevo, o sesión anterior a que esto existiera— se responde `false`:
 * no hay datos ajenos que proteger, y borrar por las dudas costaría una descarga
 * completa sin motivo.
 */
export async function esOtroDueno(usuario: string): Promise<boolean> {
  try {
    const dueno = await SecureStore.getItemAsync(K_DUENO);
    if (!dueno) return false;
    return dueno.trim().toLowerCase() !== usuario.trim().toLowerCase();
  } catch {
    // Si no se puede leer, se prefiere NO borrar: perder el día de alguien por no poder
    // leer una preferencia sería mucho peor que mostrarle datos que igual va a re-bajar.
    return false;
  }
}
