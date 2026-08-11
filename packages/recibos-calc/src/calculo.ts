import {
  partirEnCuartillos,
  redondear,
  redondearACuartillo,
  redondeoCafe,
  truncar,
} from "./decimal";
import type { Catalogos, EntradaCalculo, ResultadoCalculo } from "./tipos";

/**
 * Port de `dbo.f_rc_calcula_recibo` — castigos y cantidad final del recibo.
 *
 * POR QUÉ EXISTE DOS VECES
 * ------------------------
 * El servidor recalcula siempre al grabar (`ReciboCalcHook`) y no confía en el
 * cliente. Para el web eso alcanza: el usuario ve un número y el servidor guarda el
 * bueno. Para el móvil no, porque su resultado **se imprime y se le entrega firmado al
 * productor** en el recibidor, sin señal. Si el servidor recalculara distinto, habría
 * un papel firmado que contradice al sistema.
 *
 * Entonces la regla de este archivo es una sola: **reproducir el original exactamente,
 * incluidas sus rarezas**. Cualquier "mejora" que cambie un resultado es un defecto,
 * porque el sistema es la definición de lo correcto, no la aritmética ideal.
 *
 * Las rarezas que se copiaron a propósito están marcadas con ⚠️ abajo.
 *
 * El original vive en `Sql/Upgrades/v1.68/RC/23_fn_calcula_recibo_precio.sql`.
 */
