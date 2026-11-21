/** Filas de `rc_castigosbroca`: matriz de granos brocados × cantidad. */
export interface CastigoBroca {
  granosbroca: number;
  cantidad: number;
  cuartilloscastigo: number;
}

/** Filas de `re_castigos_cosecha`. `tipocastigo`: 1 verde, 2 flote maduro, 3 flote seco. */
export interface CastigoCosecha {
  cosecha: string;
  nivel: number;
  tipocastigo: number;
  topeaceptado: number | null;
  pctcastigo: number | null;
}

/** Filas de `rc_recibidorescosechanivel`. */
export interface RecibidorNivel {
  recibidor: string;
  cosecha: string;
  nivel: number;
}

/** Catálogos que necesita el cálculo. En el móvil salen del SQLite local. */
export interface Catalogos {
  castigosBroca: CastigoBroca[];
  castigosCosecha: CastigoCosecha[];
  recibidorNivel: RecibidorNivel[];
}

/** Lo que el recibidor captura. Mismos nombres que los parámetros del original. */
export interface EntradaCalculo {
  cosecha: string;
  recibidor: string;
  nivel: number;
  cantidadinicial: number;
  cuartillosinicial: number;
  granosbrocados: number;
  verdes: number;
  flotemaduro: number;
  floteseco: number;
  errormedidor: number;
}

/** Lo que devuelve `f_rc_calcula_recibo`, con los mismos nombres de columna. */
export interface ResultadoCalculo {
  cantidad: number;
  castigosbroca: number;
  broca: number;
  cuartillosbroca: number;
  rebajoverde: number;
  cuartillosrebajoverde: number;
  rebajoflote: number;
  cuartillosrebajoflote: number;
  rebajofloteseco: number;
  cuartillosrebajofloteseco: number;
  rcantidad: number;
  rcantidadcuartillos: number;
}

/** Filas de `rc_precios`. */
export interface Precio {
  idreprecio: number;
  cosecha: string;
  tipocafe: string | null;
  calidad: string | null;
  zona: string | null;
  recibidor: string | null;
  tipo: string | null;
  /**
   * Productor al que aplica el precio. Ausente (null/undefined) en las generales, pero
   * también en las filas viejas que el teléfono todavía no re-bajó: ver `buscarPrecio()`.
   */
  idsocio?: number | null;
  /** Ya no identifica al productor en el servidor; sólo sirve a la regla de transición. */
  codigo: string | null;
  monto: number;
  moneda: number;
  recalcula: number;
  flete: number;
}

/** Criterios de búsqueda de precio, en el orden en que los pasa el hook del BE. */
export interface EntradaPrecio {
  cosecha: string;
  /** ⚠️ En `recibos` este código viaja en la columna `zona`, no en una `tipocafe`. */
  tipocafe: string;
  calidad: string;
  /** `codigozona` del recibidor. */
  zona: string;
  recibidor: string;
  /** `idsocio` del productor; `null` si no hay (p. ej. el genérico sin resolver). */
  idsocio: number | null;
  /** Código del productor. Sólo para las filas viejas; ver `buscarPrecio()`. */
  codigo: string;
  /** `tipo` del productor. */
  tipo: string;
}
