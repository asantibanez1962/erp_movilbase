import * as Print from "expo-print";
import type { Recibo } from "@erp/shared-sync";

/**
 * Genera PDF del recibo + abre el system print dialog. El user pica
 * "ESCprint Service" en el diálogo → bytes ESC/POS → 3nstar.
 *
 * El template es HTML rendereado por el WebView del system. Width
 * limitado a 80mm para que matchee el ancho del papel térmico. Fuente
 * monospace para que columnas alineen como "ticket".
 *
 * Si el user cancela el diálogo, no pasa nada — el recibo sigue en WMDB
 * y el botón sigue disponible para reintentar.
 */
export async function printRecibo(
  recibo: Recibo,
  productorName: string,
  options?: { companyName?: string }
): Promise<void> {
  const html = buildReciboHtml(recibo, productorName, options);
  await Print.printAsync({
    html,
    width: 226, // ~80mm @ 72dpi (8.5mm margin cada lado)
    height: 800, // crece según el contenido — placeholder
  });
}

function buildReciboHtml(
  recibo: Recibo,
  productorName: string,
  options?: { companyName?: string }
): string {
  const company = options?.companyName ?? "CONFELDAN";
  const total = recibo.cantidad * recibo.precio;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: 80mm 400mm; margin: 4mm; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11pt;
    margin: 0;
    padding: 0;
    color: #000;
    line-height: 1.35;
  }
  .center { text-align: center; }
  .header {
    font-size: 14pt;
    font-weight: bold;
    margin-bottom: 6px;
  }
  .recibo-num {
    font-size: 12pt;
    font-weight: bold;
    margin: 4px 0;
  }
  .sep {
    border: 0;
    border-top: 1px dashed #000;
    margin: 6px 0;
  }
  .row {
    display: flex;
    justify-content: space-between;
    margin: 2px 0;
  }
  .label { font-weight: normal; }
  .value { font-weight: normal; }
  .total {
    font-size: 13pt;
    font-weight: bold;
    margin-top: 4px;
  }
  .firma {
    margin-top: 24px;
    border-top: 1px solid #000;
    padding-top: 4px;
    text-align: center;
    font-size: 9pt;
  }
  .footer {
    text-align: center;
    margin-top: 12px;
    font-size: 9pt;
  }
</style>
</head>
<body>
  <div class="center header">${escapeHtml(company)}</div>
  <hr class="sep" />
  <div class="center recibo-num">RECIBO No. ${escapeHtml(recibo.numeroRecibo)}</div>

  <div class="row"><span class="label">Fecha:</span><span class="value">${escapeHtml(recibo.fecha)}</span></div>

  <hr class="sep" />

  <div><strong>Productor:</strong></div>
  <div>${escapeHtml(productorName)}</div>

  <hr class="sep" />

  <div class="row"><span class="label">Cantidad:</span><span class="value">${fmtQty(recibo.cantidad)}</span></div>
  <div class="row"><span class="label">Precio:</span><span class="value">₡ ${fmtMoney(recibo.precio)}</span></div>

  <hr class="sep" />

  <div class="row"><span>Subtotal:</span><span>₡ ${fmtMoney(total)}</span></div>
<div class="row"><span>Desc. humedad:</span><span>-₡ 250.00</span></div>
<div class="row"><span>Desc. broca:</span><span>-₡ 100.00</span></div>
<div class="row"><span>Bonificación:</span><span>+₡ 500.00</span></div>

  <div class="row total"><span>TOTAL:</span><span>₡ ${fmtMoney(total)}</span></div>

  <hr class="sep" />

  <div class="firma">Firma productor</div>

  <div class="footer">¡Gracias!</div>
</body>
</html>`;
}

function fmtQty(n: number): string {
  return n.toLocaleString("es-CR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
