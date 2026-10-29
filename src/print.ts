import { currency, paymentLabels } from './data';
import type { Comanda, LocalSale } from './types';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

// Papel térmico de 80 mm (el área imprimible real es de unos 72 mm).
const PAPER_STYLE = `
  @page { size: 80mm auto; margin: 2mm 3mm; }
  * { box-sizing: border-box; }
  body { width: 72mm; margin: 0; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
  .page { page-break-after: always; padding-bottom: 4mm; }
  .page:last-child { page-break-after: auto; }
  .center { text-align: center; }
  .brand { font-size: 15px; font-weight: 700; }
  .muted { font-size: 11px; }
  .code { margin: 4px 0; font-size: 36px; font-weight: 800; letter-spacing: 1px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .item { display: flex; gap: 6px; margin: 5px 0; font-size: 17px; font-weight: 700; }
  .item .qty { min-width: 28px; }
  .row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
  .total { font-size: 17px; font-weight: 800; }
`;

const articleCount = (count: number) => `${count} ${count === 1 ? 'artículo' : 'artículos'}`;

function documentHtml(title: string, body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAPER_STYLE}</style></head><body>${body}</body></html>`;
}

/** Comanda para cocina: número grande, punto, hora y productos con cantidades (sin precios). */
export function comandasHtml(comandas: Comanda[]): string {
  const pages = comandas.map((comanda) => `
    <div class="page">
      <div class="center muted">COMANDA · ${escapeHtml(comanda.point)} · ${escapeHtml(comanda.time)}</div>
      <div class="center code">${escapeHtml(comanda.orderCode)}</div>
      <hr>
      ${comanda.items.map((item) => `<div class="item"><span class="qty">${item.quantity}×</span><span>${escapeHtml(item.name)}</span></div>`).join('')}
      <hr>
      <div class="center muted">${articleCount(comanda.items.reduce((sum, item) => sum + item.quantity, 0))}</div>
    </div>`);
  return documentHtml('Comandas', pages.join(''));
}

/** Ticket del cliente en 80 mm. */
export function receiptHtml(sale: LocalSale): string {
  const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(sale.createdAt));
  const body = `
    <div class="page">
      <div class="center brand">Caraboa Express</div>
      <div class="center muted">${escapeHtml(when)}${sale.pointName ? ` · ${escapeHtml(sale.pointName)}` : ''}</div>
      ${sale.orderCode ? `<div class="center muted">PEDIDO</div><div class="center code">${escapeHtml(sale.orderCode)}</div>` : ''}
      <hr>
      ${sale.items.map((item) => `<div class="row"><span>${item.quantity} × ${escapeHtml(item.name)}</span><span>${currency.format(item.subtotal)}</span></div>`).join('')}
      <hr>
      <div class="row"><span>Subtotal</span><span>${currency.format(sale.subtotal)}</span></div>
      ${sale.tip ? `<div class="row"><span>Propina</span><span>${currency.format(sale.tip)}</span></div>` : ''}
      <div class="row total"><span>TOTAL</span><span>${currency.format(sale.total)}</span></div>
      <div class="row"><span>Pago</span><span>${escapeHtml(paymentLabels[sale.paymentMethod] ?? sale.paymentMethod)}</span></div>
      ${sale.paymentMethod === 'EFECTIVO' ? `<div class="row"><span>Recibido</span><span>${currency.format(sale.amountReceived)}</span></div><div class="row"><span>Cambio</span><span>${currency.format(sale.changeGiven)}</span></div>` : ''}
      <hr>
      <div class="center">¡Gracias por comer rico!</div>
      <div class="center muted">Documento no válido como factura</div>
    </div>`;
  return documentHtml(`Ticket ${sale.orderCode ?? ''}`, body);
}

/**
 * Imprime un documento en un marco oculto, sin la pantalla de la app. Con Chrome abierto con
 * --kiosk-printing imprime directo en la impresora predeterminada, sin mostrar el diálogo.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.append(frame);
    const frameWindow = frame.contentWindow!;
    frameWindow.document.open();
    frameWindow.document.write(html);
    frameWindow.document.close();
    window.setTimeout(() => {
      frameWindow.focus();
      frameWindow.print();
      // print() vuelve cuando se cerró el diálogo (o enseguida en modo kiosco).
      window.setTimeout(() => {
        frame.remove();
        resolve();
      }, 500);
    }, 200);
  });
}
