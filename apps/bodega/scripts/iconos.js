#!/usr/bin/env node
/**
 * Genera el ícono de Android de cada cliente a partir de su logo.
 *
 *   node scripts/iconos.js            → todos los clientes con logo
 *   node scripts/iconos.js altura     → sólo ese
 *
 * Produce assets/clientes/icono-<id>.png de 1024x1024, que app.config.js usa como
 * `icon` y como `adaptiveIcon.foregroundImage`.
 *
 * POR QUÉ ESTE SCRIPT EXISTE
 * --------------------------
 * Los logos vienen en tamaños y proporciones distintas (241x162, 841x674, 1024x1024)
 * y ninguno es cuadrado ni tiene transparencia. Android exige un cuadrado, y el
 * ícono adaptativo recorta todo lo que quede fuera del 66% central: pasarle el logo
 * crudo lo deformaría o le comería los bordes. Acá se escala respetando la
 * proporción, se centra dentro de la zona segura y se rellena con el color de marca.
 *
 * SIN DEPENDENCIAS A PROPÓSITO. Este es un monorepo pnpm; instalar una librería de
 * imágenes con el gestor equivocado ya rompió el árbol de node_modules una vez. PNG
 * de 8 bits es un formato simple y `zlib` viene con Node, así que decodificarlo y
 * codificarlo son unas 80 líneas y cero riesgo.
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const RAIZ = path.join(__dirname, "..");
const DIR = path.join(RAIZ, "assets", "clientes");
const LADO = 1024;
/** Zona segura del ícono adaptativo: Android recorta fuera del 66% central. */
const ZONA_SEGURA = 0.66;

// ─── PNG: lectura ────────────────────────────────────────────────────

function leerPng(ruta) {
  const buf = fs.readFileSync(ruta);
  let off = 8;
  let ihdr = null;
  const idat = [];
  let paleta = null;
  let paletaAlpha = null;

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const tipo = buf.toString("ascii", off + 4, off + 8);
    const datos = buf.subarray(off + 8, off + 8 + len);
    if (tipo === "IHDR") {
      ihdr = {
        ancho: datos.readUInt32BE(0),
        alto: datos.readUInt32BE(4),
        profundidad: datos[8],
        tipoColor: datos[9],
        interlace: datos[12],
      };
    } else if (tipo === "PLTE") paleta = Buffer.from(datos);
    else if (tipo === "tRNS") paletaAlpha = Buffer.from(datos);
    else if (tipo === "IDAT") idat.push(datos);
    else if (tipo === "IEND") break;
    off += 12 + len;
  }

  if (!ihdr) throw new Error("PNG sin IHDR");
  if (ihdr.profundidad !== 8) throw new Error(`profundidad ${ihdr.profundidad} no soportada`);
  if (ihdr.interlace !== 0) throw new Error("PNG entrelazado no soportado");

  const canalesPorTipo = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const canales = canalesPorTipo[ihdr.tipoColor];
  if (!canales) throw new Error(`tipo de color ${ihdr.tipoColor} no soportado`);

  const crudo = zlib.inflateSync(Buffer.concat(idat));
  const anchoLinea = ihdr.ancho * canales;
  const px = Buffer.alloc(ihdr.alto * anchoLinea);

  // Des-filtrado por scanline: filtros 0..4 del spec PNG.
  let p = 0;
  for (let y = 0; y < ihdr.alto; y++) {
    const filtro = crudo[p++];
    const linea = crudo.subarray(p, p + anchoLinea);
    p += anchoLinea;
    const dest = y * anchoLinea;
    const prev = dest - anchoLinea;
    for (let x = 0; x < anchoLinea; x++) {
      const a = x >= canales ? px[dest + x - canales] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = x >= canales && y > 0 ? px[prev + x - canales] : 0;
      let v = linea[x];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const est = a + b - c;
        const da = Math.abs(est - a);
        const db = Math.abs(est - b);
        const dc = Math.abs(est - c);
        let elegido = c;
        if (da <= db && da <= dc) elegido = a;
        else if (db <= dc) elegido = b;
        v += elegido;
      }
      px[dest + x] = v & 0xff;
    }
  }

  // Normalizar a RGBA para no arrastrar el tipo de color al resto del script.
  const rgba = Buffer.alloc(ihdr.ancho * ihdr.alto * 4);
  for (let i = 0, j = 0; i < ihdr.ancho * ihdr.alto; i++, j += 4) {
    const s = i * canales;
    let r, g, b, a = 255;
    if (ihdr.tipoColor === 3) {
      const idx = px[s];
      r = paleta[idx * 3];
      g = paleta[idx * 3 + 1];
      b = paleta[idx * 3 + 2];
      if (paletaAlpha && idx < paletaAlpha.length) a = paletaAlpha[idx];
    } else if (canales >= 3) {
      r = px[s]; g = px[s + 1]; b = px[s + 2];
      if (canales === 4) a = px[s + 3];
    } else {
      r = g = b = px[s];
      if (canales === 2) a = px[s + 1];
    }
    rgba[j] = r; rgba[j + 1] = g; rgba[j + 2] = b; rgba[j + 3] = a;
  }
  return { ancho: ihdr.ancho, alto: ihdr.alto, rgba };
}

