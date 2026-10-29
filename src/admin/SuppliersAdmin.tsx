import { useState } from 'react';
import { CheckCircle2, Handshake, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminRequest } from '../db';
import type { Supplier } from '../types';
import { ConfirmDelete, Modal, useAdminList } from './ui';

type SupplierDraft = Omit<Supplier, 'id' | 'itemCount'> & { id?: number };

const emptySupplier: SupplierDraft = { name: '', taxId: '', phone: '', email: '', address: '', notes: '', active: true };

export function SuppliersAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items: suppliers, error: loadError, reload } = useAdminList<Supplier>('/api/suppliers', pin);
  const [draft, setDraft] = useState<SupplierDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Supplier | null>(null);

  function edit(supplier?: Supplier) {
    setDraft(supplier ? { name: supplier.name, taxId: supplier.taxId, phone: supplier.phone, email: supplier.email, address: supplier.address, notes: supplier.notes, active: supplier.active, id: supplier.id } : { ...emptySupplier });
    setError('');
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setSaving(true);
    const { id, ...body } = draft;
    const result = await adminRequest<Supplier>(id ? `/api/suppliers/${id}` : '/api/suppliers', id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft(null);
    onToast('Proveedor guardado');
    void reload();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean }>(`/api/suppliers/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onToast(`"${toDelete.name}" se eliminó de proveedores`);
    setToDelete(null);
    void reload();
  }

  const field = (key: keyof SupplierDraft, label: string, placeholder: string, extra: Record<string, unknown> = {}) => draft && (
    <div><label className="field-label" htmlFor={`supplier-${key}`}>{label}</label>
      <input id={`supplier-${key}`} className="text-input" value={String(draft[key] ?? '')} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} placeholder={placeholder} {...extra} /></div>
  );

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> {suppliers.length} PROVEEDORES</p><h1>Proveedores</h1><p className="heading-sub">A quién le compras productos e insumos. Se eligen al registrar una compra.</p></div><button className="modal-primary menu-new-button" onClick={() => edit()}><Plus size={16} /> Nuevo proveedor</button></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {suppliers.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PROVEEDOR</th><th>CUIT</th><th>TELÉFONO</th><th>EMAIL</th><th>ESTADO</th><th /></tr></thead><tbody>
        {suppliers.map((supplier) => <tr key={supplier.id} className={supplier.active ? '' : 'is-hidden'} onClick={() => edit(supplier)}>
          <td><strong>{supplier.name}</strong></td><td>{supplier.taxId || '—'}</td><td>{supplier.phone || '—'}</td><td>{supplier.email || '—'}</td>
          <td><span className={`sync-label ${supplier.active ? 'synced' : ''}`}>{supplier.active ? 'Activo' : 'Inactivo'}</span></td>
          <td className="align-right row-actions"><button className="icon-button" onClick={(event) => { event.stopPropagation(); edit(supplier); }} aria-label={`Editar ${supplier.name}`} title="Editar"><Pencil size={15} /></button>{' '}
            <button className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); setError(''); setToDelete(supplier); }} aria-label={`Eliminar ${supplier.name}`} title="Eliminar proveedor"><Trash2 size={15} /></button></td>
        </tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Handshake size={25} /></span><strong>Todavía no hay proveedores</strong><span>Agrega a quién le compras para registrar compras.</span></div>}

      {toDelete && <ConfirmDelete title={`¿Eliminar "${toDelete.name}"?`} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void confirmDelete()}
        message={<>
          <p>Deja de aparecer en la lista y al registrar compras. Las compras que ya le hiciste conservan su nombre en el historial.</p>
          {(toDelete.itemCount ?? 0) > 0 && <p className="delete-warning">Es el proveedor habitual de {toDelete.itemCount === 1 ? '1 artículo' : `${toDelete.itemCount} artículos`} del inventario, que van a quedar sin proveedor.</p>}
        </>} />}

      {draft && <Modal title={draft.id ? 'Editar proveedor' : 'Nuevo proveedor'} eyebrow="PROVEEDOR" icon={<Handshake size={19} />} onClose={() => setDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {field('name', 'Nombre', 'Ej. Fábrica Mr Tequeño', { autoFocus: true, maxLength: 100 })}
          <div className="product-form-row">{field('taxId', 'CUIT', 'Ej. 30-12345678-9', { maxLength: 20 })}{field('phone', 'Teléfono', 'Ej. 11 5555-5555', { maxLength: 40, inputMode: 'tel' })}</div>
          {field('email', 'Email', 'compras@proveedor.com', { maxLength: 100, type: 'email' })}
          {field('address', 'Dirección', 'Calle y número', { maxLength: 150 })}
          {field('notes', 'Notas', 'Días de entrega, condiciones de pago…', { maxLength: 300 })}
          <label className="availability-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span><strong>Activo</strong><small>Los inactivos no aparecen al registrar compras.</small></span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar proveedor'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </section>
  );
}
