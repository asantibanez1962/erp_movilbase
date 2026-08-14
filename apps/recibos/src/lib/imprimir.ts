import { Q, type Model } from "@nozbe/watermelondb";
import * as Print from "expo-print";
import { database } from "./db";
import { armarComprobante, type ComprobanteRecibo } from "./comprobante";
import type {
  Calidad,
  Canton,
  Certificado,
  Cosecha,
  Distrito,
  Parametro,
  Precio,
  Productor,
  Provincia,
  Recibidor,
  Recibo,
  TipoCafe,
} from "../db/models";

/**
 * Impresión del comprobante de recibo: reunir los datos y mandarlo a la impresora.
 *
 * La plantilla del papel vive aparte, en `comprobante.ts`. Acá está sólo de dónde sale
 * cada dato — que es la parte que se puede equivocar en silencio.
 *
 * ── CÓMO SALE EL PAPEL ──────────────────────────────────────────────────────
 *
 * `expo-print` pasa el HTML a PDF y abre el diálogo de impresión de Android, donde el
 * operador elige **ESCprint Service**: el driver que traduce a ESC/POS y habla con la
 * 3nStar. Es el camino que el POC dejó probado — sin librería Bluetooth, sin emparejar
 * nada, sin permisos que pedir.
 *
 * ⚠️ `Print.printAsync` RESUELVE AL ABRIR EL DIÁLOGO, NO AL SALIR EL PAPEL. Que la promesa
 * cumpla no prueba nada: la impresora puede estar apagada o sin rollo. Lo resuelve la
 * operación, que es donde de verdad se sabe — **el cliente no se va sin su recibo**, así
 * que si no salió, el recibidor lo anula y lo vuelve a digitar. La anulación exige
 * justamente que esté impreso y preserva el número, que es lo que hace falta para no dejar
 * un hueco en la secuencia. Ver `marcarImpreso` en `recibo.ts`.
 */

/** Imprime el comprobante. La primera vez sale ORIGINAL; de ahí en adelante, COPIA. */
export async function imprimirRecibo(recibo: Recibo): Promise<void> {
  const datos = await reunirDatos(recibo);
  await Print.printAsync({
    html: armarComprobante(datos),
    // 76.2 mm de ancho de papel = 3", que es lo que declara la página del .frx.
    width: 288,
  });
}

