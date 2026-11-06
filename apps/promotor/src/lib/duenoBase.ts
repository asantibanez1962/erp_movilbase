import * as SecureStore from "expo-secure-store";
import { database } from "./db";
import { useSesion } from "./sesion";
import { registrarEvento } from "./bitacora";

/**
 * Vive en su propio archivo y no en alcance.ts por una razón concreta: api.ts
 * necesita llamarlo al arrancar, y alcance.ts importa contexto.ts, que importa
 * api.ts. El ciclo resultante no es teórico — dejó `asegurarDuenoBase` sin
 * definir en runtime la primera vez que se cableó así, y sólo se notó porque la
 * llamada estaba envuelta en try/catch y quedó como advertencia en el log.
 */

/**
 * DUEÑO de la base local: el usuario al que pertenecen los datos del teléfono.
 *
 * POR QUÉ EXISTE
 * --------------
 * Antes el borrado estaba atado a SALIR: cerrar sesión reseteaba la base. Eso
 * convertía una acción cotidiana —salir para volver a entrar, por ejemplo para
 * que el token tome un permiso nuevo— en una operación destructiva, y dejaba al
 * promotor sin forma de salir con trabajo sin enviar adentro.
 *
 * Pero lo que justifica borrar no es salir: es ENTRAR CON OTRO USUARIO. Los datos
 * locales están recortados a un usuario y sus zonas, y mostrárselos a otro sería
 * filtrarle información que no le toca. Por eso el borrado se movió a ese momento.
 *
 * Se guarda persistido y se verifica también AL ARRANCAR, no sólo al loguearse.
 * Si sólo se chequeara en el login, un cierre de la app entre el login y el
 * borrado dejaría al usuario nuevo con la base del anterior — improbable, pero es
 * justo la clase de ventana que no se descubre hasta que pasa.
 */
const K_DUENO = "promotor.duenoBase";

/**
 * Se asegura de que la base local pertenezca a `userId`. Si era de otro, la borra.
 *
 * Devuelve true si borró — quien llama decide si avisar. No pregunta ni pide
 * confirmación: llegado este punto el usuario nuevo ya se autenticó, y la
 * alternativa a borrar es mostrarle los datos de otra persona.
 *
 * OJO: esto SÍ descarta trabajo sin enviar del usuario anterior. Es inevitable —
 * esas filas se pushean con el token de quien las creó— y por eso el aviso de
 * pendientes vive antes, al salir.
 */
export async function asegurarDuenoBase(userId: number): Promise<boolean> {
  const actual = String(userId);
  let anterior: string | null = null;
  try {
    anterior = await SecureStore.getItemAsync(K_DUENO);
  } catch {
    // Sin poder leer la marca no se puede afirmar que la base sea de este usuario.
    // Se borra: equivocarse borrando cuesta un sync; equivocarse mostrando datos
    // de otro promotor no se arregla.
    anterior = null;
  }

  const cambio = anterior != null && anterior !== actual;

  if (cambio) {
    await database.write(async () => {
      await database.unsafeResetDatabase();
    });
    await useSesion.getState().limpiar();
    useSesion.getState().remontar();
    await registrarEvento({
      tipo: "sync",
      ok: true,
      resumen: `Base local rebajada: cambió el usuario (${anterior} -> ${actual})`,
    });
  }

  try {
    await SecureStore.setItemAsync(K_DUENO, actual);
  } catch (err) {
    console.warn("no se pudo marcar el dueño de la base local", err);
  }

  return cambio;
}
