import { PermissionsAndroid, Platform } from "react-native";
import RNBluetoothClassic, { type BluetoothDevice } from "react-native-bluetooth-classic";

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
 * Abre el socket, probando primero seguro y después inseguro.
 *
 * ⚠️ NO ES UN REINTENTO POR LAS DUDAS: son dos formas distintas de socket RFCOMM. El
 * legacy usa `createRfcommSocketToServiceRecord`, que es el SEGURO, y le funciona — por eso
 * se prueba primero. Pero en Android moderno el seguro exige garantías de emparejamiento
 * que muchas térmicas baratas no cumplen, y falla con un `java.io.IOException` que no dice
 * nada. Ahí entra el inseguro, que es lo que usa casi toda integración con estas
 * impresoras.
 *
 * `charset` en ISO-8859-1 y no el `ascii` por defecto: los comandos ESC/POS son bytes, y en
 * ascii todo lo que pase de 127 se mutila.
 */
async function conectar(impresora: BluetoothDevice): Promise<boolean> {
  const opciones = { connectorType: "rfcomm", delimiter: "", charset: "ISO-8859-1" };
  try {
    return await impresora.connect({ ...opciones, secureSocket: true });
  } catch {
    return await impresora.connect({ ...opciones, secureSocket: false });
  }
}

/**
 * Pide `BLUETOOTH_CONNECT` en runtime.
 *
 * ⚠️ DECLARARLO EN EL MANIFEST NO ALCANZA. Desde Android 12 (API 31) es permiso de runtime:
 * sin pedirlo, `getBondedDevices()` tira SecurityException y el error que ve el recibidor no
 * menciona ningún permiso — parece que la impresora no existe.
 *
 * En Android 11 y anteriores el permiso viejo del manifest sí alcanza, y pedir uno que no
 * existe en esa versión falla. Por eso el corte por `Platform.Version`.
 */
async function pedirPermiso(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 31) return;

  const resultado = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    {
      title: "Permiso para imprimir",
      message: "La jornada se imprime conectándose a la impresora por Bluetooth.",
      buttonPositive: "Permitir",
      buttonNegative: "Ahora no",
    }
  );

  if (resultado !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error(
      "Sin permiso de Bluetooth no se puede imprimir la jornada. Se otorga una sola vez."
    );
  }
}

/**
 * Manda el texto a la impresora y devuelve cuando terminó de escribirse.
 *
 * ⚠️ QUE ESTO CUMPLA NO PRUEBA QUE SALIÓ EL PAPEL. Se confirma que los bytes entraron al
 * socket, no que la impresora tuviera rollo. Es la misma limitación que con el diálogo de
 * Android, y se resuelve igual: la operación mira el papel. Por eso `cerrarBitacora`
 * imprime ANTES de marcar la hora final — si algo falla, la jornada queda abierta.
 */
export async function imprimirTexto(texto: string): Promise<void> {
  await pedirPermiso();

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
  const comoSeLlama = impresora.name?.trim() || impresora.address;
  let conectada = false;
  try {
    // `rfcomm` es Serial Port Profile, lo mismo que el UUID 00001101-… del legacy: es lo
    // que hablan las térmicas. Sin delimitador porque no esperamos respuesta.
    try {
      conectada = await conectar(impresora);
    } catch (e) {
      /**
       * ⚠️ UN SOCKET SPP LO TIENE UN SOLO PROCESO A LA VEZ. El `java.io.IOException` que
       * tira Android acá casi siempre significa que la impresora ya está tomada — y el
       * sospechoso número uno es **ESCprint Service**, el driver que usa el recibo, que
       * tiene una opción "Keep alive service" para no soltar la conexión.
       *
       * El mensaje crudo no dice nada de eso, y el recibidor termina revisando el
       * Bluetooth, la carga y el rollo. Se traduce acá, con el orden de lo que hay que
       * probar.
       */
      throw new Error(
        `No se pudo abrir la impresora "${comoSeLlama}".\n\n` +
          "Suele ser que otra app la tiene conectada: el servicio de impresión que usa el " +
          "recibo la retiene si tiene activado \"Keep alive\". Apagá y encendé la " +
          "impresora, o desactivá esa opción.\n\n" +
          `Detalle: ${(e as Error)?.message ?? e}`
      );
    }
    if (!conectada) {
      throw new Error(
        `No se pudo conectar con "${comoSeLlama}". Verificá que esté encendida y cerca.`
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