export function calcularRecibo(e: EntradaCalculo, cat: Catalogos): ResultadoCalculo {
  // @bruto = cantidadinicial + cuartillosinicial*0.25  → decimal(18,3)
  const bruto = redondear((e.cantidadinicial ?? 0) + (e.cuartillosinicial ?? 0) * 0.25, 3);

  // ── Broca: por bloques de 100 de la cantidad bruta ──────────────────────
  let castigosbroca = 0;
  let granos = e.granosbrocados ?? 0;

  const maximo = cat.castigosBroca.reduce((m, c) => (c.granosbroca > m ? c.granosbroca : m), 0);
  if (granos > maximo) granos = maximo;

  if (granos > 0) {
    let ct = bruto;
    // ⚠️ `CAST(@bruto/100 AS INT) + 1` trunca. Para bruto=100 da 2 vueltas, y la
    // segunda encuentra ct=0 y no suma nada: la vuelta de más es inofensiva pero
    // está en el original, así que se conserva.
    const multiplos = truncar(bruto / 100) + 1;

    for (let m = 1; m <= multiplos; m++) {
      const rinicial = ct > 100 ? 100 : ct;
      ct = redondear(ct - 100, 3);
      if (rinicial > 0) {
        // TOP 1 ... WHERE granosbroca=@granos AND cantidad >= @rinicial ORDER BY cantidad
        let cc: number | null = null;
        let mejorCantidad = Number.POSITIVE_INFINITY;
        for (const f of cat.castigosBroca) {
          if (f.granosbroca !== granos) continue;
          if (f.cantidad < rinicial) continue;
          if (f.cantidad < mejorCantidad) {
            mejorCantidad = f.cantidad;
            cc = f.cuartilloscastigo;
          }
        }
        castigosbroca = redondear(castigosbroca + (cc ?? 0) * 0.25, 3);
      }
    }
  }

  const broca = truncar(castigosbroca);
  const cuartillosbroca = truncar(Number(((castigosbroca - broca) / 0.25).toPrecision(15)));

  // ── Verde / flote maduro / flote seco ───────────────────────────────────
  //
  // ⚠️ El original busca el tope y el porcentaje uniendo rc_recibidorescosechanivel
  // con re_castigos_cosecha, pero filtra `cn` SOLO por recibidor y nivel — la cosecha
  // no entra en esa condición, pese al nombre de la tabla. El join sirve de hecho como
  // "existe esta pareja recibidor/nivel". Se reproduce igual: filtrar además por
  // cosecha daría otro resultado cuando un recibidor cambió de nivel entre cosechas.
  // `txt` y no `x.trim()`: los códigos son char/varchar en SQL Server, pero llegan
  // desde SQLite (móvil) o desde un parser de texto (verificación) y un "001" puede
  // aparecer como número. Comparar 1 contra "001" no falla: devuelve "no encontrado",
  // y el recibo sale sin castigos — un error silencioso que da de más al productor.
  const txt = (v: unknown) => (v == null ? "" : String(v).trim());

  const buscarTope = (tipocastigo: number): { tope: number; pct: number } | null => {
    const existeNivel = cat.recibidorNivel.some(
      (n) => txt(n.recibidor) === txt(e.recibidor) && Number(n.nivel) === Number(e.nivel)
    );
    if (!existeNivel) return null;
    const cc = cat.castigosCosecha.find(
      (c) =>
        txt(c.cosecha) === txt(e.cosecha) &&
        Number(c.nivel) === Number(e.nivel) &&
        Number(c.tipocastigo) === tipocastigo
    );
    if (!cc || cc.topeaceptado == null) return null;
    return { tope: cc.topeaceptado, pct: cc.pctcastigo ?? 0 };
  };

  let rverde = 0;
  let rebajoverde = 0;
  let cuartillosrebajoverde = 0;
  if ((e.verdes ?? 0) !== 0) {
    const t = buscarTope(1);
    if (t && e.verdes > t.tope) {
      // ⚠️ ASIMETRÍA DEL ORIGINAL, a propósito. Para el verde el resultado pasa por
      // una variable `decimal(18,3)` ANTES de redondear al cuartillo:
      //     SET @tmp = @bruto*(@verdes-@tope)/100 * @pct/100;   -- decimal(18,3)
      //     SET @rverde = dbo.redondeo_Cafe(@tmp, 0.25);
      // mientras que los dos flotes pasan la expresión DIRECTO a redondeo_Cafe, cuyo
      // parámetro es decimal(18,4). O sea: verde redondea a 3 decimales primero,
      // flote a 4. Es una diferencia real de un dígito que puede cambiar el cuartillo.
      const tmp = redondear((bruto * (e.verdes - t.tope)) / 100 * (t.pct / 100), 3);
      rverde = redondeoCafe(tmp, 0.25);
      const p = partirEnCuartillos(rverde);
      rebajoverde = p.entero;
      cuartillosrebajoverde = p.cuartillos;
    }
  }

  let rebajoflote = 0;
  let cuartillosrebajoflote = 0;
  if ((e.flotemaduro ?? 0) !== 0) {
    const t = buscarTope(2);
    if (t && e.flotemaduro > t.tope) {
      // Directo a redondeo_Cafe: el parámetro es decimal(18,4). Ver la nota del verde.
      const tmp = redondeoCafe(
        redondear((bruto * (e.flotemaduro - t.tope)) / 100 * (t.pct / 100), 4),
        0.25
      );
      const p = partirEnCuartillos(tmp);
      rebajoflote = p.entero;
      cuartillosrebajoflote = p.cuartillos;
    }
  }

  let rebajofloteseco = 0;
  let cuartillosrebajofloteseco = 0;
  if ((e.floteseco ?? 0) !== 0) {
    const t = buscarTope(3);
    if (t && e.floteseco > t.tope) {
      const tmp = redondeoCafe(
        redondear((bruto * (e.floteseco - t.tope)) / 100 * (t.pct / 100), 4),
        0.25
      );
      const p = partirEnCuartillos(tmp);
      rebajofloteseco = p.entero;
      cuartillosrebajofloteseco = p.cuartillos;
    }
  }

  // ── Cantidad final ──────────────────────────────────────────────────────
  //
  // ⚠️ El flote se recompone desde sus partes enteras (entero + cuartillos*0.25),
  // mientras que el verde entra con su valor decimal completo (`@rverde`). En la
  // práctica coinciden porque redondeo_Cafe ya dejó el valor en cuartillos, pero se
  // respeta la forma del original.
  const rflote = redondear(
    rebajoflote + cuartillosrebajoflote * 0.25 + rebajofloteseco + cuartillosrebajofloteseco * 0.25,
    3
  );
  // La cantidad final se redondea al cuartillo: `errormedidor` es el único término
  // que puede traer decimales sueltos y sin esto la cantidad queda fuera del dominio
  // (las cajuelas son enteras y los cuartillos van de 0 a 3). Con piso y no con
  // redondeoCafe — ver la nota en decimal.ts sobre los negativos.
  const neto = redondear(bruto - rflote - castigosbroca - rverde + (e.errormedidor ?? 0), 3);
  const cantidad = redondearACuartillo(neto);
  const p = partirEnCuartillos(cantidad);

  return {
    cantidad,
    castigosbroca,
    broca,
    cuartillosbroca,
    rebajoverde,
    cuartillosrebajoverde,
    rebajoflote,
    cuartillosrebajoflote,
    rebajofloteseco,
    cuartillosrebajofloteseco,
    rcantidad: p.entero,
    rcantidadcuartillos: p.cuartillos,
  };
}
