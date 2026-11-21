#!/usr/bin/env node
/**
 * Verifica el port del cálculo contra los recibos REALES de la base.
 *
 * No es un test unitario y no pretende serlo. La pregunta que responde no es "¿pasa?"
 * sino **"¿cuántos de los recibos ya emitidos reproduce, y los que no, por qué?"**. Un
 * runner de tests contestaría "falló" y ahí se acabaría; acá interesa el desglose,
 * porque una diferencia de un cuartillo en 30 recibos de 40.000 no significa lo mismo
 * que 40.000 diferencias de un quintal.
 *
 * Es la fase que puede invalidar el diseño (ver docs/app-recibos-design.md §5): si el
 * port no reproduce lo que el negocio ya emitió, no se puede imprimir offline y hay
 * que replantear el módulo entero. Por eso corre antes de construir pantallas.
 *
 *   node scripts/verificar.cjs [--cosecha 2025-2026] [--n 5000] [--solo-precio]
 *
 * Requiere `sqlcmd` y la cadena de conexión del BE, salvo con `--solo-precio`, que corre
 * únicamente los casos de `buscarPrecio` (datos armados a mano, sin base).
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APPSETTINGS =
  process.env.ERP_APPSETTINGS ??
  "e:/soft/flutter/sci2/ERP.Backend/ERP.Backend/appsettings.json";

// ── Conexión ────────────────────────────────────────────────────────────

function conexion() {
  // appsettings.json lleva comentarios (JSONC) ⇒ JSON.parse se cae. Se extrae por
  // regex y se desescapa el \\ del nombre de instancia.
  const texto = fs.readFileSync(APPSETTINGS, "utf8");
  const m = texto.match(/"DefaultConnection"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error(`no se encontró DefaultConnection en ${APPSETTINGS}`);
  const cs = m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"');
  const p = (k) => (cs.match(new RegExp(`${k}=([^;]*)`, "i")) ?? [])[1];
  return { server: p("Server"), db: p("Database"), user: p("User Id"), pass: p("Password") };
}

/** Se abre después de los casos de precio, que no necesitan base. */
let CX = null;

/** Columnas que quedan como texto pase lo que pase. Ver la nota en el parser. */
const TEXTO = new Set(["recibo", "cosecha", "recibidor"]);

function consultar(sql) {
  const out = execFileSync(
    "sqlcmd",
    ["-S", CX.server, "-d", CX.db, "-U", CX.user, "-P", CX.pass, "-C",
     "-W", "-s", "\t", "-Q", `SET NOCOUNT ON; ${sql}`],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }
  );
  const lineas = out.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t !== "" && !/^\(\d+ (rows? affected|filas afectadas)\)$/i.test(t) && !/^[-\s\t]+$/.test(t);
  });
  if (lineas.length === 0) return [];
  const cols = lineas[0].split("\t").map((c) => c.trim());
  return lineas.slice(1).map((l) => {
    const v = l.split("\t");
    return Object.fromEntries(
      cols.map((c, i) => {
        const raw = (v[i] ?? "").trim();
        if (raw === "" || raw === "NULL") return [c, null];
        // Códigos que DEBEN quedar como texto aunque parezcan números. El recibidor
        // es "001": convertido a 1 deja de casar contra el catálogo, el cálculo no
        // encuentra sus topes y emite el recibo sin castigos — a favor del productor
        // y sin ningún error visible.
        if (TEXTO.has(c)) return [c, raw];
        // sqlcmd emite ".00" para 0.00 y "-.50" para -0.50: el punto inicial sin
        // dígito rompe un Number() ingenuo si no se contempla.
        if (/^-?(\d+(\.\d*)?|\.\d+)$/.test(raw)) return [c, Number(raw)];
        return [c, raw];
      })
    );
  });
}

