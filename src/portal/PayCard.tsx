import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, MessageCircle } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { buildPixPayload, hasPixKey, type PixConfig } from '../pix';
import { formatMoney, strings, type Lang } from './i18n';

interface PayInfo {
  code: string;
  name: string;
  lang: Lang;
  fulfillment: 'ENTREGA' | 'RETIRO';
  total: number;
  deliveryFee: number | null;
  paid: boolean;
  cancelled: boolean;
  ready: boolean;
  pix: PixConfig;
  whatsapp: string;
}

/** Cobro Pix del cliente: QR y código «copia e cola» con el monto exacto de su pedido. Se actualiza sola cuando el local confirma el pago. */
export function PayCard({ code, token, lang }: { code: string; token: string; lang: Lang }) {
  const t = strings[lang];
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/portal/pay/${encodeURIComponent(code)}?t=${encodeURIComponent(token)}`);
      if (!response.ok) throw new Error('not found');
      setInfo(await response.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [code, token]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  const payload = useMemo(() => (info && info.ready && hasPixKey(info.pix) ? buildPixPayload(info.pix, info.total, info.code.replace(/\W/g, '')) : null), [info]);
  const qrSvg = useMemo(() => {
    if (!payload) return '';
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [payload]);

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(''), 3000);
    } catch {
      setCopied('fail');
    }
  }

  if (failed && !info) return <p className="pay-note pay-error">{t.payError}</p>;
  if (!info) return null;
  if (info.cancelled) return <p className="pay-note pay-error">{t.payCancelled}</p>;
  if (info.paid) return <p className="pay-note pay-paid"><CheckCircle2 size={20} /> {t.payPaid}</p>;
  if (!info.ready) {
    return <div className="pay-card"><p className="pay-note">{t.payWaitFee}</p><button className="btn-ghost" onClick={() => void load()}>{t.payRefresh}</button></div>;
  }
  const link = info.pix.link.trim();
  if (!payload && !link) return <p className="pay-note">{t.payNone}</p>;
  const proofHref = info.whatsapp ? `https://wa.me/${info.whatsapp}?text=${encodeURIComponent(t.payProofText(info.code))}` : '';

  return (
    <div className="pay-card">
      <h3>{t.payTitle}</h3>
      <p className="pay-amount"><span>{t.payAmount}</span><strong>{formatMoney(info.total, lang)}</strong></p>
      {payload && <div className="pay-qr" aria-label={t.payScan}><div dangerouslySetInnerHTML={{ __html: qrSvg }} /><small>{t.payScan}</small></div>}
      {payload && <button className="btn-primary" onClick={() => void copy(payload, 'code')}><Copy size={16} /> {copied === 'code' ? t.payCopied : t.payCopy}</button>}
      {payload && info.pix.keyType !== 'NONE' && (
        <p className="pay-key"><span>{t.payKey}</span><button type="button" className="pay-key-btn" onClick={() => void copy(info.pix.key.trim(), 'key')}>{info.pix.key.trim()} <Copy size={13} /></button></p>
      )}
      {link && <a className="btn-ghost" href={link} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> {t.payLink}</a>}
      {copied === 'fail' && <p className="pay-note pay-error">{t.payCopyFail}</p>}
      {proofHref && <a className="btn-primary whatsapp" href={proofHref} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> {t.payProof}</a>}
    </div>
  );
}
