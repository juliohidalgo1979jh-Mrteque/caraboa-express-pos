import { useState } from 'react';
import { CheckCircle2, MonitorSmartphone, Pencil, Plus, X } from 'lucide-react';
import { paymentLabels, paymentMethods } from '../data';
import { adminRequest } from '../db';
import type { PaymentMethod, PointOfSale } from '../types';

interface PointsAdminProps {
  pin: string;
  points: PointOfSale[];
  devicePointId: number | null;
  onSaved: (point: PointOfSale) => void;
}

interface PointDraft {
  id?: number;
  name: string;
  code: string;
  methods: PaymentMethod[];
  active: boolean;
}

export function PointsAdmin({ pin, points, devicePointId, onSaved }: PointsAdminProps) {
  const [draft, setDraft] = useState<PointDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleMethod(method: PaymentMethod) {
    if (!draft) return;
    const methods = draft.methods.includes(method) ? draft.methods.filter((item) => item !== method) : [...draft.methods, method];
    setDraft({ ...draft, methods });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || draft.methods.length === 0) {
      setError('Escribe un nombre y elige al menos un medio de pago.');
      return;
    }
    setSaving(true);
    const { id, ...body } = draft;
    const result = await adminRequest<PointOfSale>(id ? `/api/points/${id}` : '/api/points', id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved(result.value);
    setDraft(null);
  }

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> {points.length} PUNTOS</p><h1>Puntos de venta</h1><p className="heading-sub">Cada laptop o celular elige su punto al abrir la app. La letra del punto encabeza sus números de pedido (A-001, B-001…), que vuelven a empezar cada día.</p></div><button className="modal-primary menu-new-button" onClick={() => { setDraft({ name: '', code: '', methods: ['EFECTIVO'], active: true }); setError(''); }}><Plus size={16} /> Nuevo punto</button></div>
      <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PUNTO</th><th>LETRA</th><th>MEDIOS DE PAGO</th><th>ESTADO</th><th /></tr></thead><tbody>
        {points.map((point) => <tr key={point.id} className={point.active ? '' : 'is-hidden'} onClick={() => { setDraft({ ...point }); setError(''); }}>
          <td><span className="menu-product"><span className="cart-thumb cream"><MonitorSmartphone size={16} /></span><strong>{point.name}</strong>{point.id === devicePointId && <span className="sync-label synced">Este dispositivo</span>}</span></td>
          <td><span className="order-number">{point.code}-001</span></td>
          <td>{point.methods.map((method) => paymentLabels[method]).join(' · ')}</td>
          <td><span className={`sync-label ${point.active ? 'synced' : ''}`}>{point.active ? 'Activo' : 'Inactivo'}</span></td>
          <td className="align-right"><button className="icon-button" onClick={(event) => { event.stopPropagation(); setDraft({ ...point }); setError(''); }} aria-label={`Editar ${point.name}`} title="Editar"><Pencil size={15} /></button></td>
        </tr>)}
      </tbody></table></div>

      {draft && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
        <section className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="point-title">
          <div className="modal-topline"><span className="modal-symbol orange"><MonitorSmartphone size={19} /></span><button className="icon-button" onClick={() => setDraft(null)} aria-label="Cerrar"><X size={18} /></button></div>
          <p className="eyebrow">PUNTO DE VENTA</p>
          <h2 id="point-title">{draft.id ? 'Editar punto' : 'Nuevo punto'}</h2>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <div className="product-form-row">
              <div><label className="field-label" htmlFor="point-name">Nombre</label><input id="point-name" className="text-input" autoFocus maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Celular 2" /></div>
              <div><label className="field-label" htmlFor="point-code">Letra <span>{draft.code ? `pedidos ${draft.code.toUpperCase()}-001` : 'vacía = la próxima libre'}</span></label><input id="point-code" className="text-input" maxLength={3} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="Ej. C" /></div>
            </div>
            <span className="field-label">Medios de pago habilitados</span>
            <div className="method-options" role="group" aria-label="Medios de pago">{paymentMethods.map((method) => <button type="button" key={method} className={draft.methods.includes(method) ? 'selected' : ''} aria-pressed={draft.methods.includes(method)} onClick={() => toggleMethod(method)}>{paymentLabels[method]}</button>)}</div>
            <label className="availability-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span><strong>Activo</strong><small>Los puntos inactivos no aparecen al elegir el punto de un dispositivo.</small></span></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar punto'} <CheckCircle2 size={18} /></button>
          </form>
        </section>
      </div>}
    </section>
  );
}
