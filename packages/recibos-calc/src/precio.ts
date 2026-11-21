import type { EntradaPrecio, Precio } from "./tipos";

/**
 * Port de `dbo.f_rc_busca_precio` — precio del recibo, del más específico al más
 * general.
 *
 * El original filtra por cosecha, tipo de café y calidad de forma obligatoria, y trata
 * `zona`, `recibidor`, `tipo` e `idsocio` como opcionales: una fila con NULL en esas
 * columnas aplica a todos. Después ordena poniendo primero las filas que SÍ tienen
 * valor, así el precio de un productor concreto le gana al de su tipo, que le gana al
 * del recibidor, y así sucesivamente.
 *
 *   ORDER BY CASE WHEN idsocio IS NOT NULL THEN 1 ELSE 0 END DESC,
 *            ISNULL(tipo,' ') DESC, ISNULL(recibidor,' ') DESC,
 *            ISNULL(zona,' ') DESC, ISNULL(calidad,' ') DESC, ISNULL(tipocafe,' ') DESC,
 *            idreprecio DESC
 *
 * ⚠️ El productor se identifica por `idsocio`, NO por `codigo`: el servidor lo sacó de la
 * firma y del ORDER BY porque el código puede faltar o repetirse. Para el socio el orden
 * es "tiene o no tiene" y ya no el valor.
 *
 * ⚠️ Pero el `DESC` sobre el valor sigue vivo para `tipo`, `recibidor`, `zona`, `calidad` y
 * `tipocafe`: entre dos filas que ambas lo tienen gana el valor alfabéticamente mayor. Es
 * una consecuencia del truco de `ISNULL(x,' ')`, no una regla de negocio, pero se
 * reproduce igual: el sistema es la definición de lo correcto.
 *
 * REGLA DE TRANSICIÓN (transitoria — borrar cuando todos los teléfonos hayan re-bajado
 * `precios`). El servidor re-estampó sólo las filas que tienen `idsocio`; las generales
 * conservan su estampa vieja y no se vuelven a bajar, así que en el teléfono las filas
 * anteriores a la v13 tienen `idsocio` ausente aunque sean de un productor. Para no
 * confundirlas con las generales:
 *
 *   - `idsocio` presente            → se compara por `idsocio`; cuenta como "con socio".
 *   - sin `idsocio` y `codigo` dado → fila vieja aún sin re-bajar: se compara por `codigo`
 *                                     como antes; también cuenta como "con socio".
 *   - sin `idsocio` ni `codigo`     → precio general, aplica a cualquiera.
 *
 * Sin esa distinción, el precio de un productor se le aplicaría a todos.
 */
export function buscarPrecio(e: EntradaPrecio, precios: Precio[]): Precio | null {
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  const conIdSocio = (p: Precio) => p.idsocio != null;
  // Fila de productor aún sin idsocio (transición): el código es lo único que la ata.
  const soloCodigo = (p: Precio) => !conIdSocio(p) && norm(p.codigo) !== "";
  const conSocio = (p: Precio) => conIdSocio(p) || soloCodigo(p);

  const candidatos = precios.filter((p) => {
    if (norm(p.cosecha) !== norm(e.cosecha)) return false;
    if (norm(p.tipocafe) !== norm(e.tipocafe)) return false;
    if (norm(p.calidad) !== norm(e.calidad)) return false;
    // Opcionales: NULL = aplica a todos.
    if (p.zona != null && norm(p.zona) !== norm(e.zona)) return false;
    if (p.recibidor != null && norm(p.recibidor) !== norm(e.recibidor)) return false;
    if (p.tipo != null && norm(p.tipo) !== norm(e.tipo)) return false;
    // `p.idsocio = @idsocio`: con el idsocio de entrada en NULL no hay igualdad posible.
    if (conIdSocio(p)) return e.idsocio != null && Number(p.idsocio) === Number(e.idsocio);
    if (soloCodigo(p)) return norm(p.codigo) === norm(e.codigo);
    return true;
  });

  if (candidatos.length === 0) return null;

  // `ISNULL(x, ' ')` — un espacio ordena antes que cualquier carácter imprimible, así
  // que con DESC las filas con valor quedan arriba de las que tienen NULL.
  const clave = (v: string | null | undefined) => (v == null ? " " : String(v));
  const cmp = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0); // DESC

  const ordenados = [...candidatos].sort(
    (a, b) =>
      Number(conSocio(b)) - Number(conSocio(a)) ||
      cmp(clave(a.tipo), clave(b.tipo)) ||
      cmp(clave(a.recibidor), clave(b.recibidor)) ||
      cmp(clave(a.zona), clave(b.zona)) ||
      cmp(clave(a.calidad), clave(b.calidad)) ||
      cmp(clave(a.tipocafe), clave(b.tipocafe)) ||
      b.idreprecio - a.idreprecio
  );

  return ordenados[0] ?? null;
}
