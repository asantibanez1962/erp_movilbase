import * as SecureStore from "expo-secure-store";

/**
 * Cómo imprime ESTE teléfono el recibo y la remedida.
 *
 * ── POR QUÉ HAY QUE ELEGIR ──────────────────────────────────────────────────
 *
 * `driver` manda el HTML al diálogo de impresión de Android, que se lo pasa a **ESCprint
 * Service**. Conserva la tipografía del web, así que el papel sale igual venga del móvil o
 * de la oficina. El precio es que ese servicio hay que instalarlo y configurarlo en cada
 * teléfono —abrirlo una vez, dejar una sola impresora, elegir el tamaño de papel— y hay
 * usuarios que no pueden o no quieren hacerlo.
 *
 * `directo` abre el socket y escribe ESC/POS, como el legacy. No necesita nada instalado.
 *
 * ⚠️ Y NO ES SÓLO "LA OPCIÓN POBRE". Sin diálogo son **un toque por documento en vez de
 * cuatro**, y en un recibidor que emite decenas al día eso pesa más que la tipografía. El
 * logo tampoco se pierde: va como imagen ráster.
 *
 * Lo que sí se pierde es la fuente proporcional — el texto sale en la monoespaciada interna
 * de la impresora.
 *
 * ── POR QUÉ POR TELÉFONO Y NO POR CLIENTE ───────────────────────────────────
 *
 * Va guardado acá y no en `clientes.json` porque la decisión no es del beneficio sino del
 * equipo: dos recibidores de la misma empresa pueden tener teléfonos distintos, y uno tener
 * el driver instalado y el otro no. Es el mismo criterio que la dirección del servidor.
 *
 * ⚠️ LA BITÁCORA NO ENTRA EN ESTA ELECCIÓN. Siempre va directa, porque su largo depende de
 * cuántos recibos lleve y el diálogo impone una página fija que la partiría en cualquier
 * lado. Ver `bitacoraTexto.ts`.
 */
export type ModoImpresion = "driver" | "directo";

const CLAVE = "recibos.modoImpresion";

/**
 * `driver` por defecto: es el papel que coincide con el del web, y quien no tenga el
 * servicio instalado lo va a descubrir en el primer intento, con un error que lo dice. Al
 * revés —arrancar en directo— nadie descubriría que existe la versión con tipografía.
 */
const POR_DEFECTO: ModoImpresion = "driver";

let enMemoria: ModoImpresion | null = null;

/** El modo vigente. Válido después de `cargarModoImpresion()`. */
export function modoImpresion(): ModoImpresion {
  return enMemoria ?? POR_DEFECTO;
}

/**
 * Lee la preferencia del teléfono. Se llama al arrancar, junto con la del servidor.
 *
 * Si SecureStore falla se sigue con el modo por defecto: quedarse sin poder imprimir por no
 * poder leer una preferencia sería peor que ignorarla.
 */
export async function cargarModoImpresion(): Promise<ModoImpresion> {
  try {
    const guardado = await SecureStore.getItemAsync(CLAVE);
    enMemoria = guardado === "directo" || guardado === "driver" ? guardado : POR_DEFECTO;
  } catch {
    enMemoria = POR_DEFECTO;
  }
  return enMemoria;
}

/**
 * Guarda la preferencia y la deja vigente de inmediato.
 *
 * A diferencia de la dirección del servidor, acá NO hace falta reiniciar la app: el modo se
 * consulta en cada impresión, no al construir un cliente. Es a propósito — ese problema ya
 * nos costó una tarde con la URL del servidor.
 */
export async function guardarModoImpresion(modo: ModoImpresion): Promise<void> {
  await SecureStore.setItemAsync(CLAVE, modo);
  enMemoria = modo;
}
