import type { EntradaPrecio, Precio } from "./tipos";

/**
 * Port de `dbo.f_rc_busca_precio` — precio del recibo, del más específico al más
 * general.
 *
 * El original filtra por cosecha, tipo de café y calidad de forma obligatoria, y trata
 * `zona`, `recibidor`, `tipo` y `codigo` como opcionales: una fila con NULL en esas
 * columnas aplica a todos. Después ordena poniendo primero las filas que SÍ tienen
 * valor, así el precio de un productor concreto le gana al de su tipo, que le gana al
 * del recibidor, y así sucesivamente.
 *
 *   ORDER BY ISNULL(codigo,' ') DESC, ISNULL(tipo,' ') DESC, ISNULL(recibidor,' ') DESC,
 *            ISNULL(zona,' ') DESC, ISNULL(calidad,' ') DESC, ISNULL(tipocafe,' ') DESC,
 *            idreprecio DESC
 *
 * ⚠️ Ese `DESC` sobre el valor —y no sobre "tiene valor o no"— significa que entre dos
 * filas que ambas tienen código, gana la del código alfabéticamente mayor. Es una
 * consecuencia del truco de `ISNULL(x,' ')`, no una regla de negocio, pero se
 * reproduce igual: el sistema es la definición de lo correcto.
 */
export function buscarPrecio(e: EntradaPrecio, precios: Precio[]): Precio | null {
  const norm = (v: string | null | undefined) => (v ?? "").trim();

  const candidatos = precios.filter((p) => {
    if (norm(p.cosecha) !== norm(e.cosecha)) return false;
    if (norm(p.tipocafe) !== norm(e.tipocafe)) return false;
    if (norm(p.calidad) !== norm(e.calidad)) return false;
    // Opcionales: NULL = aplica a todos.
    if (p.zona != null && norm(p.zona) !== norm(e.zona)) return false;
    if (p.recibidor != null && norm(p.recibidor) !== norm(e.recibidor)) return false;
    if (p.tipo != null && norm(p.tipo) !== norm(e.tipo)) return false;
    if (p.codigo != null && norm(p.codigo) !== norm(e.codigo)) return false;
    return true;
  });

  if (candidatos.length === 0) return null;

  // `ISNULL(x, ' ')` — un espacio ordena antes que cualquier carácter imprimible, así
  // que con DESC las filas con valor quedan arriba de las que tienen NULL.
  const clave = (v: string | null | undefined) => (v == null ? " " : String(v));
  const cmp = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0); // DESC

  const ordenados = [...candidatos].sort(
    (a, b) =>
      cmp(clave(a.codigo), clave(b.codigo)) ||
      cmp(clave(a.tipo), clave(b.tipo)) ||
      cmp(clave(a.recibidor), clave(b.recibidor)) ||
      cmp(clave(a.zona), clave(b.zona)) ||
      cmp(clave(a.calidad), clave(b.calidad)) ||
      cmp(clave(a.tipocafe), clave(b.tipocafe)) ||
      b.idreprecio - a.idreprecio
  );

  return ordenados[0] ?? null;
}