// ── Argumentos ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = (nombre, def) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SOLO_PRECIO = args.includes("--solo-precio");
const COSECHA = arg("cosecha", null);
const N = Number(arg("n", "5000"));
/** SQL extra para aislar un subconjunto, ej: --where "r.floteseco <> 0". */
const WHERE = arg("where", null);
/** Muestra ejemplos sólo de este campo, para investigar una categoría concreta. */
const CAMPO = arg("campo", null);

// ── El port, ya compilado a CommonJS ────────────────────────────────────

const distDir = path.join(__dirname, "..", "dist-cjs");
if (!fs.existsSync(path.join(distDir, "index.js"))) {
  console.error("Falta compilar. Corré:  pnpm --filter @erp/recibos-calc run verificar");
  process.exit(2);
}
const { calcularRecibo, buscarPrecio } = require(path.join(distDir, "index.js"));

// ── Precio ──────────────────────────────────────────────────────────────
//
// `buscarPrecio` es un port de dbo.f_rc_busca_precio, que identifica al productor por
// `idsocio`. Estos casos son datos armados a mano porque lo que se prueba es la regla
// (filtro y desempate), no los valores de una base. El servidor es la definición de lo
// correcto: si un caso discrepa con él, el bug es del port.

let fallosPrecio = 0;
let idseq = 0;
/** Una fila de rc_precios. Lo que no se pasa queda en NULL = aplica a todos. */
const fila = (o = {}) => ({
  idreprecio: ++idseq, cosecha: "C1", tipocafe: "A", calidad: "1",
  zona: null, recibidor: null, tipo: null, idsocio: null, codigo: null,
  monto: 100, moneda: 1, recalcula: 0, flete: 0, ...o,
});
/** Lo que el recibidor captura. */
const entrada = (o = {}) => ({
  cosecha: "C1", tipocafe: "A", calidad: "1", zona: "Z1", recibidor: "001",
  idsocio: 10, codigo: "P10", tipo: "T1", ...o,
});
/** Verifica qué fila gana, por su `monto` (null = ninguna). */
function caso(nombre, e, filas, montoEsperado) {
  const r = buscarPrecio(e, filas);
  const got = r ? r.monto : null;
  const ok = got === montoEsperado;
  if (!ok) fallosPrecio++;
  console.log(`  ${ok ? "ok  " : "FALLA"} ${nombre}` + (ok ? "" : `  (esperado ${montoEsperado}, salió ${got})`));
}

console.log("Precio — buscarPrecio:");
caso("1. precio de socio, matchea por idsocio",
  entrada({ idsocio: 10 }),
  [fila({ monto: 100 }), fila({ idsocio: 10, monto: 150 })], 150);
caso("1b. el precio de otro socio no aplica",
  entrada({ idsocio: 10 }),
  [fila({ monto: 100 }), fila({ idsocio: 11, monto: 150 })], 100);
caso("2. general (sin socio ni código) aplica a cualquiera",
  entrada({ idsocio: 99, codigo: "ZZ" }),
  [fila({ monto: 100 })], 100);
caso("3. fila vieja sin idsocio y con código cae al match por código",
  entrada({ idsocio: 10, codigo: "P10" }),
  [fila({ monto: 100 }), fila({ codigo: "P10", monto: 140 })], 140);
caso("3b. fila vieja con otro código NO aplica (no se confunde con general)",
  entrada({ idsocio: 10, codigo: "P10" }),
  [fila({ codigo: "P77", monto: 140 })], null);
caso("3c. fila vieja con código empata como 'con socio' y gana a la general",
  entrada({ idsocio: 10, codigo: "P10" }),
  [fila({ tipo: "T1", monto: 120 }), fila({ codigo: "P10", monto: 140 })], 140);
caso("4. productor SIN código recibe su precio específico por idsocio",
  entrada({ idsocio: 10, codigo: "" }),
  [fila({ monto: 100 }), fila({ idsocio: 10, monto: 150 })], 150);
