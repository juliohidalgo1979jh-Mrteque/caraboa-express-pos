import { useMemo, useState } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { currency } from './data';
import { buildPixPayload, hasPixKey, pixMessage, type PixConfig } from './pix';
import { whatsappNumber } from './ReceiptShare';

interface PixChargeProps {
  config: PixConfig;
  amount: number;
  orderCode: string | null;
  onToast: (message: string) => void;
}

/** Se muestra al elegir Pix/QR en el cobro: QR para escanear y botón para mandar el cobro por WhatsApp. */
export function PixCharge({ config, amount, orderCode, onToast }: PixChargeProps) {
  const [phone, setPhone] = useState('');
  const withKey = hasPixKey(config);
  const hasLink = !!config.link.trim();
  const payload = useMemo(() => (withKey ? buildPixPayload(config, amount, orderCode ?? '') : null), [config, amount, orderCode, withKey]);
  const qrSvg = useMemo(() => {
    if (!payload) return '';
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [payload]);

  if (!withKey && !hasLink) {
    return <div className="pix-box"><small>Todavía no hay clave Pix ni enlace de pago configurados. El administrador los carga en <strong>Puntos de venta → Cobro con Pix</strong>.</small></div>;
  }

  const text = pixMessage(config, currency.format(amount), orderCode, payload);

  function send() {
    window.open(`https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload ?? config.link.trim());
      onToast(payload ? 'Código Pix copiado' : 'Enlace copiado');
    } catch {
      onToast('No se pudo copiar. Usa el botón de WhatsApp.');
    }
  }

  return (
    <div className="pix-box">
      {payload && <div className="pix-qr"><div className="ticket-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} /><small>El cliente lo escanea con el app de su banco · {currency.format(amount)}</small></div>}
      <form className="whatsapp-row" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <input className="text-input" type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Celular del cliente (DDD + número)" aria-label="Celular del cliente para enviar el cobro Pix" />
        <button type="submit" className="secondary-button whatsapp-button"><MessageCircle size={15} /> Enviar Pix</button>
      </form>
      <button type="button" className="secondary-button qr-toggle" onClick={() => void copy()}><Copy size={15} /> {payload ? 'Copiar código Pix' : 'Copiar enlace de pago'}</button>
      <small className="pix-note">El cliente recibe por WhatsApp el {payload ? 'código «copia e cola»' : 'enlace de pago'}{payload && hasLink ? ' y el enlace' : ''} por el monto exacto. Confirma el cobro cuando veas el pago en tu banco.</small>
    </div>
  );
}
