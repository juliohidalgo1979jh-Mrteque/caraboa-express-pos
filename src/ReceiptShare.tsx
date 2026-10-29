import { useMemo, useState } from 'react';
import { MessageCircle, QrCode } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { currency, paymentLabels } from './data';
import type { LocalSale } from './types';

/** Convierte un celular argentino al formato de WhatsApp (549 + área + número). Vacío = elegir el contacto en WhatsApp. */
export function whatsappNumber(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('549')) return digits;
  if (digits.startsWith('54')) digits = digits.slice(2);
  digits = digits.replace(/^0/, '');
  // "11 15 2345 6789" → quita el 15 que va después del código de área (área de 2 a 4 dígitos).
  if (digits.length === 12) {
    for (const areaLength of [2, 3, 4]) {
      if (digits.slice(areaLength, areaLength + 2) === '15') {
        digits = digits.slice(0, areaLength) + digits.slice(areaLength + 2);
        break;
      }
    }
  }
  return `549${digits}`;
}

export function ticketUrl(sale: LocalSale): string {
  return `${window.location.origin}/ticket/${sale.id}`;
}

export function ticketText(sale: LocalSale): string {
  const when = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(sale.createdAt));
  return [
    '*Tequeños Club*',
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
