import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Package, Pencil, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { StockItem, StockKind, StockMovement, StockUnit, Supplier } from '../types';
import { ConfirmDelete, formatQuantity, Modal, numberInputValue, units, useAdminList } from './ui';

type Tab = StockKind | 'MOVIMIENTOS';

interface ItemDraft {
  id?: number;
  kind: StockKind;
  name: string;
  unit: StockUnit;
  initialStock: string;
  minStock: string;
  unitCost: string;
  supplierId: number | null;
  active: boolean;
}

interface MovementDraft {
  item: StockItem;
  kind: 'COMPRA' | 'AJUSTE';
  quantity: string;
  unitCost: string;
  supplierId: number | null;
  note: string;
}

const tabLabels: Record<Tab, string> = { PRODUCTO: 'Productos', INSUMO: 'Insumos', MOVIMIENTOS: 'Movimientos' };
const movementLabels: Record<StockMovement['kind'], string> = { COMPRA: 'Compra', AJUSTE: 'Ajuste', VENTA: 'Venta' };
const dateFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function InventoryAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('PRODUCTO');
  const { items, error: loadError, reload } = useAdminList<StockItem>('/api/stock-items', pin);
  const { items: suppliers } = useAdminList<Supplier>('/api/suppliers', pin);
  const { items: movements, reload: reloadMovements } = useAdminList<StockMovement>('/api/stock-movements', pin);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [movementDraft, setMovementDraft] = useState<MovementDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<StockItem | null>(null);

  const visible = items.filter((item) => item.kind === tab);
  const lowCount = items.filter((item) => item.low && item.active).length;
  const stockValue = useMemo(() => items.reduce((sum, item) => sum + Math.max(item.stock, 0) * item.unitCost, 0), [items]);
  const activeSuppliers = suppliers.filter((supplier) => supplier.active);

  function editItem(item?: StockItem) {
    setError('');
    setItemDraft(item
      ? { id: item.id, kind: item.kind, name: item.name, unit: item.unit, initialStock: '', minStock: numberInputValue(item.minStock), unitCost: numberInputValue(item.unitCost), supplierId: item.supplierId, active: item.active }
      : { kind: tab === 'INSUMO' ? 'INSUMO' : 'PRODUCTO', name: '', unit: 'unid', initialStock: '', minStock: '', unitCost: '', supplierId: null, active: true });
  }

  function startMovement(item: StockItem, kind: 'COMPRA' | 'AJUSTE') {
    setError('');
    setMovementDraft({ item, kind, quantity: kind === 'AJUSTE' ? numberInputValue(item.stock) : '', unitCost: numberInputValue(item.unitCost), supplierId: item.supplierId, note: '' });
  }

  const optionalNumber = (text: string) => (text.trim() ? parseMoney(text) : 0);

  async function saveItem() {
    if (!itemDraft) return;
    const minStock = optionalNumber(itemDraft.minStock);
    const unitCost = optionalNumber(itemDraft.unitCost);
    const initialStock = optionalNumber(itemDraft.initialStock);
    if (!itemDraft.name.trim() || ![minStock, unitCost, initialStock].every((value) => Number.isFinite(value) && value >= 0)) {
      setError('Revisa el nombre y que las cantidades sean números válidos.');
      return;
    }
    setSaving(true);
    const { id, initialStock: _initial, ...rest } = itemDraft;
    const body = { ...rest, minStock, unitCost, ...(id ? {} : { initialStock }) };
    const result = await adminRequest<StockItem>(id ? `/api/stock-items/${id}` : '/api/stock-items', id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setItemDraft(null);
    setTab(result.value.kind);
    onToast(id ? 'Artículo actualizado' : 'Artículo agregado al inventario');
    void reload();
    void reloadMovements();
  }

  async function saveMovement() {
    if (!movementDraft) return;
    const quantity = parseMoney(movementDraft.quantity);
    const unitCost = movementDraft.unitCost.trim() ? parseMoney(movementDraft.unitCost) : null;
    if (!Number.isFinite(quantity) || quantity < 0 || (movementDraft.kind === 'COMPRA' && quantity <= 0) || (unitCost !== null && !(unitCost >= 0))) {
      setError('Ingresa una cantidad y un costo válidos.');
      return;
    }
    setSaving(true);
    const result = await adminRequest<StockItem>('/api/stock-movements', 'POST', {
      itemId: movementDraft.item.id, kind: movementDraft.kind, quantity,
      unitCost: movementDraft.kind === 'COMPRA' ? unitCost : null,
      supplierId: movementDraft.kind === 'COMPRA' ? movementDraft.supplierId : null,
      note: movementDraft.note,
    }, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMovementDraft(null);
    onToast(movementDraft.kind === 'COMPRA' ? 'Compra registrada' : 'Stock ajustado');
    void reload();
    void reloadMovements();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean; removedFromRecipes: string[] }>(`/api/stock-items/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onToast(`"${toDelete.name}" se eliminó del inventario`);
    setToDelete(null);
    void reload();
  }

  const supplierSelect = (value: number | null, onChange: (id: number | null) => void, id: string) => (
    <select id={id} className="text-input" value={value ?? ''} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Sin proveedor</option>
      {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
    </select>
  );

  const countedDifference = movementDraft?.kind === 'AJUSTE' ? parseMoney(movementDraft.quantity) - movementDraft.item.stock : Number.NaN;

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> VALOR EN STOCK {currency.format(stockValue)}</p><h1>Inventario</h1><p className="heading-sub">Productos que compras listos e insumos. Las ventas descuentan stock solas según la receta de cada ítem de la carta.</p></div>{tab !== 'MOVIMIENTOS' && <button className="modal-primary menu-new-button" onClick={() => editItem()}><Plus size={16} /> Nuevo {tab === 'INSUMO' ? 'insumo' : 'producto'}</button>}</div>
      {lowCount > 0 && <div className="menu-offline"><Package size={15} /> {lowCount === 1 ? 'Hay 1 artículo' : `Hay ${lowCount} artículos`} con stock en el mínimo o por debajo.</div>}
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      <div className="category-tabs admin-tabs" role="tablist" aria-label="Secciones del inventario">
        {(Object.keys(tabLabels) as Tab[]).map((key) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{tabLabels[key]}{key !== 'MOVIMIENTOS' && ` (${items.filter((item) => item.kind === key).length})`}</button>)}
      </div>

      {tab === 'MOVIMIENTOS' ? (
        movements.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>FECHA</th><th>ARTÍCULO</th><th>TIPO</th><th className="align-right">CANTIDAD</th><th className="align-right">COSTO UNIT.</th><th>PROVEEDOR / NOTA</th></tr></thead><tbody>
          {movements.map((movement) => <tr key={movement.id}>
            <td>{dateFormat.format(new Date(movement.createdAt))}</td><td><strong>{movement.itemName}</strong></td>
            <td><span className={`sync-label ${movement.kind === 'COMPRA' ? 'synced' : ''}`}>{movementLabels[movement.kind]}</span></td>
            <td className={`align-right ${movement.quantity < 0 ? 'negative' : ''}`}>{movement.quantity > 0 ? '+' : ''}{formatQuantity(movement.quantity, movement.unit)}</td>
            <td className="align-right">{movement.unitCost !== null ? currency.format(movement.unitCost) : '—'}</td>
            <td>{[movement.supplierName, movement.note].filter(Boolean).join(' · ') || '—'}</td>
          </tr>)}
        </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><ClipboardCheck size={25} /></span><strong>Sin movimientos todavía</strong><span>Las compras, ajustes y ventas aparecerán aquí.</span></div>
      ) : visible.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>{tab === 'INSUMO' ? 'INSUMO' : 'PRODUCTO'}</th><th className="align-right">STOCK</th><th className="align-right">MÍNIMO</th><th className="align-right">COSTO</th><th>PROVEEDOR</th><th /></tr></thead><tbody>
        {visible.map((item) => <tr key={item.id} className={item.active ? '' : 'is-hidden'} onClick={() => editItem(item)}>
          <td><strong>{item.name}</strong></td>
          <td className={`align-right ${item.stock < 0 ? 'negative' : ''}`}><strong>{formatQuantity(item.stock, item.unit)}</strong>{item.low && <span className="sync-label low-label">Bajo</span>}</td>
          <td className="align-right">{item.minStock ? formatQuantity(item.minStock, item.unit) : '—'}</td>
          <td className="align-right">{currency.format(item.unitCost)} <small>/ {item.unit}</small></td>
          <td>{item.supplierName ?? '—'}</td>
          <td className="align-right row-actions">
            <button className="secondary-button" onClick={(event) => { event.stopPropagation(); startMovement(item, 'COMPRA'); }}><ShoppingCart size={14} /> Compra</button>
            <button className="secondary-button" onClick={(event) => { event.stopPropagation(); startMovement(item, 'AJUSTE'); }}><ClipboardCheck size={14} /> Contar</button>
            <button className="icon-button" onClick={(event) => { event.stopPropagation(); editItem(item); }} aria-label={`Editar ${item.name}`} title="Editar"><Pencil size={15} /></button>{' '}
            <button className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); setError(''); setToDelete(item); }} aria-label={`Eliminar ${item.name}`} title="Eliminar del inventario"><Trash2 size={15} /></button>
          </td>
        </tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Package size={25} /></span><strong>Sin {tab === 'INSUMO' ? 'insumos' : 'productos'} cargados</strong><span>{tab === 'INSUMO' ? 'Ej. aceite, salsas, cajas, servilletas.' : 'Ej. tequeños congelados, gaseosas.'}</span></div>}

      {toDelete && <ConfirmDelete title={`¿Eliminar "${toDelete.name}"?`} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void confirmDelete()}
        message={<>
          <p>Deja de aparecer en el inventario. Sus compras y movimientos anteriores se conservan en el historial.</p>
          {toDelete.usedIn.length > 0 && <p className="delete-warning">Se va a quitar de {toDelete.usedIn.length === 1 ? 'la receta' : 'las recetas'} de: <strong>{toDelete.usedIn.join(', ')}</strong>. Su costo baja y las próximas ventas ya no lo descuentan.</p>}
        </>} />}

      {itemDraft && <Modal title={itemDraft.id ? 'Editar artículo' : `Nuevo ${itemDraft.kind === 'INSUMO' ? 'insumo' : 'producto'}`} eyebrow="INVENTARIO" icon={<Package size={19} />} onClose={() => setItemDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void saveItem(); }}>
          <span className="field-label">Tipo</span>
          <div className="method-options" role="group" aria-label="Tipo">{(['PRODUCTO', 'INSUMO'] as StockKind[]).map((kind) => <button type="button" key={kind} className={itemDraft.kind === kind ? 'selected' : ''} aria-pressed={itemDraft.kind === kind} onClick={() => setItemDraft({ ...itemDraft, kind })}>{kind === 'PRODUCTO' ? 'Producto (se compra listo)' : 'Insumo (se gasta al preparar)'}</button>)}</div>
          <label className="field-label" htmlFor="item-name">Nombre</label>
          <input id="item-name" className="text-input" autoFocus maxLength={100} value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} placeholder={itemDraft.kind === 'INSUMO' ? 'Ej. Aceite de girasol' : 'Ej. Tequeño congelado'} />
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="item-unit">Unidad</label><select id="item-unit" className="text-input" value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value as StockUnit })}>{units.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></div>
            <div><label className="field-label" htmlFor="item-cost">Costo <span>por {itemDraft.unit}</span></label><div className="money-input"><span>$</span><input id="item-cost" type="text" inputMode="decimal" autoComplete="off" value={itemDraft.unitCost} onChange={(event) => setItemDraft({ ...itemDraft, unitCost: event.target.value })} placeholder="0,00" /></div></div>
          </div>
          <div className="product-form-row">
            {!itemDraft.id && <div><label className="field-label" htmlFor="item-initial">Stock actual <span>{itemDraft.unit}</span></label><input id="item-initial" className="text-input" type="text" inputMode="decimal" autoComplete="off" value={itemDraft.initialStock} onChange={(event) => setItemDraft({ ...itemDraft, initialStock: event.target.value })} placeholder="0" /></div>}
            <div><label className="field-label" htmlFor="item-min">Stock mínimo <span>avisa al llegar</span></label><input id="item-min" className="text-input" type="text" inputMode="decimal" autoComplete="off" value={itemDraft.minStock} onChange={(event) => setItemDraft({ ...itemDraft, minStock: event.target.value })} placeholder="0" /></div>
          </div>
          <label className="field-label" htmlFor="item-supplier">Proveedor habitual</label>
          {supplierSelect(itemDraft.supplierId, (supplierId) => setItemDraft({ ...itemDraft, supplierId }), 'item-supplier')}
          {itemDraft.id && <p className="modal-copy form-hint">Para cambiar el stock usa “Compra” o “Contar”, así queda registrado en los movimientos.</p>}
          <label className="availability-toggle"><input type="checkbox" checked={itemDraft.active} onChange={(event) => setItemDraft({ ...itemDraft, active: event.target.checked })} /><span><strong>Activo</strong><small>Los inactivos no se ofrecen al armar recetas.</small></span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar artículo'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {movementDraft && <Modal title={movementDraft.kind === 'COMPRA' ? 'Registrar compra' : 'Contar stock'} eyebrow={movementDraft.item.name.toUpperCase()} icon={movementDraft.kind === 'COMPRA' ? <ShoppingCart size={19} /> : <ClipboardCheck size={19} />} onClose={() => setMovementDraft(null)}>
        <p className="modal-copy">Stock actual: <strong>{formatQuantity(movementDraft.item.stock, movementDraft.item.unit)}</strong></p>
        <form onSubmit={(event) => { event.preventDefault(); void saveMovement(); }}>
          <label className="field-label" htmlFor="movement-quantity">{movementDraft.kind === 'COMPRA' ? 'Cantidad comprada' : 'Stock contado'} <span>{movementDraft.item.unit}</span></label>
          <input id="movement-quantity" className="text-input" autoFocus type="text" inputMode="decimal" autoComplete="off" value={movementDraft.quantity} onChange={(event) => setMovementDraft({ ...movementDraft, quantity: event.target.value })} placeholder="0" />
          {movementDraft.kind === 'AJUSTE' && Number.isFinite(countedDifference) && <div className="change-row"><span>Diferencia</span><strong>{countedDifference > 0 ? '+' : ''}{formatQuantity(countedDifference, movementDraft.item.unit)}</strong></div>}
          {movementDraft.kind === 'COMPRA' && <>
            <label className="field-label" htmlFor="movement-cost">Costo <span>por {movementDraft.item.unit} · pasa a ser el costo del artículo</span></label>
            <div className="money-input"><span>$</span><input id="movement-cost" type="text" inputMode="decimal" autoComplete="off" value={movementDraft.unitCost} onChange={(event) => setMovementDraft({ ...movementDraft, unitCost: event.target.value })} placeholder="0,00" /></div>
            <label className="field-label" htmlFor="movement-supplier">Proveedor</label>
            {supplierSelect(movementDraft.supplierId, (supplierId) => setMovementDraft({ ...movementDraft, supplierId }), 'movement-supplier')}
          </>}
          <label className="field-label" htmlFor="movement-note">Nota <span>opcional</span></label>
          <input id="movement-note" className="text-input" maxLength={200} value={movementDraft.note} onChange={(event) => setMovementDraft({ ...movementDraft, note: event.target.value })} placeholder={movementDraft.kind === 'COMPRA' ? 'Ej. Factura 0001-00012345' : 'Ej. Merma, se rompió una caja'} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : movementDraft.kind === 'COMPRA' ? 'Registrar compra' : 'Guardar conteo'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </section>
  );
}
