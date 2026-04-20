import type { DocType } from './types';
import {
  DEFAULT_VISUAL_OPTIONS,
  DOC_TYPE_DEFAULT_TITLES,
  DOC_TYPE_PARTNER_LABELS,
  type VisualOptions,
  type WatermarkOptions,
  type PageSize,
  type MarginPreset,
} from './visualOptionsSchema';
import { serializeMeta } from './metaParser';

// ============================================================================
// CONFIG TABLES
// ============================================================================

// Fuentes Keirost brand guide v1.0: Space Grotesk (display), DM Sans (body),
// JetBrains Mono (código). Cargadas desde Google Fonts en el <head> del PDF.
const FONT_FAMILY_CSS: Record<VisualOptions['fontFamily'], string> = {
  sans: `'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif`,
  serif: `Georgia, 'Times New Roman', Times, serif`,
  mono: `'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, 'Courier New', monospace`,
};

const DISPLAY_FONT = `'Space Grotesk', 'DM Sans', system-ui, sans-serif`;
const MONO_FONT = `'JetBrains Mono', 'SFMono-Regular', Menlo, monospace`;

// <link> de Google Fonts incluido en todas las plantillas. Puppeteer lo
// descarga al renderizar — imprescindible para que Space Grotesk esté
// disponible en el PDF.
const GOOGLE_FONTS_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

const PAGE_SIZE_CSS: Record<PageSize, string> = {
  A4: 'A4',
  Letter: 'letter',
  A5: 'A5',
};

const MARGIN_MM: Record<
  MarginPreset,
  { top: number; right: number; bottom: number; left: number }
> = {
  narrow: { top: 10, right: 10, bottom: 10, left: 10 },
  normal: { top: 18, right: 18, bottom: 18, left: 18 },
  wide: { top: 28, right: 24, bottom: 28, left: 24 },
};

// ============================================================================
// UTILITIES
// ============================================================================

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toBase64(str: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    // Browser: btoa necesita ASCII; envolvemos en encodeURIComponent → unescape
    return window.btoa(unescape(encodeURIComponent(str)));
  }
  // Node
  return Buffer.from(str, 'utf-8').toString('base64');
}

