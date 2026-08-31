import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

/**
 * URL del backend, con override guardado en el teléfono.
 *
 * POR QUÉ NO ALCANZA CON COMPILARLA
 * ---------------------------------
 * Cada beneficio corre su propio backend en su red local. La IP va en app.json
 * y queda dentro del APK, pero eso obliga a recompilar y reinstalar cada vez que un
 * cliente cambia de servidor, le mueven el DHCP o simplemente no sabíamos la IP al
 * momento de generar el APK. Con cinco clientes y un solo instalador por cliente,
 * eso es una visita técnica por cada cambio de red.
 *
 * Con el override, quien instala corrige la dirección desde la pantalla de Servidor.
 *
 * PRECEDENCIA (de mayor a menor)
 *   1. Lo que el usuario guardó en este teléfono   (SecureStore)
 *   2. EXPO_PUBLIC_API_URL                          (dev, al lanzar expo start)
 *   3. La del cliente compilado                     (app.json → expo.extra)
 *   4. El loopback del emulador                     (último recurso)
 *
 * El override va arriba de todo a propósito: si alguien lo puso a mano, es porque la
 * compilada no servía.
 *
 * La env var va ARRIBA de la compilada. En desarrollo la tableta llega al backend
 * por el túnel de adb, no por la IP del beneficio: si mandara la compilada,
 * apuntar Metro a un cliente dejaría al aparato sin backend.
 *
 * ⚠ El corolario es que un APK compilado con EXPO_PUBLIC_API_URL en el ambiente se
 * lleva ESA dirección y no la del cliente: no debe quedar en el ambiente al
 * generar un APK de distribución.
 */

const K_URL = "bodega.apiBaseUrl";

function porDefectoSinOverride(): string {
  return (
    process.env.EXPO_PUBLIC_API_URL ??
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    "http://10.0.2.2:5249"
  );
}

/**
 * Cache sincrónica. Existe porque `config.apiBaseUrl` y el cliente axios se leen sin
 * poder esperar: la lectura de SecureStore se hace una vez, en `cargarUrlServidor()`,
 * antes de construir el cliente HTTP.
 */
let urlEnMemoria: string | null = null;

/** La URL vigente. Válida sólo después de `cargarUrlServidor()`. */
export function urlServidor(): string {
  return urlEnMemoria ?? porDefectoSinOverride();
}

/** La que viene compilada, para mostrarla como referencia en la pantalla. */
export function urlCompilada(): string {
  return porDefectoSinOverride();
}

/** Si la que se está usando es un override manual y no la del APK. */
export function hayOverride(): boolean {
  return urlEnMemoria != null && urlEnMemoria !== porDefectoSinOverride();
}

/**
 * Lee el override del teléfono. Se llama UNA vez, al arrancar, antes de crear el
 * cliente HTTP.
 *
 * Si SecureStore falla se sigue con la compilada: quedarse sin app por no poder leer
 * una preferencia sería peor que ignorarla.
 */
export async function cargarUrlServidor(): Promise<string> {
  try {
    const guardada = await SecureStore.getItemAsync(K_URL);
    urlEnMemoria = guardada?.trim() ? guardada.trim() : porDefectoSinOverride();
  } catch {
    urlEnMemoria = porDefectoSinOverride();
  }
  return urlEnMemoria;
}

/**
 * Valida y normaliza lo que el usuario escribió.
 *
 * Se es estricto acá y no al usarla: una URL mal escrita se manifiesta como "error de
 * conexión" en medio del campo, sin ninguna pista de que el problema es un espacio de
 * más. Es preferible rechazarla mientras la persona la está viendo.
 */
export function normalizarUrl(entrada: string): string {
  const texto = entrada.trim();
  if (!texto) throw new Error("Escribí la dirección del servidor.");

  // Sin esquema se asume http: los backends son locales y casi nunca tienen TLS.
  const conEsquema = /^https?:\/\//i.test(texto) ? texto : `http://${texto}`;

  let u: URL;
  try {
    u = new URL(conEsquema);
  } catch {
    throw new Error(`"${texto}" no es una dirección válida. Ejemplo: 192.168.1.50:5249`);
  }
  if (!u.hostname) throw new Error("Falta el nombre o la IP del servidor.");

  // Sin barra final ni path: las rutas del API se concatenan como "/api/...".
  // Una barra de más produce "//api/..." y algunos proxies lo rechazan.
  return `${u.protocol}//${u.host}`;
}

/** Guarda el override. Devuelve la URL normalizada que quedó vigente. */
export async function guardarUrlServidor(entrada: string): Promise<string> {
  const url = normalizarUrl(entrada);
  await SecureStore.setItemAsync(K_URL, url);
  urlEnMemoria = url;
  return url;
}

/** Vuelve a la URL que trae el APK. */
export async function restaurarUrlServidor(): Promise<string> {
  try {
    await SecureStore.deleteItemAsync(K_URL);
  } catch {
    // Si no se pudo borrar, igual se vuelve a la compilada en memoria; el próximo
    // arranque leerá la vieja, y eso se ve en la pantalla.
  }
  urlEnMemoria = porDefectoSinOverride();
  return urlEnMemoria;
}
