import Constants from "expo-constants";
import type { ImageSourcePropType } from "react-native";

/**
 * Branding del cliente para el que se compiló este APK.
 *
 * El QUÉ (nombre, color, logo) sale de clientes.json vía app.config.js, que lo
 * deja en expo.extra.cliente. Acá sólo se resuelve el logo —que Metro exige
 * requerir con ruta literal— y se derivan los colores de la UI.
 *
 * POR QUE EL COLOR DE MARCA NO SE USA TAL CUAL
 * --------------------------------------------
 * El header, los botones y las filas seleccionadas llevan texto claro. Un verde
 * de marca contra texto claro puede dar menos de 3:1 de contraste: en una
 * oficina se lee igual, en una bodega con luz de galpón y una tableta con la
 * pantalla sucia, no.
 *
 * Así que el chrome usa el color de marca OSCURECIDO hasta que el texto claro
 * sea legible. Se oscurece —y no se cambia por un gris— para que el tono siga
 * siendo el de la empresa. El color puro se conserva aparte, en `marca`, para
 * superficies donde no hay texto encima.
 *
 * Es la misma lógica que la app del promotor, y a propósito: si un beneficio usa
 * las dos, tienen que reconocerse como la misma familia.
 */

interface ClienteExtra {
  id: string;
  nombre: string;
  nombreLargo: string;
  color: string;
  /** Fijo en clientes.json; si no viene se deriva del color de marca. */
  acento?: string | null;
  tieneLogo: boolean;
}

/**
 * Si el manifest no trae el bloque —config vieja cacheada, o un arranque raro—
 * se usa el perfil de desarrollo. Quedarse sin colores rompería la app entera
 * por un dato cosmético.
 */
const FALLBACK: ClienteExtra = {
  id: "dev",
  nombre: "Bodega",
  nombreLargo: "Bodega",
  color: "#3f8f2e",
  tieneLogo: false,
};

const extra = (Constants.expoConfig?.extra?.cliente as ClienteExtra | undefined) ?? FALLBACK;

/**
 * Logos por cliente.
 *
 * Metro resuelve los assets en build time, así que la ruta del `require` tiene
 * que ser un literal — no se puede armar con el id. De ahí el mapa explícito.
 *
 * SOLO SE LISTAN LOS PNG QUE EXISTEN. Requerir un archivo que no está rompe el
 * bundle entero, no sólo esa pantalla: al agregar el logo de un cliente hay que
 * poner el archivo en assets/clientes/ Y sumar su línea acá. Un cliente sin
 * entrada queda en null y la UI cae al nombre en texto, que es lo correcto
 * mientras el logo no llegue.
 */
const LOGOS: Record<string, ImageSourcePropType | null> = {
  dev: null,
  // El demo reusa el logo de Altura a propósito: se ve como una app de verdad.
  // Lo que lo distingue es el nombre, que dice DEMO.
  demo: require("../../assets/clientes/altura.png"),
  altura: require("../../assets/clientes/altura.png"),
  laeva: require("../../assets/clientes/laeva.png"),
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
 * Para el acento: el color de marca puro sobre el chrome —que es ese mismo
 * color oscurecido— da alrededor de 1.5:1 y no se distinguiría.
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
 * El tope de iteraciones es una red de seguridad, no un caso esperado: un color
 * que no llegue al mínimo ni siendo casi negro no existe con texto claro.
 */
function oscurecerHastaContraste(color: string, texto: string, minimo: number): string {
  let rgb = aRgb(color);
  for (let i = 0; i < 60 && contraste(aHex(rgb), texto) < minimo; i++) {
    rgb = [rgb[0] * 0.97, rgb[1] * 0.97, rgb[2] * 0.97];
  }
  return aHex(rgb);
}

const TEXTO_CHROME = "#ffffff";

const chrome = oscurecerHastaContraste(extra.color, TEXTO_CHROME, 4.5);

/** El cliente activo, con lo que la UI necesita para pintarse. */
export const cliente = {
  id: extra.id,
  nombre: extra.nombre,
  nombreLargo: extra.nombreLargo,
  /** Color de marca puro. Para superficies sin texto claro encima. */
  marca: extra.color,
  /**
   * El color de todo lo que lleva texto blanco: header, botones, filas
   * seleccionadas. Es el de marca oscurecido lo justo para que se lea.
   */
  chrome,
  /** Acento sobre el chrome, para lo que tiene que separarse del fondo. */
  acento:
    typeof extra.acento === "string" && extra.acento
      ? extra.acento
      : aclararHastaContraste(extra.color, chrome, 3),
  logo: LOGOS[extra.id] ?? null,
};

/**
 * El color con el que se pinta la app.
 *
 * Vivía como constante en una pantalla, que era el lugar equivocado: un color
 * de marca no es de una pantalla. Se exporta desde acá para que todas usen el
 * del cliente compilado.
 */
export const VERDE = cliente.chrome;
