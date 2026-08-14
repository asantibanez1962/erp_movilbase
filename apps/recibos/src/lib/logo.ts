import { cliente } from "../branding";
import { LOGOS_IMPRESOS, type LogoImpreso } from "./logosImpresos";

/**
 * El logo que sale en el PAPEL, para el cliente de este APK.
 *
 * Sale del mismo catálogo que la IP y el color: `clientes.json` declara `logoImpreso`, y
 * `scripts/logos-impresos.py` convierte ese PNG a las dos formas que hacen falta. Para
 * cambiarlo de un cliente se reemplaza su archivo en `assets/clientes/impreso/` y se corre
 * el script — no se toca código.
 *
 * ⚠️ ES DISTINTO DEL LOGO DE LA INTERFAZ, y a propósito. Aquél es a color y está pensado
 * para la pantalla; la térmica sólo sabe marcar o no marcar el punto, así que el impreso se
 * prepara aparte en blanco y negro puro. Conviene además que NO lleve el nombre de la
 * empresa: el comprobante ya lo imprime debajo, y repetido en un dibujo de 1 bit se lee peor
 * que el texto.
 *
 * Un cliente sin `logoImpreso` imprime sin logo. Es preferible a imprimir el de otro, que es
 * lo que pasaría con un valor por defecto.
 */
const DEL_CLIENTE: LogoImpreso | undefined = LOGOS_IMPRESOS[cliente.id];

/** Data URI para el `<img>` del recibo y de la remedida. Vacío si el cliente no tiene. */
export const LOGO = DEL_CLIENTE?.png ?? "";

export const HAY_LOGO = DEL_CLIENTE != null;

/** Lo que necesita el comando `GS v 0` de la bitácora. */
export const LOGO_ESCPOS = DEL_CLIENTE
  ? {
      anchoBytes: DEL_CLIENTE.anchoBytes,
      alto: DEL_CLIENTE.alto,
      b64: DEL_CLIENTE.escpos,
    }
  : null;
