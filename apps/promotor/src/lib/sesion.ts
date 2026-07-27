import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { config } from "./config";
import type { MapaPoliticas } from "./politicas";

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
/**
 * Las zonas autorizadas TAMBIÉN se persisten, no sólo empresa y cosecha.
 *
 * Sin esto, cada arranque en frío las levanta vacías y cualquier comparación contra
 * las del servidor da "cambiaron" — que es lo que hacía que verificarAlcance rebajara
 * todos los datos en cada arranque, borrando de paso los checkpoints de sync y
 * volviendo a bajar 740 filas cada vez.
 *
 * Forman parte del ALCANCE de los datos locales tanto como la empresa y la cosecha, así
 * que tienen que sobrevivir igual que ellas.
 */
const K_ZONAS = "promotor.zonas";
const K_TODAS_ZONAS = "promotor.todasLasZonas";

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
  /**
   * Política de edición/envío por colección, del manifest. Gobierna si la app
   * ofrece editar una fila y si retiene su envío. Vacío hasta el primer manifest;
   * politicaDe() cae a un default conservador.
   */
  politicas: MapaPoliticas;
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
  /**
   * Se incrementa para forzar que TODA la app se vuelva a montar.
   *
   * Hace falta después de `unsafeResetDatabase`: WatermelonDB mata las suscripciones
   * vivas al resetear —lo dice su propio código: "App should not hold onto
   * subscriptions or Watermelon objects while resetting database"— y las pantallas
   * quedan con objetos viejos en memoria y observadores muertos que ya no se
   * actualizan. Los datos se borraron de verdad, pero la pantalla muestra una foto de
   * antes, y uno concluye —con razón— que el rebajado no funcionó.
   *
   * Remontar el árbol descarta esos objetos y recrea todas las queries contra la base
   * nueva. Es la forma limpia de lograrlo sin obligar a cerrar y abrir la app.
   */
  generacion: number;
  remontar: () => void;
  setPoliticas: (p: MapaPoliticas) => void;
  limpiar: () => Promise<void>;
}

export const useSesion = create<SesionState>((set) => ({
  companyId: null,
  cosecha: null,
  zonas: [],
  zonasNombres: [],
  todasLasZonas: false,
  retencionFotosDias: 30,
  politicas: {},
  generacion: 0,
  hidratando: true,

  hidratar: async () => {
    try {
      const [empresa, cosecha, zonasRaw, todasRaw] = await Promise.all([
        SecureStore.getItemAsync(K_EMPRESA),
        SecureStore.getItemAsync(K_COSECHA),
        SecureStore.getItemAsync(K_ZONAS),
        SecureStore.getItemAsync(K_TODAS_ZONAS),
      ]);
      const companyId = empresa ? Number(empresa) : null;

      // Las zonas se restauran para poder comparar el alcance al arrancar. Un parseo
      // fallido deja el array vacío, que verificarAlcance interpreta como "no se sabe"
      // y NO como "cambiaron" — la diferencia entre adoptar el valor del servidor y
      // rebajar toda la base sin motivo.
      let zonas: string[] = [];
      try {
        const parseadas = zonasRaw ? JSON.parse(zonasRaw) : null;
        if (Array.isArray(parseadas)) zonas = parseadas.filter((z) => typeof z === "string");
      } catch {
        // formato viejo o corrupto: se queda vacío
      }

      set({
        companyId: companyId != null && !Number.isNaN(companyId) ? companyId : null,
        cosecha: cosecha ?? null,
        zonas,
        todasLasZonas: todasRaw === "1",
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
      SecureStore.setItemAsync(K_ZONAS, JSON.stringify(zonas)),
      SecureStore.setItemAsync(K_TODAS_ZONAS, todasLasZonas ? "1" : "0"),
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

  remontar: () => set((e) => ({ generacion: e.generacion + 1 })),

  setPoliticas: (politicas) => set({ politicas }),

  limpiar: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(K_EMPRESA),
      SecureStore.deleteItemAsync(K_COSECHA),
      SecureStore.deleteItemAsync(K_ZONAS),
      SecureStore.deleteItemAsync(K_TODAS_ZONAS),
    ]);
    set({
      companyId: null,
      cosecha: null,
      zonas: [],
      zonasNombres: [],
      todasLasZonas: false,
      politicas: {},
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
