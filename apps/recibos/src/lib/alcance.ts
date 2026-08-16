import { useAuthStore } from "@erp/shared-api";
import { database } from "./db";
import { olvidarClave } from "./clave";
import { esOtroDueno, useSesion } from "./sesion";
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
 * Cierra la sesión: credenciales y contexto. **NO borra los datos.**
 *
 * ── POR QUÉ YA NO BORRA ─────────────────────────────────────────────────────
 *
 * Borraba, y era de más. El caso normal es que el MISMO recibidor vuelva a entrar, y ahí
 * el borrado no aportaba nada: costaba volver a bajar 12.825 productores por la LAN de un
 * beneficio, y sobre todo **obligaba a descartar el trabajo sin enviar**. Un recibidor
 * que cierra sesión por equivocación a las cuatro de la tarde perdía el día.
 *
 * El borrado se hace AL ENTRAR y sólo si cambió el dueño de los datos (ver
 * `borrarSiEsOtroUsuario`). Ahí sí es necesario: el cache está recortado al recibidor y a
 * su zona, y un delta nunca lo corregiría —esas filas no cambiaron del lado del servidor,
 * simplemente dejaron de corresponderle.
 *
 * ⚠️ Los datos quedan en el teléfono entre un cierre y el próximo ingreso. Para verlos
 * habría que saltarse la app; abrirla no alcanza, porque si entra otro usuario se borran
 * antes de mostrarle nada.
 *
 * `descartar` se conserva porque la pantalla lo sigue ofreciendo, pero con esto ya casi
 * no hace falta: lo pendiente sobrevive al cierre de sesión.
 */
export async function cerrarSesion(opts: { descartar: boolean }): Promise<void> {
  await exigirNadaPendiente(opts.descartar);

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
 * Al ENTRAR: si los datos que hay son de otro usuario, se borran antes de mostrarle nada.
 *
 * Es la otra mitad de la decisión de arriba. Cerrar sesión conserva el trabajo para quien
 * vuelve; esto impide que ese trabajo —y los productores, y los precios de su zona— se le
 * aparezcan a otra persona.
 *
 * Devuelve si borró, para que quien llame sepa que hay que remontar el árbol.
 */
export async function borrarSiEsOtroUsuario(usuario: string): Promise<boolean> {
  if (!(await esOtroDueno(usuario))) return false;

  console.info(`[alcance] los datos locales son de otro usuario: se borran antes de entrar`);
  await borrarBaseLocal();
  await useSesion.getState().limpiar();
  return true;
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
