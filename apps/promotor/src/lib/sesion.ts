import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { config } from "./config";

/**
 * Sesión de trabajo del promotor: empresa + cosecha.
 *
 * Por qué existe (y por qué el sync no puede arrancar sin esto):
 *
 *   - La EMPRESA define qué zonas tiene autorizadas el usuario (rc_usuario_zona es
 *     por user × empresa). Sin empresa no se puede resolver el alcance.
 *   - La COSECHA recorta solicitudes y visitas. Las solicitudes están repartidas en
 *     8 cosechas y el promotor trabaja una a la vez: con cosecha son ~236 filas,
 *     sin cosecha 2 142.
 *
 * Se persiste en SecureStore para que reabrir la app no vuelva a preguntar.
 *
 * Las zonas se guardan sólo para MOSTRARLAS ("trabajás en la zona 5"). El recorte
 * real lo hace el BE desde el JWT — que la app las conozca no le da acceso a otras.
 */

const K_EMPRESA = "promotor.companyId";
const K_COSECHA = "promotor.cosecha";

export interface SesionState {
  companyId: number | null;
  cosecha: string | null;
  /** Informativas para la UI. Vacío + todasLasZonas=false ⇒ sin acceso RC. */
  zonas: string[];
  /** Nombres de esas zonas, para mostrar "MIRAMAR" en vez de "5". */
  zonasNombres: string[];
  todasLasZonas: boolean;
  /** Días que se conserva la copia local de una foto subida. Viene del servidor. */
  retencionFotosDias: number;
  hidratando: boolean;

  hidratar: () => Promise<void>;
  elegir: (v: {
    companyId: number;
    cosecha: string;
    zonas: string[];
    zonasNombres: string[];
    todasLasZonas: boolean;
    retencionFotosDias?: number;
  }) => Promise<void>;
  limpiar: () => Promise<void>;
}

export const useSesion = create<SesionState>((set) => ({
  companyId: null,
  cosecha: null,
  zonas: [],
  zonasNombres: [],
  todasLasZonas: false,
  retencionFotosDias: 30,
  hidratando: true,

  hidratar: async () => {
    try {
      const [empresa, cosecha] = await Promise.all([
        SecureStore.getItemAsync(K_EMPRESA),
        SecureStore.getItemAsync(K_COSECHA),
      ]);
      const companyId = empresa ? Number(empresa) : null;
      set({
        companyId: companyId != null && !Number.isNaN(companyId) ? companyId : null,
        cosecha: cosecha ?? null,
        hidratando: false,
      });
    } catch {
      // Sin sesión persistida se pide de nuevo — no es un error que valga bloquear.
      set({ hidratando: false });
    }
  },

  elegir: async ({
    companyId,
    cosecha,
    zonas,
    zonasNombres,
    todasLasZonas,
    retencionFotosDias,
  }) => {
    await Promise.all([
      SecureStore.setItemAsync(K_EMPRESA, String(companyId)),
      SecureStore.setItemAsync(K_COSECHA, cosecha),
    ]);
    set({
      companyId,
      cosecha,
      zonas,
      zonasNombres,
      todasLasZonas,
      // Sólo se pisa si vino: al cambiar de cosecha no se recarga el contexto y
      // hay que conservar el valor que ya se tenía.
      ...(retencionFotosDias != null ? { retencionFotosDias } : {}),
    });
  },

  limpiar: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(K_EMPRESA),
      SecureStore.deleteItemAsync(K_COSECHA),
    ]);
    set({
      companyId: null,
      cosecha: null,
      zonas: [],
      zonasNombres: [],
      todasLasZonas: false,
    });
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
    // El fallback a 0 nunca debería usarse: el sync no se dispara sin sesión.
    // Mandar 0 hace que el BE devuelva vacío en vez de sincronizar la empresa
    // equivocada, que es el modo de fallar correcto.
    companyId: s.companyId ?? 0,
    cosecha: s.cosecha,
    // Sin esto el BE puede resolver 'productores' con la spec de otra app.
    appId: config.appId,
  };
}
