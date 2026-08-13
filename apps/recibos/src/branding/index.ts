import Constants from "expo-constants";
import type { ImageSourcePropType } from "react-native";

/**
 * Branding del cliente para el que se compiló este APK.
 *
 * El QUÉ (nombre, color, logo) sale de clientes.json vía app.config.js, que lo deja
 * en expo.extra.cliente. Acá sólo se resuelve el logo —que Metro exige requerir con
 * ruta literal— y se derivan los colores de la UI.
 *
 * POR QUÉ EL COLOR DE LA MARCA NO SE USA TAL CUAL EN EL CHROME
 * -----------------------------------------------------------
 * El header, la tab bar y el drawer llevan texto claro (#f1f5f9). El verde de Café
 * Altura contra ese texto da 2.6:1 de contraste, menos de la mitad del mínimo de
 * 4.5:1 que pide WCAG AA. En una oficina se lee igual; en un cafetal al mediodía,
 * que es donde se usa esta app, no.
 *
 * Así que el chrome usa el color de marca OSCURECIDO hasta que el texto sea legible.
 * Se oscurece —y no se cambia por un gris— para que el tono siga siendo el de la
 * empresa: el promotor tiene que reconocer su app de un vistazo. El color puro se
 * conserva aparte, en `marca`, para superficies donde no hay texto encima.
 */

interface ClienteExtra {
  id: string;
  nombre: string;
  nombreLargo: string;
  color: string;
  /** Fijo en clientes.json; si viene null se deriva del color de marca. */
  acento?: string | null;
  tieneLogo: boolean;
}

/**
 * Si el manifest no trae el bloque —config vieja cacheada, o un arranque raro— se usa
 * el perfil de desarrollo. Quedarse sin colores rompería la app entera por un dato
 * cosmético.
 */
const FALLBACK: ClienteExtra = {
  id: "dev",
  nombre: "Promotor",
  nombreLargo: "Promotor",
  color: "#0f172a",
  acento: "#3b82f6",
  tieneLogo: false,
};

const extra = (Constants.expoConfig?.extra?.cliente as ClienteExtra | undefined) ?? FALLBACK;

/**
 * Logos por cliente.
 *
 * Metro resuelve los assets en build time, así que la ruta de `require` tiene que ser
 * un literal — no se puede armar con el id. De ahí el mapa explícito.
 *
 * Un cliente sin PNG puesto queda en `null` y la UI cae al nombre en texto. Requerir
 * un archivo inexistente rompe el bundle entero, no sólo esa pantalla.
 */
const LOGOS: Record<string, ImageSourcePropType | null> = {
  dev: null,
  altura: require("../../assets/clientes/altura.png"),
  laeva: require("../../assets/clientes/laeva.png"),
  diamante: require("../../assets/clientes/diamante.png"),
  santacruz: require("../../assets/clientes/santacruz.png"),
  marespi: require("../../assets/clientes/marespi.png"),
};

// ─── Color ───────────────────────────────────────────────────────────

function aRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
}

function aHex([r, g, b]: [number, number, number]): string {
  const p = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

/** Luminancia relativa de WCAG 2.1 (§ definición de contrast ratio). */
function luminancia([r, g, b]: [number, number, number]): number {
  const lineal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
}

function contraste(a: string, b: string): number {
  const la = luminancia(aRgb(a));
  const lb = luminancia(aRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Aclara `color` hasta que contra `fondo` alcance `minimo` de contraste.
 *
 * Es la operación inversa a la de abajo y hace falta para el acento: el color de
 * marca puro sobre el chrome —que es ese mismo color oscurecido— da alrededor de
 * 1.5:1. El tab activo quedaría indistinguible del inactivo, que es justo lo único
 * que ese color tiene que comunicar.
 *
 * El mínimo es 3:1 y no 4.5:1 porque WCAG pide 3:1 para íconos y texto grande, que
 * es lo que hay en una tab bar.
 */
function aclararHastaContraste(color: string, fondo: string, minimo: number): string {
  let rgb = aRgb(color);
  for (let i = 0; i < 60 && contraste(aHex(rgb), fondo) < minimo; i++) {
    rgb = [
      rgb[0] + (255 - rgb[0]) * 0.06,
      rgb[1] + (255 - rgb[1]) * 0.06,
      rgb[2] + (255 - rgb[2]) * 0.06,
    ];
  }
  return aHex(rgb);
}

/**
 * Oscurece `color` hasta que contra `texto` alcance `minimo` de contraste.
 *
 * Mezcla hacia el negro en pasos chicos en vez de calcular el factor exacto: el
 * despeje analítico existe, pero con 2 líneas de loop el resultado es el mismo y se
 * puede leer sin desenrollar la fórmula de luminancia. Corre una vez al arrancar.
 *
 * El tope de iteraciones es una red de seguridad, no un caso esperado: un color que
 * no llegue al mínimo ni siendo casi negro no existe con texto claro.
 */
function oscurecerHastaContraste(color: string, texto: string, minimo: number): string {
  let rgb = aRgb(color);
  for (let i = 0; i < 60 && contraste(aHex(rgb), texto) < minimo; i++) {
    rgb = [rgb[0] * 0.97, rgb[1] * 0.97, rgb[2] * 0.97];
  }
  return aHex(rgb);
}

const TEXTO_CHROME = "#f1f5f9";

const chrome = oscurecerHastaContraste(extra.color, TEXTO_CHROME, 4.5);

/** El cliente activo, con lo que la UI necesita para pintarse. */
export const cliente = {
  id: extra.id,
  nombre: extra.nombre,
  nombreLargo: extra.nombreLargo,
  /** Color de marca puro. Para superficies sin texto claro encima. */
  marca: extra.color,
  /**
   * Color del header, la tab bar y el drawer. Es el de marca, oscurecido lo justo
   * para que el texto claro se lea al sol. Para `dev` es el navy de siempre, así que
   * el look conocido no cambia.
   */
  chrome,
  /**
   * Acento sobre el chrome: hoy, el tab activo. El de marca aclarado hasta separarse
   * del fondo, salvo que clientes.json lo fije (es el caso de `dev`, donde aclarar el
   * navy daría un gris azulado en vez del azul conocido).
   */
  // Se comprueba que sea un string y no sólo que exista: Expo convierte los null del
  // manifest en {}, y un objeto pasaría el ?? para terminar en un color NaN.
  acento:
    typeof extra.acento === "string" && extra.acento
      ? extra.acento
      : aclararHastaContraste(extra.color, chrome, 3),
  logo: LOGOS[extra.id] ?? null,
};
