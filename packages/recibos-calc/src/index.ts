/**
 * Cálculo del recibo de café, portado desde SQL Server para poder correr **offline en
 * el recibidor**, donde el recibo se imprime y se entrega firmado sin señal.
 *
 * Sin dependencias a propósito: el mismo código corre en Node (para verificarlo contra
 * los recibos históricos de la base) y en React Native (para emitirlos).
 *
 * Ver `docs/app-recibos-design.md` §5.
 */
export { calcularRecibo } from "./calculo";
export { buscarPrecio } from "./precio";
export {
  redondeoCafe,
  redondearACuartillo,
  redondear,
  truncar,
  partirEnCuartillos,
} from "./decimal";
export type {
  CastigoBroca,
  CastigoCosecha,
  Catalogos,
  EntradaCalculo,
  EntradaPrecio,
  Precio,
  RecibidorNivel,
  ResultadoCalculo,
} from "./tipos";
