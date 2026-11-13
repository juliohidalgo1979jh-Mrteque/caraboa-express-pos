import { useState } from 'react';
import { CheckCircle2, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { AccountKey, StockItem, Supplier } from '../types';
import { Modal } from './ui';

export const accountLabels: Record<AccountKey, string> = { CAJA: 'Efectivo (caja)', BANCO: 'Banco / Pix', MERCADOPAGO: 'Mercado Pago' };

interface Line { itemId: number | ''; quantity: string; total: string; expiresOn: string }

interface PurchaseModalProps {
  pin: string;
  items: StockItem[];
  suppliers: Supplier[];
  firstItemId?: number;
  onClose: () => void;
  onSaved: () => void;
}

const emptyLine = (itemId: number | '' = ''): Line => ({ itemId, quantity: '', total: '', expiresOn: '' });

export function PurchaseModal({ pin, items, suppliers, firstItemId, onClose, onSaved }: PurchaseModalProps) {
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [document, setDocument] = useState('');
  const [account, setAccount] = useState<AccountKey>('CAJA');
  const [purchasedOn, setPurchasedOn] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(firstItemId ?? '')]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const activeItems = items.filter((item) => item.active);
  const total = lines.reduce((sum, line) => sum + (parseMoney(line.total) || 0), 0);
  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  async function save() {
    const parsed = lines.map((line) => ({ itemId: line.itemId, quantity: parseMoney(line.quantity), lineTotal: parseMoney(line.total), expiresOn: line.expiresOn || null }));
    if (parsed.some((line) => line.itemId === '' || !(line.quantity > 0) || !(line.lineTotal >= 0))) {
      setError('Cada línea necesita un artículo, una cantidad mayor a cero y su total.');
      return;
    }
    setSaving(true);
    const result = await adminRequest('/api/purchases', 'POST', { supplierId, document, account, purchasedOn: purchasedOn || null, note, lines: parsed }, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onSaved();
  }

  return (
    <Modal title="Registrar compra" eyebrow="INVENTARIO · COMPRAS" icon={<ShoppingCart size={19} />} onClose={onClose} wide>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="product-form-row">
          <div><label className="field-label" htmlFor="pur-supplier">Proveedor</label>
            <select id="pur-supplier" className="text-input" value={supplierId ?? ''} onChange={(event) => setSupplierId(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Sin proveedor</option>
              {suppliers.filter((supplier) => supplier.active).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select></div>
          <div><label className="field-label" htmlFor="pur-date">Fecha <span>vacío = hoy</span></label><input id="pur-date" className="text-input" type="date" value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} /></div>
        </div>
        <div className="product-form-row">
          <div><label className="field-label" htmlFor="pur-doc">Factura o comprobante <span>opcional</span></label><input id="pur-doc" className="text-input" maxLength={60} value={document} onChange={(event) => setDocument(event.target.value)} placeholder="Ej. Nota 1234" /></div>
          <div><label className="field-label" htmlFor="pur-account">Pagado con</label>
            <select id="pur-account" className="text-input" value={account} onChange={(event) => setAccount(event.target.value as AccountKey)}>
              {(Object.keys(accountLabels) as AccountKey[]).map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}
            </select></div>
        </div>
        <span className="field-label">Artículos comprados</span>
        <div className="purchase-lines">
          {lines.map((line, index) => {
            const item = activeItems.find((candidate) => candidate.id === line.itemId);
            const quantity = parseMoney(line.quantity) || 0;
            const unitCost = quantity > 0 ? (parseMoney(line.total) || 0) / quantity : 0;
            return (
              <div className="purchase-line" key={index}>
                <select aria-label={`Artículo ${index + 1}`} className="text-input" value={line.itemId} onChange={(event) => setLine(index, { itemId: event.target.value ? Number(event.target.value) : '' })}>
                  <option value="">Elegir artículo…</option>
                  {activeItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.kind === 'INSUMO' ? 'insumo' : 'producto'})</option>)}
                </select>
                <input aria-label={`Cantidad ${index + 1}`} className="text-input" type="text" inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} placeholder={item ? `Cantidad (${item.unit})` : 'Cantidad'} />
                <div className="money-input"><span>R$</span><input aria-label={`Total de la línea ${index + 1}`} type="text" inputMode="decimal" autoComplete="off" value={line.total} onChange={(event) => setLine(index, { total: event.target.value })} placeholder="Total" /></div>
                <input aria-label={`Vencimiento ${index + 1}`} className="text-input" type="date" title="Fecha de vencimiento (opcional)" value={line.expiresOn} onChange={(event) => setLine(index, { expiresOn: event.target.value })} />
                <button type="button" className="icon-button danger-button" aria-label={`Quitar línea ${index + 1}`} onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== index) : [emptyLine()])}><Trash2 size={15} /></button>
                {unitCost > 0 && item && <small className="purchase-unit">{currency.format(unitCost)} por {item.unit}</small>}
              </div>
            );
          })}
        </div>
        <button type="button" className="secondary-button" onClick={() => setLines([...lines, emptyLine()])}><Plus size={14} /> Agregar otro artículo</button>
        <label className="field-label" htmlFor="pur-note">Nota <span>opcional</span></label>
        <input id="pur-note" className="text-input" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
        <div className="denom-total"><span>Total de la compra</span><strong>{currency.format(total)}</strong></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Registrar compra'} <CheckCircle2 size={18} /></button>
      </form>
    </Modal>
  );
}
