import { create } from "zustand";
import { cargarOpciones, Opciones, OPCIONES_CERRADAS } from "./tomaApi";

/**
 * Lo que este usuario tiene permitido hacer.
 *
 * Se pide una vez al entrar y con eso se arma el menú: una opción sin permiso
 * no aparece. Mostrarla y que reviente con 403 al tocarla enseña a la gente a
 * ignorar los errores, que es peor que no ofrecerla.
 *
 * SI NO SE PUDO PREGUNTAR, NO HAY PERMISOS. Ante un error —sin señal, servidor
 * viejo, 500— queda todo cerrado. Es incómodo y es lo correcto: un permiso que
 * no se pudo verificar no es un permiso. La pantalla lo dice y ofrece
 * reintentar, así el operario entiende que le falta conexión y no que le
 * quitaron el acceso.
 *
 * Y ESCONDER UN BOTON NO ES UN CONTROL DE ACCESO: cada endpoint exige su
 * permiso por su cuenta. Esto es comodidad para el que usa la app.
 */

interface EstadoOpciones {
  opciones: Opciones;
  cargando: boolean;
  error: string | null;
  refrescar: () => Promise<void>;
  limpiar: () => void;
}

export const useOpciones = create<EstadoOpciones>((set) => ({
  opciones: OPCIONES_CERRADAS,
  cargando: false,
  error: null,

  refrescar: async () => {
    set({ cargando: true, error: null });
    try {
      set({ opciones: await cargarOpciones(), cargando: false });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      set({
        opciones: OPCIONES_CERRADAS,
        cargando: false,
        error: err?.response?.data?.message ?? err?.message ?? "No se pudieron leer los permisos.",
      });
    }
  },

  limpiar: () => set({ opciones: OPCIONES_CERRADAS, error: null }),
}));
