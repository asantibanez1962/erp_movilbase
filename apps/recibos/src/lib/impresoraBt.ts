import RNBluetoothClassic from "react-native-bluetooth-classic";

/**
 * Envío directo a la impresora térmica por Bluetooth, sin pasar por Android.
 *
 * ── POR QUÉ NO ES EL MISMO CAMINO QUE EL RECIBO ─────────────────────────────
 *
 * El recibo va como HTML por el diálogo de impresión: conserva logo y tipografía, que
 * importan porque es el documento del productor. Pero ese camino impone una **página de
 * tamaño fijo** que decide el driver, y la jornada no tiene largo fijo — depende de cuántos
 * recibos lleve. Con página fija se parte en un punto arbitrario, y un corte arbitrario ya
 * nos imprimió "FIRMA" encima de "NOTA:" en el recibo.
 *
 * Acá se abre un socket serie (SPP/RFCOMM) contra la impresora emparejada, se escriben los
 * bytes y se cierra. **No hay páginas**: la impresora imprime lo que recibe y se detiene.
 *
 * ── SIN PANTALLA DE SELECCIÓN, A PROPÓSITO ──────────────────────────────────
 *
 * Cada teléfono lleva UNA impresora emparejada — por eso el legacy tampoco pregunta cuál
 * usar. Elegirla sería un cuarto paso de configuración por teléfono, sumado a los tres que
 * ya hay para el recibo, y para resolver una ambigüedad que en la práctica no existe.
 *
 * Si algún día hay más de un dispositivo emparejado, el error dice cuáles son y qué hacer:
 * desemparejar lo que no sea la impresora, desde los ajustes del teléfono. Es resoluble sin
 * pantalla nueva.
 *
 * ── QUÉ SE TOMÓ DEL LEGACY Y QUÉ NO ─────────────────────────────────────────
 *
 * El legacy hace exactamente esto, con el UUID estándar de SPP. Dos diferencias:
 *
 *  - ⚠️ **No le habla a todos los emparejados.** El legacy recorre TODOS y les abre socket a
 *    cada uno: la comparación por nombre está comentada en su código. Con una sola
 *    impresora funciona por casualidad; con unos auriculares en la lista, les escribe
 *    también.
 *  - **Un solo socket, pero la escritura sí va troceada.** El legacy parte el texto en
 *    bloques de 1000 bytes y abre una conexión NUEVA por bloque. El troceado se conserva
 *    —está ahí porque en su momento las jornadas largas fallaron, y el buffer de estas
 *    térmicas es de unos pocos KB— pero se trocea la ESCRITURA y no la CONEXIÓN: reconectar
 *    por bloque es lento y deja al recibidor mirando cómo la impresora arranca y para.
 *    Sobre un mismo socket los bytes llegan en orden, así que cortar en cualquier posición
 *    es inocuo aunque parta un comando ESC/POS por la mitad.
 */

/** Bloque de escritura, en bytes. Es el del legacy. */
const BLOQUE = 1000;

/**
 * Pausa entre bloques. No está en el legacy —ahí la daba el costo de reconectar— pero hace
 * falta: sin ella se le entrega todo al socket de una y el buffer de la impresora se
 * desborda, que es el fallo que el troceado venía a evitar.
 */
const PAUSA_MS = 60;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda el texto a la impresora y devuelve cuando terminó de escribirse.
 *
 * ⚠️ QUE ESTO CUMPLA NO PRUEBA QUE SALIÓ EL PAPEL. Se confirma que los bytes entraron al
 * socket, no que la impresora tuviera rollo. Es la misma limitación que con el diálogo de
 * Android, y se resuelve igual: la operación mira el papel. Por eso `cerrarBitacora`
 * imprime ANTES de marcar la hora final — si algo falla, la jornada queda abierta.
 */
export async function imprimirTexto(texto: string): Promise<void> {
  if (!(await RNBluetoothClassic.isBluetoothEnabled())) {
    throw new Error("El Bluetooth está apagado. Encendelo para poder imprimir la jornada.");
  }

  // No se escanea: emparejar es del sistema operativo y se hace una vez. Escanear exigiría
  // permiso de ubicación —Android lo ata al descubrimiento— para resolver algo ya resuelto.
  const emparejados = await RNBluetoothClassic.getBondedDevices();

  if (emparejados.length === 0) {
    throw new Error(
      "No hay ninguna impresora emparejada con este teléfono. Emparejala desde los " +
        "ajustes de Bluetooth."
    );
  }
  if (emparejados.length > 1) {
    const cuales = emparejados.map((d) => d.name?.trim() || d.address).join(", ");
    throw new Error(
      `Hay más de un dispositivo Bluetooth emparejado (${cuales}) y no se puede saber ` +
        "cuál es la impresora. Dejá emparejada sólo la impresora, desde los ajustes del " +
        "teléfono."
    );
  }

  const impresora = emparejados[0]!;
  let conectada = false;
  try {
    // `rfcomm` es Serial Port Profile, lo mismo que el UUID 00001101-… del legacy: es lo
    // que hablan las térmicas. Sin delimitador porque no esperamos respuesta.
    conectada = await impresora.connect({ connectorType: "rfcomm", delimiter: "" });
    if (!conectada) {
      throw new Error(
        `No se pudo conectar con "${impresora.name ?? impresora.address}". ` +
          "Verificá que esté encendida y cerca."
      );
    }
    // ⚠️ `latin1` y no `utf8`: los comandos ESC/POS son BYTES, no texto. En utf8 cualquier
    // valor sobre 127 se codifica en dos bytes y la impresora recibe basura. Las tildes no
    // son problema: los nombres ya bajan sin acentos por esta misma impresora.
    for (let i = 0; i < texto.length; i += BLOQUE) {
      await impresora.write(texto.slice(i, i + BLOQUE), "latin1");
      if (i + BLOQUE < texto.length) await esperar(PAUSA_MS);
    }
  } finally {
    // Siempre se cierra, salga bien o mal: un socket abierto deja la impresora ocupada y el
    // siguiente intento falla sin decir por qué.
    if (conectada) await impresora.disconnect().catch(() => undefined);
  }
}
