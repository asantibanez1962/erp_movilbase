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
 *   node scripts/verificar.cjs [--cosecha 2025-2026] [--n 5000]
 *
 * Requiere `sqlcmd` y la cadena de conexión del BE.
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

const CX = conexion();

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
const { calcularRecibo } = require(path.join(distDir, "index.js"));

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
process.exitCode = iguales === total ? 0 : 1;
