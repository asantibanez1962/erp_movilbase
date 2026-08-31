import { useWindowDimensions } from "react-native";

/**
 * Medidas de la pantalla, para una app que SIEMPRE corre en horizontal.
 *
 * El equipo de destino es una tableta —Galaxy Tab A7 o una genérica— pero se
 * prueba en teléfono, y en horizontal esos dos aparatos se diferencian sobre
 * todo en el ALTO: la tableta da ~800dp y el teléfono apenas ~360dp. El ancho,
 * en cambio, sobra en ambos (800dp o más). Por eso todas las pantallas se
 * arman en dos columnas y lo que se ajusta es la escala vertical.
 *
 * NO SE ESCALA POR ANCHO. Estirar la tipografía con el ancho es lo que hace
 * que una app se vea inflada en tableta; acá el ancho se gasta en poner cosas
 * lado a lado, que es lo que el operario aprovecha.
 *
 * Los toques nunca bajan de 44dp aunque la escala diga otra cosa: el que usa
 * esto trae guantes de bodega.
 */

const TOQUE_MINIMO = 44;

export interface Medidas {
  ancho: number;
  alto: number;
  /** Teléfono en horizontal: hay que apretar todo verticalmente. */
  compacta: boolean;
  /** Tableta: sobra alto, conviene agrandar. */
  tableta: boolean;
  /** Escala una medida (padding, margen, tipografía). */
  e: (n: number) => number;
  /** Escala una altura tocable, sin bajar de 44dp. */
  t: (n: number) => number;
  /**
   * Columnas que caben en un ancho MEDIDO, con botones de ~`min` dp.
   *
   * El ancho hay que medirlo con onLayout, no calcularlo restando el panel al
   * ancho de pantalla: esa cuenta ya fallo una vez —daba 2 columnas donde
   * cabia 1— y el sintoma fue un boton con el nombre de la ubicacion cortado,
   * que es justo el dato que el operario necesita leer.
   */
  columnas: (anchoMedido: number, min?: number) => number;
}

export function useMedidas(): Medidas {
  const { width, height } = useWindowDimensions();

  const compacta = height < 440;
  const tableta = height >= 680;
  const k = compacta ? 0.8 : tableta ? 1.15 : 1;

  return {
    ancho: width,
    alto: height,
    compacta,
    tableta,
    e: (n) => Math.round(n * k),
    t: (n) => Math.max(TOQUE_MINIMO, Math.round(n * k)),
    columnas: (medido, min = 200) => {
      if (!medido || medido <= 0) return 1;   // antes del primer onLayout
      return Math.max(1, Math.floor(medido / (min * (tableta ? 1.2 : 1))));
    },
  };
}

/**
 * Ancho de la columna de filtros/ficha. Fijo y no un porcentaje: lo que va ahí
 * son etiquetas y un campo de texto, que no mejoran por ser más anchos. Todo
 * el ancho extra de la tableta se lo lleva la lista, que sí lo aprovecha.
 */
export function anchoPanel(m: Medidas): number {
  return m.compacta ? 260 : m.tableta ? 360 : 300;
}
