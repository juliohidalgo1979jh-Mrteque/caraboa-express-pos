import { useState } from 'react';
import { CheckCircle2, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { AccountKey, StockItem, Supplier } from '../types';
import { Modal } from './ui';

export const accountLabels: Record<AccountKey, string> = { CAJA: 'Efectivo (caja)', BANCO: 'Banco / Pix', MERCADOPAGO: 'Mercado Pago', TARJETA: 'Tarjeta de crédito (se paga después)' };

interface Line { itemId: number | ''; quantity: string; unit: string; mode: 'UNIT' | 'TOTAL'; price: string; total: string; expiresOn: string }

// Unidades en las que se puede comprar según cómo se controla el artículo (el stock se guarda en la unidad del artículo).
const UNIT_FAMILY: Record<string, string[]> = { g: ['kg', 'g'], kg: ['kg', 'g'], ml: ['l', 'ml'], l: ['l', 'ml'] };
const TO_BASE: Record<string, number> = { kg: 1000, g: 1, l: 1000, ml: 1 };
const BASE_OF: Record<string, string> = { kg: 'g', g: 'g', l: 'ml', ml: 'ml' };
/** Cuántas unidades del artículo equivale 1 unidad comprada (ej. artículo en g, compra en kg → 1000). */
const factor = (bought: string, itemUnit: string) => (BASE_OF[bought] && BASE_OF[bought] === BASE_OF[itemUnit] ? TO_BASE[bought] / TO_BASE[itemUnit] : 1);

interface PurchaseModalProps {
  pin: string;
  items: StockItem[];
  suppliers: Supplier[];
  firstItemId?: number;
  onClose: () => void;
  onSaved: () => void;
}

const emptyLine = (itemId: number | '' = ''): Line => ({ itemId, quantity: '', unit: '', mode: 'UNIT', price: '', total: '', expiresOn: '' });

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
  const lineTotal = (line: Line) => (line.mode === 'UNIT' ? (parseMoney(line.price) || 0) * (parseMoney(line.quantity) || 0) : parseMoney(line.total) || 0);
  const lineUnit = (line: Line, item?: StockItem) => line.unit || item?.unit || '';
  const total = lines.reduce((sum, line) => sum + Math.round(lineTotal(line) * 100) / 100, 0);
  const setLine = (index: number, patch: Partial<Line>) => setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  async function save() {
    const parsed = lines.map((line) => {
      const item = activeItems.find((candidate) => candidate.id === line.itemId);
      const bought = parseMoney(line.quantity);
      // La cantidad se guarda en la unidad del artículo (ej. 2,5 kg → 2500 g) para que las recetas descuenten en gramos.
      return { itemId: line.itemId, quantity: Math.round(bought * factor(lineUnit(line, item), item?.unit ?? '') * 10000) / 10000, lineTotal: Math.round(lineTotal(line) * 100) / 100, expiresOn: line.expiresOn || null };
    });
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
            const units = item ? UNIT_FAMILY[item.unit] : undefined;
            const unit = lineUnit(line, item);
            const quantity = parseMoney(line.quantity) || 0;
            const stored = quantity * factor(unit, item?.unit ?? '');
            const total = lineTotal(line);
            const unitCost = stored > 0 ? total / stored : 0;
            return (
              <div className="purchase-line" key={index}>
                <select aria-label={`Artículo ${index + 1}`} className="text-input" value={line.itemId} onChange={(event) => setLine(index, { itemId: event.target.value ? Number(event.target.value) : '', unit: '' })}>
                  <option value="">Elegir artículo…</option>
                  {activeItems.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} ({candidate.kind === 'INSUMO' ? 'insumo' : 'producto'})</option>)}
                </select>
                <div className="qty-unit">
                  <input aria-label={`Cantidad ${index + 1}`} className="text-input" type="text" inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} placeholder="Cantidad" />
                  {units ? <select aria-label={`Unidad de compra ${index + 1}`} className="text-input" value={unit} onChange={(event) => setLine(index, { unit: event.target.value })}>{units.map((u) => <option key={u} value={u}>{u}</option>)}</select> : <span className="unit-tag">{item?.unit ?? ''}</span>}
                </div>
                <div className="price-mode" role="group" aria-label="Cómo cargar el precio">
                  <button type="button" className={line.mode === 'UNIT' ? 'selected' : ''} onClick={() => setLine(index, { mode: 'UNIT' })}>Precio por {unit || 'unidad'}</button>
                  <button type="button" className={line.mode === 'TOTAL' ? 'selected' : ''} onClick={() => setLine(index, { mode: 'TOTAL' })}>Total</button>
                </div>
                {line.mode === 'UNIT'
                  ? <div className="money-input"><span>R$</span><input aria-label={`Precio por ${unit || 'unidad'} ${index + 1}`} type="text" inputMode="decimal" autoComplete="off" value={line.price} onChange={(event) => setLine(index, { price: event.target.value })} placeholder={`Precio por ${unit || 'unidad'}`} /></div>
                  : <div className="money-input"><span>R$</span><input aria-label={`Total de la línea ${index + 1}`} type="text" inputMode="decimal" autoComplete="off" value={line.total} onChange={(event) => setLine(index, { total: event.target.value })} placeholder="Total" /></div>}
                <input aria-label={`Vencimiento ${index + 1}`} className="text-input" type="date" title="Fecha de vencimiento (opcional)" value={line.expiresOn} onChange={(event) => setLine(index, { expiresOn: event.target.value })} />
                <button type="button" className="icon-button danger-button" aria-label={`Quitar línea ${index + 1}`} onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== index) : [emptyLine()])}><Trash2 size={15} /></button>
                {total > 0 && item && <small className="purchase-unit">{quantity > 0 && line.mode === 'UNIT' ? `${line.quantity} ${unit} × ${currency.format(parseMoney(line.price) || 0)} = ` : ''}<b>{currency.format(total)}</b>{stored > 0 ? ` · entran ${Number(stored.toFixed(3)).toLocaleString('es')} ${item.unit} al stock · ${currency.format(unitCost)} por ${item.unit}` : ''}</small>}
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