// ─── PNG: escritura ──────────────────────────────────────────────────

const TABLA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** Escribe RGBA de 8 bits sin entrelazar, con filtro None en cada scanline. */
function escribirPng(ruta, ancho, alto, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;    // profundidad
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0;   // deflate
  ihdr[11] = 0;   // filtro adaptativo
  ihdr[12] = 0;   // sin entrelazar

  const anchoLinea = ancho * 4;
  const conFiltro = Buffer.alloc(alto * (anchoLinea + 1));
  for (let y = 0; y < alto; y++) {
    conFiltro[y * (anchoLinea + 1)] = 0;
    rgba.copy(conFiltro, y * (anchoLinea + 1) + 1, y * anchoLinea, (y + 1) * anchoLinea);
  }

  fs.writeFileSync(
    ruta,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(conFiltro, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

// ─── Composición ─────────────────────────────────────────────────────

/**
 * Reescalado bilineal.
 *
 * Bilineal y no vecino-más-cercano porque los logos hay que agrandarlos (el de
 * Altura mide 241px de ancho y va a ~620): con vecino-más-cercano los bordes de las
 * letras quedan escalonados y en el ícono del launcher se nota.
 */
function escalar(src, anchoDest, altoDest) {
  const dest = Buffer.alloc(anchoDest * altoDest * 4);
  const escalaX = src.ancho / anchoDest;
  const escalaY = src.alto / altoDest;

  for (let y = 0; y < altoDest; y++) {
    const sy = Math.min(src.alto - 1, (y + 0.5) * escalaY - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(src.alto - 1, y0 + 1);
    const fy = sy - y0;

    for (let x = 0; x < anchoDest; x++) {
      const sx = Math.min(src.ancho - 1, (x + 0.5) * escalaX - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(src.ancho - 1, x0 + 1);
      const fx = sx - x0;

      const i00 = (y0 * src.ancho + x0) * 4;
      const i01 = (y0 * src.ancho + x1) * 4;
      const i10 = (y1 * src.ancho + x0) * 4;
      const i11 = (y1 * src.ancho + x1) * 4;
      const d = (y * anchoDest + x) * 4;

      for (let c = 0; c < 4; c++) {
        const arriba = src.rgba[i00 + c] * (1 - fx) + src.rgba[i01 + c] * fx;
        const abajo = src.rgba[i10 + c] * (1 - fx) + src.rgba[i11 + c] * fx;
        dest[d + c] = Math.round(arriba * (1 - fy) + abajo * fy);
      }
    }
  }
  return { ancho: anchoDest, alto: altoDest, rgba: dest };
}

function aRgb(hex) {
  const h = hex.replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Máscara de rectángulo redondeado: 1 dentro, 0 fuera, con antialias en el borde. */
function dentroDelRedondeado(x, y, x0, y0, x1, y1, radio) {
  const cx = Math.min(Math.max(x, x0 + radio), x1 - radio);
  const cy = Math.min(Math.max(y, y0 + radio), y1 - radio);
  if (x < x0 || x > x1 || y < y0 || y > y1) return 0;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= radio - 0.5) return 1;
  if (d >= radio + 0.5) return 0;
  return radio + 0.5 - d;
}

/**
 * Color de fondo del propio logo, promediando sus cuatro esquinas.
 *
 * La placa se pinta de ESE color y no de blanco fijo. Marespi, por ejemplo, trae un
 * gris claro de fondo: con una placa blanca quedaba un doble borde —el marco blanco
 * y adentro el rectángulo gris— que se lee como un recorte mal hecho. Tomando el
 * color del logo, la placa y el logo se funden en una sola pieza.
 *
 * Una esquina transparente cuenta como blanco: es el fondo sobre el que se compone.
 */
function colorDeFondo(logo) {
  const esquinas = [
    [0, 0],
    [logo.ancho - 1, 0],
    [0, logo.alto - 1],
    [logo.ancho - 1, logo.alto - 1],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of esquinas) {
    const i = (y * logo.ancho + x) * 4;
    const a = logo.rgba[i + 3] / 255;
    r += logo.rgba[i] * a + 255 * (1 - a);
    g += logo.rgba[i + 1] * a + 255 * (1 - a);
    b += logo.rgba[i + 2] * a + 255 * (1 - a);
  }
  return [
    Math.round(r / esquinas.length),
    Math.round(g / esquinas.length),
    Math.round(b / esquinas.length),
  ];
}

function generar(id, cliente) {
  const origen = path.join(DIR, cliente.logo);
  const logo = leerPng(origen);
  const [placaR, placaG, placaB] = colorDeFondo(logo);

  // El logo entra completo en la zona segura, respetando su proporción. La placa
  // blanca lo rodea con un margen: sin ella, un logo de fondo blanco sobre el color
  // de marca deja un rectángulo duro que se ve como un error de recorte.
  const cajaPlaca = Math.round(LADO * ZONA_SEGURA);
  const margen = Math.round(cajaPlaca * 0.07);
  const cajaLogo = cajaPlaca - margen * 2;

  const escala = Math.min(cajaLogo / logo.ancho, cajaLogo / logo.alto);
  const anchoLogo = Math.max(1, Math.round(logo.ancho * escala));
  const altoLogo = Math.max(1, Math.round(logo.alto * escala));
  const escalado = escalar(logo, anchoLogo, altoLogo);

  // La placa se ajusta a la forma del logo en vez de ser siempre cuadrada: con un
  // logo apaisado, una placa cuadrada deja dos franjas blancas enormes arriba y abajo.
  const anchoPlaca = anchoLogo + margen * 2;
  const altoPlaca = altoLogo + margen * 2;
  const placaX0 = (LADO - anchoPlaca) / 2;
  const placaY0 = (LADO - altoPlaca) / 2;
  const radio = Math.round(Math.min(anchoPlaca, altoPlaca) * 0.14);

  const [fr, fg, fb] = aRgb(cliente.color);
  const lienzo = Buffer.alloc(LADO * LADO * 4);

  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const i = (y * LADO + x) * 4;
      let r = fr, g = fg, b = fb;

      const enPlaca = dentroDelRedondeado(
        x, y, placaX0, placaY0, placaX0 + anchoPlaca, placaY0 + altoPlaca, radio
      );
      if (enPlaca > 0) {
        // Píxel del logo, si cae dentro; si no, blanco de la placa.
        const lx = Math.floor(x - placaX0 - margen);
        const ly = Math.floor(y - placaY0 - margen);
        let pr = placaR, pg = placaG, pb = placaB;
        if (lx >= 0 && lx < anchoLogo && ly >= 0 && ly < altoLogo) {
          const j = (ly * anchoLogo + lx) * 4;
          const a = escalado.rgba[j + 3] / 255;
          // El logo puede traer transparencia; se compone sobre el color de la placa.
          pr = Math.round(escalado.rgba[j] * a + placaR * (1 - a));
          pg = Math.round(escalado.rgba[j + 1] * a + placaG * (1 - a));
          pb = Math.round(escalado.rgba[j + 2] * a + placaB * (1 - a));
        }
        r = Math.round(pr * enPlaca + r * (1 - enPlaca));
        g = Math.round(pg * enPlaca + g * (1 - enPlaca));
        b = Math.round(pb * enPlaca + b * (1 - enPlaca));
      }

      lienzo[i] = r; lienzo[i + 1] = g; lienzo[i + 2] = b; lienzo[i + 3] = 255;
    }
  }

  const salida = path.join(DIR, `icono-${id}.png`);
  escribirPng(salida, LADO, LADO, lienzo);
  console.log(
    `  ${id.padEnd(10)} ${cliente.logo.padEnd(16)} ${logo.ancho}x${logo.alto}` +
      ` → icono-${id}.png (${LADO}x${LADO}, marca ${cliente.color})`
  );
}

// ─── Main ────────────────────────────────────────────────────────────

const clientes = require(path.join(RAIZ, "clientes.json"));
const pedidos = process.argv.slice(2);
const ids = Object.keys(clientes).filter((k) => !k.startsWith("_"));
const objetivo = pedidos.length > 0 ? pedidos : ids;

console.log("Generando íconos:");
let hechos = 0;
for (const id of objetivo) {
  const cliente = clientes[id];
  if (!cliente) {
    console.error(`  ${id}: no está en clientes.json`);
    process.exitCode = 1;
    continue;
  }
  if (!cliente.logo) {
    console.log(`  ${id.padEnd(10)} sin logo todavía — se omite`);
    continue;
  }
  try {
    generar(id, cliente);
    hechos++;
  } catch (e) {
    console.error(`  ${id}: ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`${hechos} ícono(s) generado(s) en assets/clientes/`);