async function reunirDatos(recibo: Recibo): Promise<ComprobanteRecibo> {
  const uno = async <T extends Model>(tabla: string, col?: string, val?: unknown) => {
    const filas = await database
      .get<T>(tabla)
      .query(...(col == null ? [] : [Q.where(col, val as string)]))
      .fetch();
    return filas[0] ?? null;
  };

  const [empresa, cosecha, recibidor, tipoCafe, calidad] = await Promise.all([
    uno<Parametro>("parametros"),
    uno<Cosecha>("cosechas", "cosecha", recibo.cosecha),
    uno<Recibidor>("recibidores", "recibidor", recibo.recibidor),
    uno<TipoCafe>("tipos_cafe", "tipocafe", recibo.tipoCafe ?? ""),
    uno<Calidad>("calidades", "calidad", recibo.calidad ?? ""),
  ]);

  const productor =
    recibo.idSocio == null
      ? null
      : await database
          .get<Productor>("productores")
          .find(String(recibo.idSocio))
          .catch(() => null);

  const certificado =
    recibo.idCertificado == null
      ? null
      : await uno<Certificado>("certificados", "idcertificado", recibo.idCertificado);

  const cajuelas = Math.trunc(recibo.cantidad);

  return {
    // El encabezado dice ORIGINAL o COPIA según lo que había ANTES de esta impresión,
    // igual que en el web: la vista lee `impreso` y el endpoint lo marca después.
    copia: (recibo.impreso ?? 0) > 0,
    empresa: {
      // ⚠️ EL WEB LEE OTRA TABLA. El .frx toma el encabezado de `ge_companias.ben_*`, que
      // hoy tiene valores de relleno ("DIRECCION 3", "EL TELEFONO", "EL EMAIL"). El móvil
      // usa `re_parametros`, que tiene los datos reales. Los dos papeles van a diferir en
      // el encabezado hasta que se corrija `ge_companias`.
      nombre: empresa?.nombrecompania ?? "",
      direccion1: empresa?.direccion1 ?? "",
      direccion2: empresa?.direccion2 ?? "",
      direccion3: empresa?.direccion3 ?? "",
      codigoicafe: empresa?.codigoicafe ?? "",
      telefono: empresa?.telefono ?? "",
      email: empresa?.email ?? "",
    },
    cosecha: cosecha?.descripcion ?? recibo.cosecha,
    recibo: recibo.recibo ?? "",
    fecha: comoFecha(recibo.fecha),
    agregado: comoFechaHora(recibo.agregado),
    hoy: comoFechaHora(Date.now()),
    // ⚠️ EL ORDEN DEL NOMBRE DIFIERE DEL WEB. La vista arma "APELLIDO1 APELLIDO2 NOMBRE";
    // el teléfono baja el nombre ya concatenado como "NOMBRE APELLIDO1 APELLIDO2". Es la
    // misma persona escrita al revés. Unificarlo es cambiar la proyección de `productores`,
    // que también alimenta la lista y la búsqueda de la app.
    productor: recibo.nombre ?? recibo.codigo ?? "",
    cedula: recibo.cedula ?? "",
    ...(await geografiaDe(productor)),
    precio: await precioImpreso(recibo, productor),
    recibidor: recibidor?.nombre ?? recibo.recibidor,
    tipoCafe: tipoCafe?.nombre ?? recibo.tipoCafe ?? "",
    calidad: calidad?.nombre ?? recibo.calidad ?? "",
    // `<> 0` y no `= 1`: cubre los tipos 1-4 del legacy además del 0/1 del checkbox nuevo,
    // igual que la vista. Ver la nota en `ComprobanteRecibo.cldd` — el web no lo imprime.
    cldd: (recibo.cldd ?? 0) !== 0 ? "SELLO CLDD" : "",
    // La vista arma la línea completa o la deja vacía; el .frx la imprime tal cual.
    certificado: certificado?.nombre ? `CERTIFICADO: ${certificado.nombre}` : "",
    cajuelas,
    cuartillos: Math.round((recibo.cantidad - cajuelas) / 0.25),
    verdes: recibo.verdes,
    flotemaduro: recibo.flotemaduro,
    floteseco: recibo.floteseco,
    granosbrocados: recibo.granosbrocados,
  };
}

/**
 * Las tres líneas de `UBICACION:` — provincia, cantón y distrito.
 *
 * ⚠️ ACÁ EL MÓVIL NO CALCA AL WEB, Y ESTÁ BIEN QUE NO. La vista decodifica el código
 * empaquetado `productores.ubicacion` (ocho caracteres, con dos formatos conviviendo:
 * `02020100` y `AL020100`). El teléfono usa los tres ids de `ge_Socio` —la estructura
 * nueva— que unen directo y no hay nada que interpretar. Mismo resultado por un camino que
 * no se puede equivocar; ver v1.71/RC/45.
 *
 * Los ~780 productores que todavía no tienen los ids caen al respaldo: sin ubicación, igual
 * que en el web, en vez de imprimir una provincia inventada.
 */
async function geografiaDe(
  productor: Productor | null
): Promise<{ provincia: string; canton: string; distrito: string }> {
  if (!productor) return { provincia: "", canton: "", distrito: "" };

  const buscar = async <T extends Model>(tabla: string, id: number | null) =>
    id == null
      ? null
      : await database
          .get<T>(tabla)
          .find(String(id))
          .catch(() => null);

  const [p, c, d] = await Promise.all([
    buscar<Provincia>("provincias", productor.idProvincia),
    buscar<Canton>("cantones", productor.idCanton),
    buscar<Distrito>("distritos", productor.idDistrito),
  ]);

  return {
    provincia: p?.provincia ?? "",
    canton: c?.canton ?? "",
    distrito: d?.distrito ?? "",
  };
}

