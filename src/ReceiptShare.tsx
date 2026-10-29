import { useMemo, useState } from 'react';
import { MessageCircle, QrCode } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { currency, paymentLabels } from './data';
import type { LocalSale } from './types';

/** Convierte un celular al formato de WhatsApp. En Brasil: código de país 55 + área (DDD) + número. Vacío = elegir el contacto en WhatsApp. */
export function whatsappNumber(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return '';
  // Hasta 11 dígitos es un número local (DDD + celular); con más ya trae el código de país.
  return digits.length <= 11 ? `55${digits}` : digits;
}

export function ticketUrl(sale: LocalSale): string {
  return `${window.location.origin}/ticket/${sale.id}`;
}

export function ticketText(sale: LocalSale): string {
  const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(sale.createdAt));
  return [
    '*Caraboa Express*',
    `${sale.orderCode ? `Pedido *${sale.orderCode}* · ` : ''}${when}`,
    '',
    ...sale.items.map((item) => `${item.quantity} × ${item.name}: ${currency.format(item.subtotal)}`),
    ...(sale.tip ? [`Propina: ${currency.format(sale.tip)}`] : []),
    `*Total: ${currency.format(sale.total)}* (${paymentLabels[sale.paymentMethod] ?? sale.paymentMethod})`,
    '',
    `Tu ticket: ${ticketUrl(sale)}`,
    '¡Gracias por comer rico!',
  ].join('\n');
}

export function ReceiptShare({ sale }: { sale: LocalSale }) {
  const [phone, setPhone] = useState('');
  const [showQr, setShowQr] = useState(false);
  const qrSvg = useMemo(() => {
    if (!showQr) return '';
    const qr = qrcode(0, 'M');
    qr.addData(ticketUrl(sale));
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [showQr, sale]);

  function sendWhatsapp() {
    window.open(`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(ticketText(sale))}`, '_blank', 'noopener');
  }

  return (
    <div className="receipt-share">
      <form className="whatsapp-row" onSubmit={(event) => { event.preventDefault(); sendWhatsapp(); }}>
        <input className="text-input" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Celular del cliente (opcional)" aria-label="Celular del cliente para WhatsApp" />
        <button type="submit" className="secondary-button whatsapp-button"><MessageCircle size={15} /> WhatsApp</button>
      </form>
      <button type="button" className="secondary-button qr-toggle" onClick={() => setShowQr(!showQr)}><QrCode size={15} /> {showQr ? 'Ocultar QR' : 'Mostrar QR del ticket'}</button>
      {showQr && <div className="ticket-qr"><div className="ticket-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} /><small>El cliente lo escanea con la cámara y ve su ticket. Si este celular no tiene internet, el ticket aparece cuando sincronice.</small></div>}
    </div>
  );
}
