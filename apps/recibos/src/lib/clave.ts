import * as SecureStore from "expo-secure-store";

/**
 * La clave que pide la app antes de BORRAR los datos del teléfono.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * "Cambiar recibidor" y "Cerrar sesión" borran la base local. Si la bitácora del día
 * todavía no cerró, ahí adentro está **el único lugar donde existen** los recibos de la
 * mañana: no se imprimieron todos, no subieron, y no hay copia en ninguna parte. Dos
 * toques en un menú, con el teléfono en una mano y bajo el sol, y se pierde el día.
 *
 * El diálogo de confirmación no alcanza para eso. Un "¿Seguro?" se acepta por reflejo;
 * escribir una clave obliga a detenerse.
 *
 * ── POR QUÉ NO SE PREGUNTA AL SERVIDOR ──────────────────────────────────────
 *
 * Porque el momento en que esto importa es justamente el que NO tiene red. Un recibidor
 * en la montaña no puede esperar a que el servidor valide nada, y una guarda que sólo
 * funciona con señal no es una guarda.
 *
 * ── POR QUÉ SE GUARDA LA CLAVE Y NO UN HASH ─────────────────────────────────
 *
 * El primer intento fue guardar SHA-256 con `expo-crypto`. No sirve acá, y la razón vale
 * anotarla: **`expo-crypto` es un módulo NATIVO**. Agregarlo al package.json no lo mete en
 * el APK que ya está instalado — el dev client tendría que recompilarse, y en producción
 * habría que repartir un APK nuevo a cada teléfono. Un cambio de esta escala no puede
 * costar eso.
 *
 * Así que se usa `expo-secure-store`, que ya está en el APK y guarda cifrado contra el
 * keystore de Android: el mismo lugar donde ya viven los tokens de sesión, que valen
 * bastante más que esta clave.
 *
 * ⚠️ NO ES UNA BARRERA DE SEGURIDAD, Y NO HAY QUE TRATARLA COMO TAL. Es una confirmación
 * deliberada contra el toque accidental. Quien tenga el teléfono desbloqueado puede
 * desinstalar la app y borrar todo igual; lo que esto evita es el error, no el ataque. Si
 * algún día tiene que ser una barrera de verdad, ahí sí vale el hash y el APK nuevo.
 *
 * ⚠️ La clave se sella al INICIAR SESIÓN. Si se cambia en el web después, acá sigue
 * valiendo la vieja hasta el próximo login. Es aceptable para lo que esto hace
 * —confirmar una intención, no autenticar— pero conviene saberlo.
 */

const CLAVE_KEY = "recibos.clave_local";

/**
 * Sella la clave al iniciar sesión.
 *
 * Un fallo al guardar NO debe romper el login: la app queda sin la guarda, que es
 * exactamente como estaba antes, y eso es mucho mejor que no dejar entrar a trabajar.
 */
export async function recordarClave(usuario: string, clave: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(CLAVE_KEY, `${usuario.trim().toLowerCase()}\n${clave}`);
  } catch (e) {
    console.info("no se pudo guardar la clave local", e);
  }
}

/** ¿Hay clave sellada? Falso en sesiones abiertas antes de que esto existiera. */
export async function hayClave(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(CLAVE_KEY)) != null;
  } catch {
    return false;
  }
}

/**
 * ¿La clave escrita es la de esta sesión?
 *
 * Sin nada sellado devuelve `false` y quien llame decide: la política es NO bloquear al
 * usuario —una sesión vieja no puede quedar sin poder cerrarse nunca— sino caer a la
 * confirmación de siempre. Ver `hayClave`.
 */
export async function verificarClave(usuario: string, clave: string): Promise<boolean> {
  try {
    const guardado = await SecureStore.getItemAsync(CLAVE_KEY);
    if (!guardado) return false;
    return guardado === `${usuario.trim().toLowerCase()}\n${clave}`;
  } catch {
    return false;
  }
}

/** Se borra junto con la sesión: una clave que sobrevive a su usuario no protege nada. */
export async function olvidarClave(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CLAVE_KEY);
  } catch {
    // Si no se puede borrar, el próximo login la sobrescribe igual.
  }
}
