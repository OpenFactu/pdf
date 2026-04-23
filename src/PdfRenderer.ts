import Handlebars from 'handlebars';
import puppeteer, { Browser, PaperFormat } from 'puppeteer';
import crypto from 'crypto';
import QRCode from 'qrcode';
// bwip-js no tiene tipos oficiales; la importación dinámica queda tolerante.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bwipjs = require('bwip-js');
import { DocumentPdfPayload } from './types';
import type { VisualOptions, PageSize, MarginPreset } from './visualOptionsSchema';

type CompiledTemplate = HandlebarsTemplateDelegate<any>;

export interface RenderOptions {
  pageSize?: PageSize;
  orientation?: 'portrait' | 'landscape';
  margins?: MarginPreset;
  showPageNumbers?: boolean;
  footerAlignment?: 'left' | 'center' | 'right';
  /** Si está presente, Puppeteer pintará un footer con QR + Code-128 + meta en CADA página. */
  pageFooter?: {
    docCode: string;
    docHash?: string;
    qrPayload?: string;
    generatedAt?: string;
    extraText?: string;
  };
}

const MARGIN_MM: Record<
  MarginPreset,
  { top: string; right: string; bottom: string; left: string }
> = {
  narrow: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
  normal: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
  wide: { top: '28mm', right: '24mm', bottom: '28mm', left: '24mm' },
};

/**
 * Singleton service que renderiza HTML + Handlebars a PDF usando Puppeteer.
 * Reutiliza una instancia única de Browser y cachea las plantillas compiladas.
 */
export class PdfRenderer {
  private static browser: Browser | null = null;
  private static browserPromise: Promise<Browser> | null = null;
  private static templateCache: Map<string, CompiledTemplate> = new Map();
  private static helpersRegistered = false;

  private static registerHelpers() {
    if (this.helpersRegistered) return;

    Handlebars.registerHelper('formatCurrency', (value: any) => {
      const n = Number(value) || 0;
      return new Handlebars.SafeString(
        n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
      );
    });

    Handlebars.registerHelper('formatNumber', (value: any, decimals: number) => {
      const n = Number(value) || 0;
      const d = typeof decimals === 'number' ? decimals : 2;
      return n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
    });

    Handlebars.registerHelper('formatDate', (value: any) => {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value);
      return d.toLocaleDateString('es-ES');
    });

    Handlebars.registerHelper('padLeft', (value: any, length: number, char: string) => {
      const str = String(value ?? '');
      return str.padStart(length, char ?? '0');
    });

    Handlebars.registerHelper('multiply', (a: any, b: any) => {
      return (Number(a) || 0) * (Number(b) || 0);
    });

    Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
    Handlebars.registerHelper('gt', (a: any, b: any) => Number(a) > Number(b));