/**
 * El ADELANTO del papel. Porta `f_re_precio_recibo_impreso` línea por línea.
 *
 * ⚠️ ES UN PRECIO GENÉRICO Y ESO ESTÁ PUESTO A PROPÓSITO: el filtro `codigo is null` es
 * explícito en la función del servidor. Aunque el productor tenga precio especial, **en el
 * papel va el que aplica por tipo de café, recibidor y zona**, nada más.
 *
 * Es distinto del precio que se GUARDA con el recibo, donde el código del productor sí
 * entra al criterio. Reutilizar aquella búsqueda —lo natural, ya está escrita— imprimiría
 * el precio especial: un número plausible y equivocado en el documento que la persona
 * firma.
 *
 * Los dos parámetros que definen "a quién le aplica" salen del PRODUCTOR (su tipo y su
 * zona), no del recibo; el recibo aporta cosecha, calidad, recibidor y tipo de café. Y el
 * tipo de café del recibo viaja en la columna `zona`, que es el nombre engañoso de siempre.
 */
async function precioImpreso(
  recibo: Recibo,
  productor: Productor | null
): Promise<number | null> {
  const precios = await database.get<Precio>("precios").query().fetch();
  const norm = (v: string | null | undefined) => (v ?? "").trim();

  const tipoProductor = norm(productor?.tipo);
  const zonaProductor = norm(productor?.zona);

  const candidatos = precios.filter((p) => {
    if (norm(p.cosecha) !== norm(recibo.cosecha)) return false;
    if (norm(p.tipocafe) !== norm(recibo.tipoCafe)) return false;
    if (norm(p.calidad) !== norm(recibo.calidad)) return false;
    // `(zona is null or zona=@zona)` — el genérico también califica.
    if (norm(p.zona) !== "" && norm(p.zona) !== zonaProductor) return false;
    if (norm(p.recibidor) !== "" && norm(p.recibidor) !== norm(recibo.recibidor)) return false;
    if (norm(p.tipo) !== "" && norm(p.tipo) !== tipoProductor) return false;
    // El corazón de la regla: nunca un precio de productor.
    if (norm(p.codigo) !== "") return false;
    return true;
  });

  if (candidatos.length === 0) return null;

  // `ORDER BY isnull(tipo,' ') DESC, isnull(recibidor,' ') DESC, isnull(zona,' ') DESC` —
  // lo concreto gana sobre el genérico, porque cualquier código ordena después del espacio.
  const clave = (p: Precio) =>
    [norm(p.tipo) || " ", norm(p.recibidor) || " ", norm(p.zona) || " "].join(" ");
  candidatos.sort((a, b) => (clave(a) < clave(b) ? 1 : clave(a) > clave(b) ? -1 : 0));

  return candidatos[0]!.monto;
}

/** `dd/MM/yyyy`, como el `Format.Format="d"` del .frx bajo configuración de Costa Rica. */
function comoFecha(ms: number | null | undefined): string {
  if (ms == null) return "";
  const f = new Date(ms);
  const dd = String(f.getDate()).padStart(2, "0");
  const mm = String(f.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${f.getFullYear()}`;
}

/** `dd/MM/yyyy HH:mm` — lo que la vista arma a mano para `agregado` y `hoy`. */
function comoFechaHora(ms: number | null | undefined): string {
  if (ms == null) return "";
  const f = new Date(ms);
  const hh = String(f.getHours()).padStart(2, "0");
  const mi = String(f.getMinutes()).padStart(2, "0");
  return `${comoFecha(ms)} ${hh}:${mi}`;
}
