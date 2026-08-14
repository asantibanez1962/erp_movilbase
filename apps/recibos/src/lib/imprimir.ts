import { Q, type Model } from "@nozbe/watermelondb";
import * as Print from "expo-print";
import { useAuthStore } from "@erp/shared-api";
import { database } from "./db";
import { LOGO, LOGO_ESCPOS } from "./logo";
import { modoImpresion } from "./modoImpresion";
import { imprimirTexto } from "./impresoraBt";
import { armarReciboTexto } from "./reciboTexto";
import { armarComprobante, type ComprobanteRecibo } from "./comprobante";
import type {
  Calidad,
  Canton,
  Certificado,
  Cosecha,
  Distrito,
  Compania,
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

/**
 * Tamaño de página que se le SUGIERE a Android, en puntos (72 por pulgada — no son píxeles
 * de pantalla a 96 dpi, que es el error fácil). 226 × 940 pt ≈ 80 × 331 mm.
 *
 * ⚠️ ES UNA SUGERENCIA, NO UNA ORDEN, Y AVERIGUARLO COSTÓ VARIAS PRUEBAS. Manda el
 * **tamaño elegido en el diálogo de impresión**, que sale del driver: la 3nStar declara
 * `80(72MM)` = 71,4 × 210 mm, con variantes 1:1.5, 1:2, 1:3 para papeles más largos. Sea
 * cual sea el alto que se pida acá, el trabajo se arma con el del diálogo — se probó con
 * 763 y con 940 y el resultado no cambió en nada.
 *
 * Por eso el comprobante, que mide 262 mm, aparece partido en dos en la vista previa: no
 * entra en los 210 mm de la página del driver. **Pero en papel sale bien**, porque la
 * térmica es un rollo continuo y no tiene hojas: la paginación es una ficción del
 * framework de Android. Verificado imprimiendo.
 *
 * El alto igual se pasa, y hay que seguir pasándolo: omitirlo hace que `printAsync` use
 * 792 pt por defecto —el alto de una hoja Carta— y eso sí cambia el resultado.
 *
 * ⚠️ La bitácora va a ser distinta: su largo depende de cuántos recibos lleve. Como la
 * paginación real la decide el driver y no nosotros, ahí lo que hay que revisar es si el
 * rollo continuo la imprime seguida igual que al recibo, o si conviene un tamaño de papel
 * más largo en el diálogo.
 */
const PAGINA = { width: 226, height: 940 };

/** Imprime el comprobante. La primera vez sale ORIGINAL; de ahí en adelante, COPIA. */
export async function imprimirRecibo(recibo: Recibo): Promise<void> {
  const datos = await reunirDatos(recibo);

  if (modoImpresion() === "directo") {
    await imprimirTexto(
      armarReciboTexto({
        logo: LOGO_ESCPOS,
        copia: datos.copia,
        empresa: datos.empresa,
        cosecha: datos.cosecha,
        recibo: datos.recibo,
        fecha: datos.fecha,
        codigo: recibo.codigo ?? "",
        productor: datos.productor,
        cedula: datos.cedula,
        ubicacion: [datos.provincia, datos.canton, datos.distrito]
          .map((x) => x.trim())
          .filter((x) => x !== "")
          .join(" · "),
        finca: "",
        adelanto: datos.precio,
        recibidor: datos.recibidor,
        tipoCafe: datos.tipoCafe,
        cldd: datos.cldd ? "SELLO: CLDD" : "",
        certificado: datos.certificado,
        calidad: datos.calidad,
        cajuelas: datos.cajuelas,
        cuartillos: datos.cuartillos,
        verdes: datos.verdes,
        flotemaduro: datos.flotemaduro,
        floteseco: datos.floteseco,
        granosbrocados: datos.granosbrocados,
        // El legacy imprime `Usuarios.usuario`, no un campo del recibo: es quien está
        // operando la app en ese momento.
        medidor: useAuthStore.getState().user?.usuario ?? "",
        agregado: comoFechaHora(recibo.agregado),
      })
    );
    return;
  }

  await Print.printAsync({ html: armarComprobante(datos), ...PAGINA });
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
    uno<Compania>("companias"),
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
    logo: LOGO,
    // El encabezado dice ORIGINAL o COPIA según lo que había ANTES de esta impresión,
    // igual que en el web: la vista lee `impreso` y el endpoint lo marca después.
    copia: (recibo.impreso ?? 0) > 0,
    // Los `ben_*` de `ge_companias`, la MISMA fuente que el .frx del web. Las tres líneas
    // de dirección son tres renglones del papel y el usuario reparte el texto como le
    // sirva; la app no las interpreta ni las junta. Ver v1.71/RC/46.
    empresa: {
      nombre: empresa?.nombre ?? "",
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
    nota: empresa?.notaRecibo ?? "",
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
 *
 * ⚠️ DEVUELVE EL PRECIO POR FANEGA: el monto de la tabla es POR CAJUELA y se multiplica por
 * 20, que es lo que trae una fanega. El café se cotiza por fanega, así que es la magnitud
 * que el productor espera leer.
 *
 * El `.frx` del web imprimía el monto crudo —₡6 350 donde van ₡127 000— y el ESC/POS del
 * legacy sí multiplicaba. Se corrigió el web en v1.71/RC/47; acá el ×20 vive en un solo
 * lugar para que los dos modos de impresión no puedan discrepar.
 */
const CAJUELAS_POR_FANEGA = 20;
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

  return candidatos[0]!.monto * CAJUELAS_POR_FANEGA;
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
