import { database } from "./db";
import type { Compania } from "../db/models";

/**
 * Los defectos de control de calidad que ESTE beneficio registra.
 *
 * ── QUÉ SON, Y QUÉ NO SON ───────────────────────────────────────────────────
 *
 * Además de los cuatro que castigan —verde, flote maduro, flote seco y broca—, `recibos` y
 * `remedida` tienen tres columnas más: `pinton`, `granopasa` y `flotenegro`.
 *
 * ⚠️ SÓLO REGISTRAN. Son porcentajes de control de calidad y **no producen rebajo**: no hay
 * columnas de rebajo para ellos ni filas en `rc_tipocastigo`, y no las necesitan.
 *
 * Esa es la propiedad que hace seguro agregarlos: **el cálculo no se toca**. El motor es un
 * port verificado contra los 38 550 recibos de la cosecha, y sigue dando los mismos números.
 * Estos campos entran y salen sin pasar por él.
 *
 * ⚠️ SI ALGÚN DÍA UNO DE ELLOS PASA A CASTIGAR, esto deja de alcanzar: haría falta su fila en
 * `rc_tipocastigo`, sus topes en `castigos_cosecha`, sus columnas de rebajo en `recibos` —que
 * hoy no existen— y su bloque en el cálculo de los dos lados. No es un campo más.
 *
 * ── POR QUÉ ES POR EMPRESA ──────────────────────────────────────────────────
 *
 * No todos los beneficios los usan. En Altura las tres columnas están en CERO en los 38 550
 * recibos de la cosecha; en otros son parte del control diario. Mostrar campos que nadie
 * llena ensucia una pantalla que se usa decenas de veces al día, e imprimir renglones en cero
 * gasta papel.
 */

/** Los que existen. El orden es el de captura y el de impresión. */
export const DEFECTOS = [
  { campo: "pinton", etiqueta: "% Pintón" },
  { campo: "granopasa", etiqueta: "% Grano pasa" },
  { campo: "flotenegro", etiqueta: "% Flote negro" },
] as const;

export type CampoDefecto = (typeof DEFECTOS)[number]["campo"];

/**
 * Los que usa este beneficio, en el orden de `DEFECTOS`.
 *
 * Se filtra contra la lista conocida en vez de confiar en el texto: si alguien escribe mal un
 * nombre en `ge_companias.ben_defectos`, se ignora en vez de romper la pantalla con un campo
 * que no existe.
 */
export async function defectosDeLaEmpresa(): Promise<typeof DEFECTOS[number][]> {
  const empresas = await database.get<Compania>("companias").query().fetch();
  const declarados = (empresas[0]?.defectos ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== "");

  return DEFECTOS.filter((d) => declarados.includes(d.campo));
}