    // QR como data URI de SVG. Uso síncrono vía QRCode.toString con type 'svg'.
    Handlebars.registerHelper('qrCode', (value: any, _options: any) => {
      try {
        const text = String(value ?? '');
        if (!text) return new Handlebars.SafeString('');
        // qrcode no expone una versión síncrona oficial de toString; usamos
        // la interna `create` para generar la matriz y pintamos el SVG a mano.
        const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
        const size = qr.modules.size;
        let path = '';
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (qr.modules.get(x, y)) path += `M${x},${y}h1v1h-1z`;
          }
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
        return new Handlebars.SafeString(
          `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        );
      } catch {
        return new Handlebars.SafeString('');
      }
    });

    // Barcode 1D — usa bwip-js a SVG.
    Handlebars.registerHelper('barcode', function (this: any, value: any, options: any) {
      try {
        const text = String(value ?? '');
        if (!text) return new Handlebars.SafeString('');
        const hash = options?.hash || {};
        const symbology = (hash.symbology as string) || 'code128';
        const includeText = Boolean(hash.includeText);
        const svg = bwipjs.toSVG({
          bcid: symbology,
          text,
          scale: 2,
          height: 10,
          includetext: includeText,
          textxalign: 'center',
        });
        return new Handlebars.SafeString(
          `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        );
      } catch {
        return new Handlebars.SafeString('');
      }
    });

    this.helpersRegistered = true;
  }

  private static async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.browserPromise) return this.browserPromise;

    this.browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    this.browser = await this.browserPromise;
    this.browserPromise = null;
    return this.browser;
  }

  private static compile(html: string): CompiledTemplate {
    const hash = crypto.createHash('sha1').update(html).digest('hex');
    let compiled = this.templateCache.get(hash);
    if (!compiled) {
      compiled = Handlebars.compile(html, { noEscape: false });
      this.templateCache.set(hash, compiled);
      if (this.templateCache.size > 50) {
        const firstKey = this.templateCache.keys().next().value;
        if (firstKey) this.templateCache.delete(firstKey);
      }
    }
    return compiled;
  }

  public static invalidateCache() {
    this.templateCache.clear();
  }

  private static buildFooterTemplate(alignment: string): string {
    const align =
      alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center';
    return `<div style="font-size:8pt; color:#94a3b8; width:100%; padding:0 15mm; display:flex; justify-content:${align}; font-family:-apple-system,sans-serif;">
      <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`;
  }

  /**
   * Construye el footer HTML que Puppeteer pinta en CADA página: QR + Code-128
   * + línea meta con docCode · hash · timestamp · página X/Y. Los códigos se
   * generan aquí como data URIs porque Puppeteer no ejecuta Handlebars en los
   * templates de header/footer.
   */
  private static buildDocumentFooterTemplate(
    meta: NonNullable<RenderOptions['pageFooter']>,
  ): string {
    // QR SVG data URI (mismo algoritmo que el helper Handlebars `qrCode`)
    let qrDataUri = '';
    try {
      const text = meta.qrPayload || meta.docCode;
      if (text) {
        const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
        const size = qr.modules.size;
        let path = '';
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (qr.modules.get(x, y)) path += `M${x},${y}h1v1h-1z`;
          }
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${path}"/></svg>`;
        qrDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      }
    } catch {
      /* noop */
    }

    // Code-128 data URI
    let bcDataUri = '';
    try {
      if (meta.docCode) {
        const svg = bwipjs.toSVG({
          bcid: 'code128',
          text: meta.docCode,
          scale: 2,
          height: 8,
          includetext: false,
        });
        bcDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      }
    } catch {
      /* noop */
    }

    const metaParts: string[] = [];
    metaParts.push(meta.docCode);
    if (meta.docHash) metaParts.push(`Hash&nbsp;${meta.docHash}`);
    if (meta.generatedAt) metaParts.push(meta.generatedAt);
    if (meta.extraText) metaParts.push(meta.extraText);

    const metaLine = metaParts.join(' · ');

    const qrImg = qrDataUri
      ? `<img src="${qrDataUri}" style="width:26px;height:26px;display:block;flex-shrink:0;" />`
      : '';
    const bcImg = bcDataUri
      ? `<img src="${bcDataUri}" style="height:22px;width:auto;max-width:140px;display:block;flex-shrink:0;" />`
      : '';

    return `<div style="width:100%; padding:0 10mm 4mm 10mm; font-family:'JetBrains Mono','SFMono-Regular',Menlo,monospace; font-size:7pt; color:#64748B; letter-spacing:0.3px; box-sizing:border-box;">
  <div style="display:flex; align-items:center; gap:10px; border-top:1px solid #E2E8F0; padding-top:4mm;">
    ${qrImg}
    ${bcImg}
    <span style="flex:1; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:uppercase;">
      ${metaLine} · Pág&nbsp;<span class="pageNumber"></span>/<span class="totalPages"></span>
    </span>
  </div>
</div>`;
  }

  /**
   * Renderiza el HTML+Handlebars con los datos del documento y devuelve el Buffer del PDF.
   */
  public static async render(
    templateHtml: string,
    data: DocumentPdfPayload,
    options: RenderOptions = {},
  ): Promise<Buffer> {
    this.registerHelpers();
    const compiled = this.compile(templateHtml);
    const renderedHtml = compiled(data);

    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(renderedHtml, { waitUntil: 'networkidle0' });

      const margin = options.margins ? MARGIN_MM[options.margins] : MARGIN_MM.normal;
      // Si hay pageFooter con códigos, ampliamos el margen inferior para dejar
      // hueco sin recortar el contenido. 28mm cubre QR 26px + línea meta cómoda.
      const hasDocFooter = !!options.pageFooter;
      const marginFinal = hasDocFooter ? { ...margin, bottom: '28mm' } : margin;

      const displayHeaderFooter = hasDocFooter || !!options.showPageNumbers;

      let footerTemplate: string | undefined;
      if (hasDocFooter && options.pageFooter) {
        footerTemplate = this.buildDocumentFooterTemplate(options.pageFooter);
      } else if (options.showPageNumbers) {
        footerTemplate = this.buildFooterTemplate(options.footerAlignment || 'center');
      }

      const buffer = await page.pdf({
        format: (options.pageSize || 'A4') as PaperFormat,
        landscape: options.orientation === 'landscape',
        printBackground: true,
        margin: marginFinal,
        displayHeaderFooter,
        headerTemplate: displayHeaderFooter ? '<span></span>' : undefined,
        footerTemplate,
        preferCSSPageSize: true,
      });
      return Buffer.from(buffer);
    } finally {
      await page.close();
    }
  }

  /**
   * Construye RenderOptions a partir de unas VisualOptions parseadas del meta del HTML.
   */
  public static renderOptionsFromVisual(opts: VisualOptions): RenderOptions {
    return {
      pageSize: opts.pageSize,
      orientation: opts.orientation,
      margins: opts.margins,
      showPageNumbers: opts.footer.showPageNumbers,
      footerAlignment: opts.footer.alignment,
    };
  }

  /**
   * Atajo para construir `pageFooter` desde el payload del documento.
   * `renderDocumentPdf` lo llama para activar el pie per-page con QR+Code-128.
   */
  public static pageFooterFromPayload(payload: DocumentPdfPayload, extraText?: string) {
    return {
      docCode: payload.doc.docCode,
      docHash: payload.docHash,
      qrPayload: payload.qrPayload,
      generatedAt: payload.generatedAt,
      extraText,
    };
  }

  public static async shutdown() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = null;
    }
  }
}