function buildWatermarkDataUrl(wm: WatermarkOptions): string {
  const text = escapeXml(wm.text || '');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet" overflow="visible">` +
    `<text x="400" y="300" ` +
    `fill="${wm.color}" fill-opacity="${wm.opacity}" ` +
    `font-size="${wm.fontSize}" font-family="Helvetica, Arial, sans-serif" font-weight="800" ` +
    `text-anchor="middle" dominant-baseline="middle" ` +
    `transform="rotate(${wm.rotation} 400 300)">${text}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function alignToCss(alignment: 'left' | 'center' | 'right'): string {
  return alignment;
}

// ============================================================================
// MAIN GENERATOR
// ============================================================================

export function buildVisualTemplate(docType: DocType, opts: VisualOptions): string {
  const title = opts.customTitle || DOC_TYPE_DEFAULT_TITLES[docType];
  const partnerLabel = DOC_TYPE_PARTNER_LABELS[docType];
  const meta = serializeMeta(opts);
  const margin = MARGIN_MM[opts.margins];
  const pageSizeCss = PAGE_SIZE_CSS[opts.pageSize];
  const orientationCss = opts.orientation === 'landscape' ? ' landscape' : '';
  const fontStack = FONT_FAMILY_CSS[opts.fontFamily];

  // === Fragmentos condicionales ===

  const watermarkHtml = opts.watermark.enabled
    ? `<div class="watermark" aria-hidden="true"></div>`
    : '';

  const watermarkCss = opts.watermark.enabled
    ? `.watermark {
         position: fixed;
         top: 0; left: 0; right: 0; bottom: 0;
         background: url('${buildWatermarkDataUrl(opts.watermark)}') center center / 80% no-repeat;
         pointer-events: none;
         z-index: 9999;
       }`
    : '';

  const logoHtml = opts.logoUrl
    ? `<img src="${escapeXml(opts.logoUrl)}" alt="Logo" class="company-logo" />`
    : '';

  const logoAlignClass = `logo-${opts.logoPosition}`;

  // === Bloques de cliente ===
  const partnerTaxIdBlock = opts.showPartnerTaxId
    ? '{{#if partner.taxId}}<div class="meta">{{partner.taxId}}</div>{{/if}}'
    : '';
  const partnerAddressBlock = opts.showPartnerAddress
    ? '{{#if partner.address}}<div class="meta">{{partner.address}}</div>{{/if}}'
    : '';
  const partnerContactBlock = opts.showPartnerContact
    ? `{{#if partner.email}}<div class="meta">✉ {{partner.email}}</div>{{/if}}{{#if partner.phone}}<div class="meta">☎ {{partner.phone}}</div>{{/if}}`
    : '';

  const shipToBlock = opts.showShipTo
    ? `{{#if doc.shipToAddress}}
    <div class="party">
      <div class="label">Dirección de envío</div>
      <div class="meta">{{doc.shipToAddress}}</div>
    </div>
    {{/if}}`
    : '';

  const billToBlock = opts.showBillTo
    ? `{{#if doc.billToAddress}}
    <div class="party">
      <div class="label">Dirección de facturación</div>
      <div class="meta">{{doc.billToAddress}}</div>
    </div>
    {{/if}}`
    : '';

  const baseDocBlock = opts.showBaseDoc
    ? '{{#if doc.baseDocCode}}<div class="date">Origen: {{doc.baseDocCode}}</div>{{/if}}'
    : '';

  // === Bloques de empresa ===
  const companyTaxIdBlock = opts.showCompanyTaxId
    ? '{{#if company.taxId}}<small>CIF/NIF: {{company.taxId}}</small>{{/if}}'
    : '';
  const companyAddressBlock = opts.showCompanyAddress
    ? '{{#if company.address}}<small>{{company.address}}</small>{{/if}}'
    : '';
  const companyContactBlock = opts.showCompanyContact
    ? `{{#if company.phone}}<small>☎ {{company.phone}}</small>{{/if}}{{#if company.email}}<small>✉ {{company.email}}</small>{{/if}}{{#if company.website}}<small>🌐 {{company.website}}</small>{{/if}}`
    : '';

  // === Columnas de la tabla ===
  const col = opts.columns;
  const colCount =
    Number(col.code) +
    Number(col.description) +
    Number(col.quantity) +
    Number(col.uom) +
    Number(col.price) +
    Number(col.iva) +
    Number(col.lineTotal);

  const headerCells: string[] = [];
  if (col.code) headerCells.push('<th style="width:8%">Código</th>');
  if (col.description) headerCells.push('<th>Descripción</th>');
  if (col.quantity) headerCells.push('<th class="num" style="width:8%">Cant.</th>');
  if (col.uom) headerCells.push('<th class="num" style="width:6%">U.M.</th>');
  if (col.price) headerCells.push('<th class="num" style="width:11%">Precio</th>');
  if (col.iva) headerCells.push('<th class="num" style="width:7%">IVA</th>');
  if (col.lineTotal) headerCells.push('<th class="num" style="width:13%">Total</th>');

  const bodyCells: string[] = [];
  if (col.code) bodyCells.push('<td class="mono">{{itemCode}}</td>');
  if (col.description) {
    // Bloque de trazabilidad dentro de la celda de descripción: si la línea
    // tiene lotes o series, los listamos debajo del nombre en compacto.
    const tracingInline = opts.showBatches
      ? `{{#if batches.length}}<div class="trace-inline">{{#each batches}}<span class="trace-chip">⬢ {{batchNum}} <em>×{{formatNumber quantity 2}}</em></span>{{/each}}</div>{{/if}}`
      : '';
    bodyCells.push(
      `<td><strong>{{itemName}}</strong>{{#if itemDescription}}<br><small class="muted">{{itemDescription}}</small>{{/if}}${tracingInline}</td>`,
    );
  }
  if (col.quantity) bodyCells.push('<td class="num">{{formatNumber quantity 2}}</td>');
  if (col.uom) bodyCells.push('<td class="num">{{uom}}</td>');
  if (col.price) bodyCells.push('<td class="num">{{formatCurrency price}}</td>');
  if (col.iva) bodyCells.push('<td class="num">{{taxRate}}%</td>');
  if (col.lineTotal)
    bodyCells.push('<td class="num"><strong>{{formatCurrency lineTotal}}</strong></td>');

  // === Tax breakdown ===
  const taxBreakdownBlock = opts.showTaxBreakdown
    ? `{{#each doc.taxBreakdown}}
    <div class="row tax"><span>IVA {{rate}}% sobre {{formatCurrency base}}:</span><span>{{formatCurrency tax}}</span></div>
    {{/each}}`
    : '';

  const totalInWordsBlock = opts.showTotalInWords
    ? `{{#if doc.totalInWords}}<div class="total-in-words"><em>{{doc.totalInWords}}</em></div>{{/if}}`
    : '';

  // === Bloque de trazabilidad agregada (lotes/series por línea) ===
  // Agrupamos todos los lotes del documento en una tabla al final — da una
  // vista consolidada que facilita el control de cadena de custodia.
  const batchSummaryBlock = opts.showBatches
    ? `{{#if hasBatches}}
    <section class="trace-block">
      <h3 class="trace-title">Trazabilidad — Lotes / números de serie</h3>
      <table class="trace-table">
        <thead><tr><th>Artículo</th><th>Lote / Serie</th><th class="num">Cantidad</th></tr></thead>
        <tbody>
          {{#each lines}}{{#if batches.length}}{{#each batches}}
          <tr>
            <td><span class="mono">{{../itemCode}}</span> {{../itemName}}</td>
            <td class="mono">{{batchNum}}</td>
            <td class="num">{{formatNumber quantity 2}}</td>
          </tr>
          {{/each}}{{/if}}{{/each}}
        </tbody>
      </table>
    </section>
    {{/if}}`
    : '';

  // === Sello + códigos de trazabilidad del documento ===
  const traceCodesBlock =
    opts.showDocBarcode || opts.showDocQr
      ? `<aside class="doc-seal">
      <div class="doc-seal__codes">
        ${
          opts.showDocQr
            ? '<div class="doc-seal__code"><img src="{{qrCode qrPayload}}" alt="QR" /><span class="doc-seal__label">Verificación</span></div>'
            : ''
        }
        ${
          opts.showDocBarcode
            ? '<div class="doc-seal__code doc-seal__code--bc"><img src="{{barcode doc.docCode symbology=\'code128\'}}" alt="Código" /><span class="doc-seal__label mono">{{doc.docCode}}</span></div>'
            : ''
        }
      </div>
      <div class="doc-seal__meta">
        <div><strong>Hash:</strong> <span class="mono">{{docHash}}</span></div>
        <div><strong>Emitido:</strong> {{generatedAt}}</div>
      </div>
    </aside>`
      : '';

  // === Footer ===
  const footerAlign = alignToCss(opts.footer.alignment);
  const footerSegments: string[] = [];
  if (opts.footer.text) footerSegments.push(`<div>${opts.footer.text}</div>`);
  if (opts.footer.showGeneratedAt)
    footerSegments.push('<div class="footer-meta">Generado {{generatedAt}}</div>');
  const footerBlock =
    footerSegments.length > 0
      ? `<div class="page-footer" style="text-align:${footerAlign};">${footerSegments.join('')}</div>`
      : '';

  // === CSS — Keirost brand guide v1.0 ===
  const css = `
  ${watermarkCss}
  @page {
    size: ${pageSizeCss}${orientationCss};
    margin: ${margin.top}mm ${margin.right}mm ${margin.bottom}mm ${margin.left}mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: ${fontStack};
    color: ${opts.textColor};
    font-size: ${opts.baseFontSize}pt;
    margin: 0;
    padding: 0;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .mono { font-family: ${MONO_FONT}; font-size: ${opts.baseFontSize - 1}pt; color: ${opts.mutedColor}; }
  .muted { color: ${opts.mutedColor}; }

  /* ---------- Cabecera ---------- */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid ${opts.headerBgColor};
    padding-bottom: 14px;
    margin-bottom: 22px;
    gap: 20px;
  }
  .page-header.logo-center { flex-direction: column; align-items: center; text-align: center; }
  .page-header.logo-right  { flex-direction: row-reverse; }
  .company { display: flex; flex-direction: column; gap: 2px; max-width: 60%; }
  .company h1 {
    font-family: ${DISPLAY_FONT};
    font-size: ${opts.baseFontSize + 10}pt;
    font-weight: 700;
    margin: 0 0 4px 0;
    color: ${opts.headerBgColor};
    letter-spacing: -0.4px;
  }
  .company small { color: ${opts.mutedColor}; font-size: ${opts.baseFontSize - 1}pt; display: block; line-height: 1.35; }
  .company-logo { max-height: ${opts.logoMaxHeight}px; max-width: 240px; display: block; margin-bottom: 6px; }
  .doc-info { text-align: right; }
  .doc-info .tag {
    display: inline-block;
    background: ${opts.accentColor};
    color: white;
    padding: 3px 10px;
    font-size: ${opts.baseFontSize - 2}pt;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    border-radius: 2px;
    font-family: ${MONO_FONT};
  }
  .doc-info .code {
    font-family: ${MONO_FONT};
    font-size: ${opts.baseFontSize + 5}pt;
    font-weight: 600;
    margin-top: 8px;
    color: ${opts.headerBgColor};
    letter-spacing: 0.2px;
  }
  .doc-info .date {
    color: ${opts.mutedColor};
    font-size: ${opts.baseFontSize - 1}pt;
    margin-top: 4px;
  }

  /* ---------- Partes (emisor / receptor) ---------- */
  .parties { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .party {
    flex: 1;
    min-width: 220px;
    background: #FAFBFC;
    border: 1px solid #E2E8F0;
    border-left: 3px solid ${opts.accentColor};
    border-radius: 4px;
    padding: 11px 14px;
  }
  .party .label {
    font-family: ${MONO_FONT};
    font-size: ${opts.baseFontSize - 3}pt;
    font-weight: 600;
    color: ${opts.mutedColor};
    text-transform: uppercase;
    letter-spacing: 1.4px;
    margin-bottom: 5px;
  }
  .party .name {
    font-family: ${DISPLAY_FONT};
    font-weight: 600;
    font-size: ${opts.baseFontSize + 2}pt;
    color: ${opts.headerBgColor};
    margin-bottom: 4px;
    letter-spacing: -0.1px;
  }
  .party .meta { color: ${opts.mutedColor}; font-size: ${opts.baseFontSize - 1}pt; line-height: 1.4; }

  /* ---------- Tabla de líneas ---------- */
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead th {
    background: ${opts.headerBgColor};
    color: white;
    text-align: left;
    padding: 8px 10px;
    font-size: ${opts.baseFontSize - 2}pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.9px;
    font-family: ${MONO_FONT};
  }
  thead th.num { text-align: right; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid #E2E8F0; font-size: ${opts.baseFontSize - 1}pt; vertical-align: top; }
  tbody td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: ${MONO_FONT}; }
  tbody tr:nth-child(even) { background: #FAFBFC; }

  /* Chips de trazabilidad inline dentro de la descripción */
  .trace-inline { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
  .trace-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: ${opts.accentColor}14;
    border: 1px solid ${opts.accentColor}40;
    color: ${opts.accentColor};
    font-family: ${MONO_FONT};
    font-size: ${opts.baseFontSize - 3}pt;
    padding: 1px 6px;
    border-radius: 2px;
  }
  .trace-chip em { color: ${opts.headerBgColor}; font-style: normal; font-weight: 600; }

  /* ---------- Totales ---------- */
  .totals { float: right; width: 300px; margin-top: 8px; }
  .totals .row {
    display: flex;
    justify-content: space-between;
    padding: 5px 12px;
    font-size: ${opts.baseFontSize}pt;
  }
  .totals .row.tax { color: ${opts.accentColor}; font-weight: 500; }
  .totals .row.grand {
    background: ${opts.headerBgColor};
    color: white;
    font-family: ${DISPLAY_FONT};
    font-size: ${opts.baseFontSize + 5}pt;
    font-weight: 700;
    padding: 11px 14px;
    border-radius: 4px;
    margin-top: 6px;
    letter-spacing: 0.2px;
  }
  .total-in-words {
    clear: both;
    margin-top: 12px;
    padding: 10px 14px;
    background: #FAFBFC;
    border-left: 3px solid ${opts.accentColor};
    color: ${opts.mutedColor};
    font-size: ${opts.baseFontSize - 1}pt;
    font-style: italic;
    border-radius: 2px;
  }

  /* ---------- Bloque de trazabilidad agregada ---------- */
  .trace-block {
    clear: both;
    margin-top: 20px;
    border: 1px solid #E2E8F0;
    border-top: 2px solid ${opts.accentColor};
    border-radius: 4px;
    padding: 10px 14px 4px;
    page-break-inside: avoid;
  }
  .trace-title {
    font-family: ${DISPLAY_FONT};
    font-size: ${opts.baseFontSize}pt;
    font-weight: 600;
    color: ${opts.headerBgColor};
    margin: 0 0 8px 0;
    letter-spacing: -0.1px;
  }
  .trace-table { width: 100%; border: 0; margin: 0; }
  .trace-table thead th {
    background: transparent;
    color: ${opts.mutedColor};
    padding: 4px 6px;
    font-size: ${opts.baseFontSize - 3}pt;
    border-bottom: 1px solid #E2E8F0;
  }
  .trace-table tbody td { padding: 4px 6px; font-size: ${opts.baseFontSize - 2}pt; border-bottom: 1px solid #F1F5F9; }
  .trace-table tbody tr:nth-child(even) { background: transparent; }

  /* ---------- Sello + QR + Code-128 ---------- */
  .doc-seal {
    clear: both;
    margin-top: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    border-top: 1px solid #E2E8F0;
    padding-top: 14px;
    page-break-inside: avoid;
  }
  .doc-seal__codes { display: flex; gap: 14px; align-items: flex-end; }
  .doc-seal__code { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .doc-seal__code img { height: 56px; width: auto; display: block; }
  .doc-seal__code--bc img { height: 36px; width: 160px; }
  .doc-seal__label {
    font-family: ${MONO_FONT};
    font-size: ${opts.baseFontSize - 4}pt;
    color: ${opts.mutedColor};
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .doc-seal__meta {
    color: ${opts.mutedColor};
    font-size: ${opts.baseFontSize - 2}pt;
    text-align: right;
    line-height: 1.6;
  }
  .doc-seal__meta strong {
    color: ${opts.headerBgColor};
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  /* ---------- Pie de página ---------- */
  .page-footer {
    clear: both;
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #E2E8F0;
    color: ${opts.mutedColor};
    font-size: ${opts.baseFontSize - 2}pt;
  }
  .footer-meta { margin-top: 3px; font-size: ${opts.baseFontSize - 3}pt; opacity: 0.8; font-family: ${MONO_FONT}; }

  ${opts.customCss}
  `;

  // === HTML ===
  return `${meta}
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>{{doc.docCode}}</title>
${GOOGLE_FONTS_LINK}
<style>${css}</style>
</head>
<body>
  ${watermarkHtml}
  <header class="page-header ${logoAlignClass}">
    <div class="company">
      ${logoHtml}
      <h1>{{company.name}}</h1>
      ${companyTaxIdBlock}
      ${companyAddressBlock}
      ${companyContactBlock}
    </div>
    <div class="doc-info">
      <span class="tag">${escapeXml(title)}</span>
      <div class="code">{{doc.docCode}}</div>
      <div class="date">Fecha: {{doc.date}}</div>
      ${baseDocBlock}
      {{#if doc.statusLabel}}<div class="date">Estado: {{doc.statusLabel}}</div>{{/if}}
    </div>
  </header>

  <div class="parties">
    <div class="party">
      <div class="label">${partnerLabel}</div>
      <div class="name">{{partner.name}}{{#if partner.foreignName}} <span class="muted">({{partner.foreignName}})</span>{{/if}}</div>
      ${partnerTaxIdBlock}
      ${partnerAddressBlock}
      ${partnerContactBlock}
      {{#if partner.priceListName}}<div class="meta">Tarifa: {{partner.priceListName}}</div>{{/if}}
    </div>
    ${billToBlock}
    ${shipToBlock}
  </div>

  <table>
    <thead>
      <tr>${headerCells.join('')}</tr>
    </thead>
    <tbody>
      {{#each lines}}
      <tr>${bodyCells.join('')}</tr>
      {{/each}}
      {{#unless lines.length}}
      <tr><td colspan="${colCount}" style="text-align:center; color:${opts.mutedColor}; padding:20px; font-style:italic;">Sin líneas</td></tr>
      {{/unless}}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Base imponible:</span><span>{{formatCurrency doc.subtotal}}</span></div>
    ${taxBreakdownBlock}
    <div class="row grand"><span>TOTAL</span><span>{{formatCurrency doc.total}}</span></div>
  </div>

  ${totalInWordsBlock}

  ${batchSummaryBlock}

  ${traceCodesBlock}

  ${footerBlock}
</body>
</html>`;
}

// Re-export convenience
export { DEFAULT_VISUAL_OPTIONS };
export type { VisualOptions };