caso("5. código duplicado: con idsocio ya no agarra el precio del otro productor",
  entrada({ idsocio: 10, codigo: "DUP" }),
  [fila({ monto: 100 }), fila({ idsocio: 10, codigo: "DUP", monto: 150 }),
   fila({ idsocio: 11, codigo: "DUP", monto: 999 })], 150);
caso("5b. idsocio de entrada ausente: una fila con idsocio no aplica a nadie",
  entrada({ idsocio: null, codigo: "" }),
  [fila({ monto: 100 }), fila({ idsocio: 10, monto: 150 })], 100);
caso("6a. desempate: socio antes que tipo",
  entrada(),
  [fila({ tipo: "T1", monto: 120 }), fila({ idsocio: 10, monto: 150 })], 150);
caso("6b. desempate: tipo antes que recibidor",
  entrada(),
  [fila({ recibidor: "001", monto: 120 }), fila({ tipo: "T1", monto: 150 })], 150);
caso("6c. desempate: recibidor antes que zona",
  entrada(),
  [fila({ zona: "Z1", monto: 120 }), fila({ recibidor: "001", monto: 150 })], 150);
caso("6d. desempate: a igual especificidad gana el idreprecio mayor",
  entrada(),
  [fila({ idsocio: 10, monto: 150 }), fila({ idsocio: 10, monto: 160 })], 160);
caso("6e. el valor del socio ya no desempata (sólo cuenta tener o no)",
  entrada({ idsocio: 10 }),
  [fila({ idsocio: 10, tipo: "T1", monto: 150 }), fila({ codigo: "Z9", tipo: null, monto: 999 })], 150);
console.log(fallosPrecio === 0 ? "  precio: todo ok\n" : `  precio: ${fallosPrecio} FALLA(S)\n`);

if (SOLO_PRECIO) process.exit(fallosPrecio === 0 ? 0 : 1);

CX = conexion();

// ── Catálogos ───────────────────────────────────────────────────────────

console.log(`Base: ${CX.db} en ${CX.server}`);
process.stdout.write("Bajando catálogos... ");

const castigosBroca = consultar(
  "SELECT granosbroca, cantidad, cuartilloscastigo FROM rc_castigosbroca"
);
const castigosCosecha = consultar(
  "SELECT LTRIM(RTRIM(cosecha)) cosecha, nivel, tipocastigo, topeaceptado, pctcastigo FROM re_castigos_cosecha"
);
const recibidorNivel = consultar(
  "SELECT LTRIM(RTRIM(recibidor)) recibidor, LTRIM(RTRIM(cosecha)) cosecha, nivel FROM rc_recibidorescosechanivel"
);
const catalogos = { castigosBroca, castigosCosecha, recibidorNivel };
console.log(
  `${castigosBroca.length} broca, ${castigosCosecha.length} cosecha, ${recibidorNivel.length} nivel`
);

// ── Recibos ─────────────────────────────────────────────────────────────

const condiciones = [];
if (COSECHA) condiciones.push(`LTRIM(RTRIM(r.cosecha)) = '${COSECHA.replace(/'/g, "''")}'`);
if (WHERE) condiciones.push(`(${WHERE})`);
const filtro = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
process.stdout.write(`Bajando ${N} recibos${COSECHA ? ` de ${COSECHA}` : ""}... `);

