import { useState } from 'react';
import { CheckCircle2, Pencil, Plus, Wrench } from 'lucide-react';
import { currency, moneyInputValue, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { Equipment, EquipmentStatus } from '../types';
import { Modal, useAdminList } from './ui';

type EquipmentDraft = Omit<Equipment, 'id' | 'value'> & { id?: number; value: string };

const statusLabels: Record<EquipmentStatus, string> = {
  OPERATIVO: 'Operativo',
  EN_REPARACION: 'En reparación',
  FUERA_DE_SERVICIO: 'Fuera de servicio',
};

const emptyEquipment: EquipmentDraft = { name: '', category: '', brand: '', model: '', serialNumber: '', location: '', status: 'OPERATIVO', purchaseDate: null, value: '', notes: '' };

export function EquipmentAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items: equipment, error: loadError, reload } = useAdminList<Equipment>('/api/equipment', pin);
  const [draft, setDraft] = useState<EquipmentDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const totalValue = equipment.reduce((sum, item) => sum + (item.value ?? 0), 0);
  const needsAttention = equipment.filter((item) => item.status !== 'OPERATIVO').length;
  const categories = [...new Set(equipment.map((item) => item.category).filter(Boolean))];

  function edit(item?: Equipment) {
    setError('');
    setDraft(item ? { ...item, value: item.value !== null ? moneyInputValue(item.value) : '' } : { ...emptyEquipment });
  }

  async function save() {
    if (!draft) return;
    const value = draft.value.trim() ? parseMoney(draft.value) : null;
    if (!draft.name.trim() || (value !== null && !(value >= 0))) {
      setError('Revisa el nombre y el valor.');
      return;
    }
    setSaving(true);
    const { id, ...rest } = draft;
    const result = await adminRequest<Equipment>(id ? `/api/equipment/${id}` : '/api/equipment', id ? 'PUT' : 'POST', { ...rest, value, purchaseDate: rest.purchaseDate || null }, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft(null);
    onToast('Equipo guardado');
    void reload();
  }

  const text = (key: 'name' | 'category' | 'brand' | 'model' | 'serialNumber' | 'location' | 'notes', label: string, placeholder: string, extra: Record<string, unknown> = {}) => draft && (
    <div><label className="field-label" htmlFor={`equipment-${key}`}>{label}</label>
      <input id={`equipment-${key}`} className="text-input" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder} {...extra} /></div>
  );

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> {equipment.length} EQUIPOS · VALOR {currency.format(totalValue)}</p><h1>Equipos</h1><p className="heading-sub">Freidoras, heladeras, generador, garrafas, la laptop y los celulares de cobro.</p></div><button className="modal-primary menu-new-button" onClick={() => edit()}><Plus size={16} /> Nuevo equipo</button></div>
      {needsAttention > 0 && <div className="menu-offline"><Wrench size={15} /> {needsAttention === 1 ? '1 equipo necesita' : `${needsAttention} equipos necesitan`} atención (en reparación o fuera de servicio).</div>}
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {equipment.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>EQUIPO</th><th>CATEGORÍA</th><th>MARCA / MODELO</th><th>UBICACIÓN</th><th>ESTADO</th><th className="align-right">VALOR</th><th /></tr></thead><tbody>
        {equipment.map((item) => <tr key={item.id} onClick={() => edit(item)}>
          <td><strong>{item.name}</strong>{item.serialNumber && <small className="point-methods">N.º serie {item.serialNumber}</small>}</td>
          <td>{item.category || '—'}</td><td>{[item.brand, item.model].filter(Boolean).join(' ') || '—'}</td><td>{item.location || '—'}</td>
          <td><span className={`sync-label ${item.status === 'OPERATIVO' ? 'synced' : ''}`}>{statusLabels[item.status]}</span></td>
          <td className="align-right">{item.value !== null ? currency.format(item.value) : '—'}</td>
          <td className="align-right"><button className="icon-button" onClick={(event) => { event.stopPropagation(); edit(item); }} aria-label={`Editar ${item.name}`} title="Editar"><Pencil size={15} /></button></td>
        </tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Wrench size={25} /></span><strong>Todavía no hay equipos</strong><span>Registra los equipos del food truck para saber qué tienes y en qué estado está.</span></div>}

      {draft && <Modal title={draft.id ? 'Editar equipo' : 'Nuevo equipo'} eyebrow="EQUIPOS" icon={<Wrench size={19} />} onClose={() => setDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {text('name', 'Nombre', 'Ej. Freidora industrial', { autoFocus: true, maxLength: 100 })}
          <div className="product-form-row">
            {text('category', 'Categoría', 'Ej. Cocina', { maxLength: 50, list: 'equipment-categories' })}
            {text('location', 'Ubicación', 'Ej. Food truck', { maxLength: 60 })}
          </div>
          <datalist id="equipment-categories">{[...new Set([...categories, 'Cocina', 'Refrigeración', 'Energía', 'Cobro', 'Mobiliario'])].map((category) => <option key={category} value={category} />)}</datalist>
          <div className="product-form-row">{text('brand', 'Marca', 'Ej. Morelli', { maxLength: 60 })}{text('model', 'Modelo', 'Ej. F-20', { maxLength: 60 })}</div>
          {text('serialNumber', 'Número de serie', 'Opcional', { maxLength: 60 })}
          <span className="field-label">Estado</span>
          <div className="method-options" role="group" aria-label="Estado">{(Object.keys(statusLabels) as EquipmentStatus[]).map((status) => <button type="button" key={status} className={draft.status === status ? 'selected' : ''} aria-pressed={draft.status === status} onClick={() => setDraft({ ...draft, status })}>{statusLabels[status]}</button>)}</div>
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="equipment-date">Fecha de compra</label><input id="equipment-date" className="text-input" type="date" value={draft.purchaseDate ?? ''} onChange={(event) => setDraft({ ...draft, purchaseDate: event.target.value || null })} /></div>
            <div><label className="field-label" htmlFor="equipment-value">Valor</label><div className="money-input"><span>$</span><input id="equipment-value" type="text" inputMode="decimal" autoComplete="off" value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} placeholder="0,00" /></div></div>
          </div>
          {text('notes', 'Notas', 'Mantenimiento, garantía, último service…', { maxLength: 300 })}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar equipo'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </section>
  );
}
