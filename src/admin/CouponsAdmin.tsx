import { useState } from 'react';
import { CheckCircle2, Copy, Eye, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { adminRequest } from '../db';
import { ConfirmDelete, Modal, useAdminList } from './ui';

interface PromoCodeRow { id: number; code: string; label: string; kind: 'PERCENT' | 'AMOUNT'; value: number; minTotal: number; maxUses: number; validUntil: string | null; isActive: boolean; uses: number }
interface Draft { id?: number; code: string; label: string; kind: 'PERCENT' | 'AMOUNT'; value: string; minTotal: string; maxUses: string; validUntil: string; isActive: boolean }
interface Use { phone: string; name: string; amount: number; createdAt: string; origin: string }

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const emptyDraft: Draft = { code: '', label: '', kind: 'PERCENT', value: '10', minTotal: '', maxUses: '', validUntil: '', isActive: true };
const num = (text: string) => Number(text.replace(',', '.')) || 0;

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function describe(row: PromoCodeRow) {
  return row.kind === 'PERCENT' ? `${row.value}% de descuento` : `${money.format(row.value)} de descuento`;
}

export function CouponsAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items: codes, error: loadError, reload } = useAdminList<PromoCodeRow>('/api/promo-codes', pin);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<PromoCodeRow | null>(null);
  const [usesFor, setUsesFor] = useState<{ row: PromoCodeRow; uses: Use[] } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function edit(row: PromoCodeRow) {
    setError('');
    setDraft({ id: row.id, code: row.code, label: row.label, kind: row.kind, value: String(row.value), minTotal: row.minTotal ? String(row.minTotal) : '', maxUses: row.maxUses ? String(row.maxUses) : '', validUntil: row.validUntil ?? '', isActive: row.isActive });
  }

  async function save() {
    if (!draft) return;
    if (draft.code.trim().length < 3) { setError('El código necesita al menos 3 letras o números.'); return; }
    if (num(draft.value) <= 0) { setError('Indica cuánto descuenta el código.'); return; }
    setSaving(true);
    const body = { code: draft.code, label: draft.label, kind: draft.kind, value: num(draft.value), minTotal: num(draft.minTotal), maxUses: Math.round(num(draft.maxUses)), validUntil: draft.validUntil || null, isActive: draft.isActive };
    const result = await adminRequest<PromoCodeRow>(draft.id ? `/api/promo-codes/${draft.id}` : '/api/promo-codes', draft.id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setDraft(null);
    onToast(draft.id ? 'Código actualizado' : 'Código creado');
    void reload();
  }

  async function remove() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean }>(`/api/promo-codes/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setToDelete(null);
    onToast('Código eliminado');
    void reload();
  }

  async function showUses(row: PromoCodeRow) {
    const result = await adminRequest<{ uses: Use[] }>(`/api/promo-codes/${row.id}/uses`, 'GET', undefined, pin);
    if (result.ok) setUsesFor({ row, uses: result.value.uses }); else onToast(result.message);
  }

  function copyMessage(row: PromoCodeRow) {
    const text = `Usa el código ${row.code} y recibe ${describe(row)} en tu pedido: ${window.location.origin}/pedir (una vez por persona)`;
    void navigator.clipboard?.writeText(text).then(() => onToast('Mensaje copiado: pégalo en tu publicación'), () => onToast(text));
  }

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> PROMOCIONES</p><h1>Códigos promocionales</h1><p className="heading-sub">Crea un código para tus redes sociales. Cada persona (por su WhatsApp) lo puede usar una sola vez, en el portal y en la caja.</p></div>
        <div className="heading-actions"><button className="modal-primary menu-new-button" onClick={() => { setError(''); setDraft({ ...emptyDraft, code: randomCode() }); }}><Plus size={16} /> Nuevo código</button></div></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      <p className="pending-box"><Tag size={16} /><span>Los premios de fidelidad de los clientes (códigos <strong>FID-…</strong>) también se canjean en la caja y en el portal; no hace falta crearlos aquí.</span></p>
      {codes.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>CÓDIGO</th><th>CAMPAÑA</th><th>DESCUENTO</th><th>USOS</th><th>VENCE</th><th>ESTADO</th><th /></tr></thead><tbody>
        {codes.map((row) => <tr key={row.id}><td><strong>{row.code}</strong></td><td>{row.label || '—'}</td><td>{describe(row)}{row.minTotal > 0 && <small className="muted"> · desde {money.format(row.minTotal)}</small>}</td>
          <td>{row.uses}{row.maxUses ? ` de ${row.maxUses}` : ''}</td><td>{row.validUntil ? new Date(`${row.validUntil}T12:00:00`).toLocaleDateString('es-AR') : 'Sin fecha'}</td><td>{row.isActive ? 'Activo' : 'Desactivado'}</td>
          <td className="align-right"><button className="icon-button" aria-label={`Copiar mensaje de ${row.code}`} onClick={() => copyMessage(row)}><Copy size={15} /></button>
            <button className="icon-button" aria-label={`Ver usos de ${row.code}`} onClick={() => void showUses(row)}><Eye size={15} /></button>
            <button className="icon-button" aria-label={`Editar ${row.code}`} onClick={() => edit(row)}><Pencil size={15} /></button>
            <button className="icon-button danger-button" aria-label={`Eliminar ${row.code}`} onClick={() => { setError(''); setToDelete(row); }}><Trash2 size={15} /></button></td></tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Tag size={25} /></span><strong>Todavía no hay códigos</strong><span>Crea uno, por ejemplo INSTAGRAM10, y compártelo en tus redes.</span></div>}

      {draft && <Modal title={draft.id ? 'Editar código' : 'Nuevo código'} eyebrow="PROMOCIONES" icon={<Tag size={19} />} onClose={() => setDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="field-label" htmlFor="cp-code">Código <span>letras y números, sin espacios</span></label>
          <div className="coupon-fields"><input id="cp-code" className="text-input" maxLength={20} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
            <button type="button" className="coupon-apply" onClick={() => setDraft({ ...draft, code: randomCode() })}>Generar</button></div>
          <label className="field-label" htmlFor="cp-label">Campaña <span>para tu control, opcional</span></label>
          <input id="cp-label" className="text-input" maxLength={80} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="Ej.: Sorteo de Instagram" />
          <span className="field-label">Tipo de descuento</span>
          <div className="method-options" role="group" aria-label="Tipo de descuento">
            <button type="button" className={draft.kind === 'PERCENT' ? 'selected' : ''} aria-pressed={draft.kind === 'PERCENT'} onClick={() => setDraft({ ...draft, kind: 'PERCENT' })}>Porcentaje (%)</button>
            <button type="button" className={draft.kind === 'AMOUNT' ? 'selected' : ''} aria-pressed={draft.kind === 'AMOUNT'} onClick={() => setDraft({ ...draft, kind: 'AMOUNT' })}>Monto fijo (R$)</button>
          </div>
          <label className="field-label" htmlFor="cp-value">{draft.kind === 'PERCENT' ? 'Porcentaje de descuento' : 'Monto de descuento'}</label>
          <div className="money-input"><span>{draft.kind === 'PERCENT' ? '%' : 'R$'}</span><input id="cp-value" type="text" inputMode="decimal" autoComplete="off" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></div>
          <label className="field-label" htmlFor="cp-min">Compra mínima <span>opcional</span></label>
          <div className="money-input"><span>R$</span><input id="cp-min" type="text" inputMode="decimal" autoComplete="off" value={draft.minTotal} onChange={(event) => setDraft({ ...draft, minTotal: event.target.value })} placeholder="0,00" /></div>
          <label className="field-label" htmlFor="cp-max">Máximo de personas <span>vacío = sin límite</span></label>
          <input id="cp-max" className="text-input" type="text" inputMode="numeric" value={draft.maxUses} onChange={(event) => setDraft({ ...draft, maxUses: event.target.value.replace(/\D/g, '') })} placeholder="Ej.: 50" />
          <label className="field-label" htmlFor="cp-until">Vence el <span>opcional</span></label>
          <input id="cp-until" className="text-input" type="date" value={draft.validUntil} onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })} />
          <label className="delivery-toggle"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} /> Código activo</label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar código'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
      {usesFor && <Modal title={`Usos de ${usesFor.row.code}`} eyebrow="PROMOCIONES" icon={<Eye size={19} />} onClose={() => setUsesFor(null)}>
        {usesFor.uses.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>CLIENTE</th><th>CUÁNDO</th><th>DONDE</th><th className="align-right">DESCUENTO</th></tr></thead><tbody>
          {usesFor.uses.map((use, index) => <tr key={index}><td><strong>{use.name || 'Sin nombre'}</strong> <small className="muted">…{use.phone}</small></td><td>{dateTime.format(new Date(`${use.createdAt}Z`))}</td><td>{use.origin}</td><td className="align-right">{money.format(use.amount)}</td></tr>)}
        </tbody></table></div> : <p className="muted">Todavía nadie usó este código.</p>}
      </Modal>}
      {toDelete && <ConfirmDelete title="Eliminar código" message={<>¿Eliminar el código <strong>{toDelete.code}</strong>? Si ya se usó, mejor desactívalo para conservar el historial.</>} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void remove()} />}
    </section>
  );
}