const recibos = consultar(`
  SELECT TOP (${N})
    r.recibo, LTRIM(RTRIM(r.cosecha)) cosecha, LTRIM(RTRIM(r.recibidor)) recibidor,
    ISNULL(r.nivel,0) nivel,
    ISNULL(r.cantidadinicial,0) cantidadinicial, ISNULL(r.cuartillosinicial,0) cuartillosinicial,
    ISNULL(r.granosbrocados,0) granosbrocados,
    ISNULL(r.verdes,0) verdes, ISNULL(r.flotemaduro,0) flotemaduro, ISNULL(r.floteseco,0) floteseco,
    ISNULL(r.errormedidor,0) errormedidor,
    ISNULL(r.cantidad,0) e_cantidad,
    ISNULL(r.broca,0) e_broca, ISNULL(r.cuartillosbroca,0) e_cuartillosbroca,
    ISNULL(r.rebajoverde,0) e_rebajoverde, ISNULL(r.cuartillosrebajoverde,0) e_cuartillosrebajoverde,
    ISNULL(r.rebajoflote,0) e_rebajoflote, ISNULL(r.cuartillosrebajoflote,0) e_cuartillosrebajoflote,
    ISNULL(r.rebajofloteseco,0) e_rebajofloteseco, ISNULL(r.cuartillosrebajofloteseco,0) e_cuartillosrebajofloteseco,
    ISNULL(r.rcantidad,0) e_rcantidad, ISNULL(r.rcantidadcuartillos,0) e_rcantidadcuartillos
  FROM recibos r
  ${filtro}
  ORDER BY r.idrecibos DESC
`);
console.log(`${recibos.length}`);

// ── Comparación ─────────────────────────────────────────────────────────

const CAMPOS = [
  ["cantidad", "e_cantidad"],
  ["broca", "e_broca"],
  ["cuartillosbroca", "e_cuartillosbroca"],
  ["rebajoverde", "e_rebajoverde"],
  ["cuartillosrebajoverde", "e_cuartillosrebajoverde"],
  ["rebajoflote", "e_rebajoflote"],
  ["cuartillosrebajoflote", "e_cuartillosrebajoflote"],
  ["rebajofloteseco", "e_rebajofloteseco"],
  ["cuartillosrebajofloteseco", "e_cuartillosrebajofloteseco"],
  ["rcantidad", "e_rcantidad"],
  ["rcantidadcuartillos", "e_rcantidadcuartillos"],
];

let iguales = 0;
const porCampo = new Map();
const ejemplos = [];

for (const r of recibos) {
  const got = calcularRecibo(r, catalogos);
  const difs = [];
  for (const [campo, esperado] of CAMPOS) {
    // Tolerancia de 0.0005: los almacenados son decimal(18,3) y comparar doubles por
    // igualdad exacta reportaría como error una diferencia que no existe.
    if (Math.abs((got[campo] ?? 0) - (r[esperado] ?? 0)) > 0.0005) {
      difs.push({ campo, calculado: got[campo], almacenado: r[esperado] });
      porCampo.set(campo, (porCampo.get(campo) ?? 0) + 1);
    }
  }
  if (difs.length === 0) iguales++;
  else if (ejemplos.length < 8 && (!CAMPO || difs.some((d) => d.campo === CAMPO))) {
    ejemplos.push({ recibo: r.recibo, entrada: r, difs });
  }
}

// ── Reporte ─────────────────────────────────────────────────────────────

const total = recibos.length;
const pct = total ? ((iguales / total) * 100).toFixed(3) : "0";
console.log(`\n${"=".repeat(62)}`);
console.log(`Coinciden: ${iguales}/${total}  (${pct} %)`);

if (porCampo.size > 0) {
  console.log("\nDiferencias por campo:");
  for (const [campo, n] of [...porCampo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${campo.padEnd(28)} ${String(n).padStart(6)}`);
  }
  console.log("\nPrimeros casos:");
  for (const e of ejemplos) {
    const i = e.entrada;
    console.log(`\n  recibo ${i.recibo} — ${i.cosecha} / recibidor ${i.recibidor} / nivel ${i.nivel}`);
    console.log(
      `    bruto=${i.cantidadinicial}+${i.cuartillosinicial}q granos=${i.granosbrocados} ` +
        `verdes=${i.verdes} flotem=${i.flotemaduro} flotes=${i.floteseco} err=${i.errormedidor}`
    );
    for (const d of e.difs) {
      console.log(`    ${d.campo.padEnd(26)} calculado=${d.calculado}  almacenado=${d.almacenado}`);
    }
  }
}
console.log(`${"=".repeat(62)}`);
process.exitCode = iguales === total && fallosPrecio === 0 ? 0 : 1;
