import { useAuthStore } from "@erp/shared-api";
import { database } from "./db";
import { olvidarClave } from "./clave";
import { useSesion } from "./sesion";
import { resumenPendientes, describirPendientes } from "./sync";

/**
 * Borrar la base local: cerrar sesión, o cambiar de servidor.
 *
 * ⚠️ EL ORDEN IMPORTA, Y ACÁ ESTÁ AL DERECHO.
 *
 * WatermelonDB avisa —"App should not hold onto subscriptions or Watermelon objects
 * while resetting database"— y no es una advertencia decorativa: al resetear mata las
 * suscripciones vivas, y las pantallas quedan con objetos viejos en memoria y
 * observadores muertos. Los datos se borraron de verdad, pero la pantalla sigue
 * mostrando una foto de antes, y uno concluye —con razón— que el borrado no funcionó.
 *
 * En la app promotor esto se resolvió remontando DESPUÉS del reset, que arregla el
 * síntoma pero deja el reset ocurriendo con las suscripciones vivas. Acá se hace al
 * derecho desde el principio:
 *
 *   1. `reseteando = true` → el árbol se desmonta y quedan cero suscripciones
 *   2. se espera un tick para que React alcance a aplicar ese render
 *   3. recién ahí se borra la base
 *   4. `remontar()` vuelve a montar todo contra la base nueva
 */
export async function borrarBaseLocal(): Promise<void> {
  const s = useSesion.getState();

  s.setReseteando(true);
  // Un tick del event loop alcanza para que React procese el render que desmonta las
  // pantallas. Sin la espera, el reset corre en el mismo tick y encuentra todo vivo.
  await new Promise((r) => setTimeout(r, 0));

  try {
    await database.write(async () => {
      await database.unsafeResetDatabase();
    });
  } finally {
    s.setReseteando(false);
    s.remontar();
  }
}

/**
 * Cierra la sesión de verdad: credenciales, contexto Y datos locales.
 *
 * Borrar la base no es exceso de celo. El cache pertenece a un usuario y a su recibidor;
 * si quedara, el próximo que entre heredaría los productores, los precios y —lo grave—
 * los recibos del anterior. Y un delta nunca lo corregiría, porque esas filas no
 * cambiaron del lado del servidor: simplemente dejaron de corresponderle.
 *
 * `descartar` existe porque cerrar sesión no puede ser una forma silenciosa de perder el
 * día de alguien. Si hay una bitácora sin cerrar, sus recibos sólo existen en este
 * teléfono.
 */
export async function cerrarSesion(opts: { descartar: boolean }): Promise<void> {
  await exigirNadaPendiente(opts.descartar);

  await borrarBaseLocal();
  await useSesion.getState().limpiar();
  // ⚠️ SIN ESTO NO SE CIERRA NADA. Borrar el contexto deja las credenciales en
  // SecureStore, así que la app vuelve a entrar sola con el usuario anterior y sólo
  // pregunta el recibidor. El síntoma —"no me pide usuario"— no se parece a "faltó
  // borrar el token", y manda a buscar por el lado de la pantalla de login.
  await useAuthStore.getState().logout();
  // La clave local muere con la sesión: sobrevivirle no protegería nada y dejaría al
  // próximo usuario del teléfono con una guarda que responde a la clave de otro.
  await olvidarClave();
}

/**
 * Cambiar de recibidor sin cerrar sesión.
 *
 * También borra la base, y no es celo: el cache está recortado a la zona del recibidor
 * anterior. Las filas de la zona vieja no se irían nunca por delta —del lado del
 * servidor no cambiaron, simplemente dejaron de corresponder— y las de la nueva
 * llegarían mezcladas con productores que ya no son de acá.
 */
export async function cambiarRecibidor(opts: { descartar: boolean }): Promise<void> {
  await exigirNadaPendiente(opts.descartar);

  await borrarBaseLocal();
  await useSesion.getState().limpiar();
}

/** Un día de trabajo sin sincronizar sólo existe en este teléfono. */
async function exigirNadaPendiente(descartar: boolean): Promise<void> {
  const pendientes = await resumenPendientes();
  if (pendientes.total > 0 && !descartar) {
    throw new Error(
      `Quedan sin enviar: ${describirPendientes(pendientes)}. ` +
        "Cerrá la bitácora e imprimila antes de salir, o confirmá que se descarte."
    );
  }
}
