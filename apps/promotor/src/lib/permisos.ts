import { Linking } from "react-native";
// El objeto `Camera` y no los named exports: en expo-camera 17 las funciones
// imperativas de permisos (get/requestCameraPermissionsAsync) sólo se exportan ahí.
// Los named exports del módulo son el hook `useCameraPermissions`, que no sirve fuera
// de un componente.
import { Camera } from "expo-camera";
import * as Location from "expo-location";

/**
 * Permisos de cámara y ubicación.
 *
 * POR QUÉ ANDROID VUELVE A PREGUNTAR
 * ----------------------------------
 * Un permiso concedido en Android es permanente: no hace falta pedirlo de nuevo. Si
 * el teléfono pregunta cada vez, es por una de tres razones, y ninguna se arregla
 * pidiéndolo otra vez:
 *
 *   1. El usuario tocó "Solo esta vez". Desde Android 11 ése es un permiso de UNA
 *      sesión: se revoca cuando la app pasa a segundo plano un rato. La opción que
 *      lo hace permanente es "Mientras usas la app".
 *   2. Android auto-revoca los permisos de las apps que no se usan por meses
 *      (Ajustes → la app → Permisos → "Quitar permisos si no se usa").
 *   3. El usuario lo denegó dos veces. Ahí el sistema ya no muestra el diálogo
 *      nunca más (`canAskAgain: false`) y el único camino es Ajustes.
 *
 * Lo que SÍ está de nuestro lado:
 *   - No volver a pedir lo que ya está concedido. `requestXAsync` a secas es lo que
 *     dispara el diálogo; consultar primero con `getXAsync` no molesta a nadie.
 *   - Pedir los dos juntos UNA vez al entrar al contexto de trabajo, cuando el
 *     promotor todavía está bajo techo y con las manos libres — no en medio de una
 *     visita, donde el diálogo interrumpe la captura y se toca "Solo esta vez" para
 *     salir del paso (que es justo lo que causa el problema 1).
 *   - Cuando el sistema ya no va a preguntar, mandarlo a Ajustes en vez de repetir
 *     un botón que no hace nada.
 */

export interface EstadoPermiso {
  concedido: boolean;
  /** false = el sistema ya no muestra el diálogo; sólo queda Ajustes. */
  puedeVolverAPreguntar: boolean;
}

const DENEGADO: EstadoPermiso = { concedido: false, puedeVolverAPreguntar: false };

/**
 * Concedido o no, pidiéndolo sólo si hace falta.
 *
 * `pedirSiFalta: false` consulta sin abrir ningún diálogo — es lo que usa el GPS
 * durante la captura, para no interrumpir con un popup cuando lo único que se
 * pierde es el punto (la visita se guarda igual sin coordenadas).
 */
export async function permisoCamara(pedirSiFalta = true): Promise<EstadoPermiso> {
  try {
    const actual = await Camera.getCameraPermissionsAsync();
    if (actual.granted) return { concedido: true, puedeVolverAPreguntar: true };
    if (!pedirSiFalta || !actual.canAskAgain) {
      return { concedido: false, puedeVolverAPreguntar: actual.canAskAgain };
    }
    const pedido = await Camera.requestCameraPermissionsAsync();
    return { concedido: pedido.granted, puedeVolverAPreguntar: pedido.canAskAgain };
  } catch (e) {
    console.warn("permiso de cámara falló", (e as Error)?.message);
    return DENEGADO;
  }
}

export async function permisoUbicacion(pedirSiFalta = true): Promise<EstadoPermiso> {
  try {
    const actual = await Location.getForegroundPermissionsAsync();
    if (actual.granted) return { concedido: true, puedeVolverAPreguntar: true };
    if (!pedirSiFalta || !actual.canAskAgain) {
      return { concedido: false, puedeVolverAPreguntar: actual.canAskAgain };
    }
    const pedido = await Location.requestForegroundPermissionsAsync();
    return { concedido: pedido.granted, puedeVolverAPreguntar: pedido.canAskAgain };
  } catch (e) {
    console.warn("permiso de ubicación falló", (e as Error)?.message);
    return DENEGADO;
  }
}

/**
 * Pide los dos permisos de una vez, al entrar al contexto de trabajo.
 *
 * Se llama una sola vez por arranque: si ya están concedidos no hay diálogo, y si
 * el usuario los negó definitivamente tampoco —`permisoX` no insiste—, así que no
 * hace falta recordar si ya se preguntó.
 *
 * Devuelve qué falta para poder avisarlo en pantalla, pero NO bloquea nada: sin
 * cámara se puede seguir capturando visitas y solicitudes, que es el trabajo
 * principal.
 */
export async function pedirPermisosDeCampo(): Promise<{
  camara: EstadoPermiso;
  ubicacion: EstadoPermiso;
}> {
  // En serie y no en paralelo: dos diálogos de sistema simultáneos se apilan y en
  // algunos launchers el segundo se descarta solo.
  const ubicacion = await permisoUbicacion();
  const camara = await permisoCamara();
  return { camara, ubicacion };
}

/** Ajustes del sistema para esta app. Único camino cuando ya no se puede preguntar. */
export async function abrirAjustesDeLaApp(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (e) {
    console.warn("no se pudieron abrir los ajustes", (e as Error)?.message);
  }
}
