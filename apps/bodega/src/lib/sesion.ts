import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { TOKEN_KEYS } from "@erp/shared-api";

/**
 * Sesión de trabajo del montacarguista: empresa y bodega.
 *
 * Se persiste porque el operario abre la app decenas de veces por turno y
 * volver a elegir la bodega cada vez sería una molestia sin sentido: trabaja
 * en una sola. Se limpia al cerrar sesión.
 *
 * No guarda datos de negocio —ni partidas ni ubicaciones— a propósito: todo se
 * pide al servidor cuando se necesita. Una lista de partidas guardada en el
 * teléfono envejece en minutos, porque hay varios operarios moviendo café en
 * la misma bodega al mismo tiempo.
 */

const K_COMPANIA = "bodega.companyId";
const K_BODEGA = "bodega.idBodega";
const K_BODEGA_NOMBRE = "bodega.nombreBodega";

interface EstadoSesion {
  companyId: number | null;
  idBodega: number | null;
  nombreBodega: string | null;
  cargando: boolean;

  restaurar: () => Promise<void>;
  fijarEmpresa: (companyId: number) => Promise<void>;
  fijarBodega: (id: number, nombre: string) => Promise<void>;
  /** Olvida la bodega y deja la sesión abierta: para cambiar de bodega. */
  soltarBodega: () => Promise<void>;
  cerrar: () => Promise<void>;
}

export const useSesion = create<EstadoSesion>((set) => ({
  companyId: null,
  idBodega: null,
  nombreBodega: null,
  cargando: true,

  restaurar: async () => {
    const [c, b, n] = await Promise.all([
      SecureStore.getItemAsync(K_COMPANIA),
      SecureStore.getItemAsync(K_BODEGA),
      SecureStore.getItemAsync(K_BODEGA_NOMBRE),
    ]);
    set({
      companyId: c ? Number(c) : null,
      idBodega: b ? Number(b) : null,
      nombreBodega: n,
      cargando: false,
    });
  },

  fijarEmpresa: async (companyId) => {
    await SecureStore.setItemAsync(K_COMPANIA, String(companyId));
    // Cambiar de empresa invalida la bodega: las bodegas son de una empresa.
    await SecureStore.deleteItemAsync(K_BODEGA);
    await SecureStore.deleteItemAsync(K_BODEGA_NOMBRE);
    set({ companyId, idBodega: null, nombreBodega: null });
  },

  fijarBodega: async (id, nombre) => {
    await SecureStore.setItemAsync(K_BODEGA, String(id));
    await SecureStore.setItemAsync(K_BODEGA_NOMBRE, nombre);
    set({ idBodega: id, nombreBodega: nombre });
  },

  soltarBodega: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(K_BODEGA),
      SecureStore.deleteItemAsync(K_BODEGA_NOMBRE),
    ]);
    set({ idBodega: null, nombreBodega: null });
  },

  cerrar: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEYS.ACCESS),
      SecureStore.deleteItemAsync(TOKEN_KEYS.REFRESH),
      SecureStore.deleteItemAsync(K_COMPANIA),
      SecureStore.deleteItemAsync(K_BODEGA),
      SecureStore.deleteItemAsync(K_BODEGA_NOMBRE),
    ]);
    set({ companyId: null, idBodega: null, nombreBodega: null });
  },
}));
