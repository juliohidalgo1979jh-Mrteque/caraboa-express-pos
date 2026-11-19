import { useState } from 'react';
import { CheckCircle2, ChefHat, Pencil, Plus, Trash2 } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { StockItem, SubRecipe } from '../types';
import { ConfirmDelete, Modal, numberInputValue } from './ui';
import { UNIT_FAMILY, factor } from './PurchaseModal';
import { entryUnit, inItemUnit, lineUnit } from './recipeUnits';

interface Draft { id?: number; name: string; yieldQuantity: string; yieldUnit: string; lines: Array<{ key: number; itemId: number | null; quantity: string; unit: string }> }
let key = 0;

const YIELD_UNITS = ['g', 'kg', 'ml', 'l', 'unid'];

export function SubRecipes({ pin, subs, items, onChanged, onToast }: { pin: string; subs: SubRecipe[]; items: StockItem[]; onChanged: () => void; onToast: (message: string) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<SubRecipe | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const byId = new Map(items.map((item) => [item.id, item]));
  const selectable = items.filter((item) => item.active);

  function edit(sub?: SubRecipe) {
    setError('');
    setDraft(sub
      ? { id: sub.id, name: sub.name, yieldQuantity: numberInputValue(sub.yieldQuantity), yieldUnit: sub.yieldUnit,
          lines: sub.lines.map((line) => { const item = byId.get(line.itemId); const unit = item ? entryUnit(item.unit) : ''; return { key: ++key, itemId: line.itemId, unit, quantity: numberInputValue(Math.round((item ? line.quantity * factor(item.unit, unit) : line.quantity) * 10000) / 10000) }; }) }
      : { name: '', yieldQuantity: '', yieldUnit: 'g', lines: [{ key: ++key, itemId: null, quantity: '', unit: '' }] });
  }
  const update = (k: number, change: Partial<Draft['lines'][number]>) => draft && setDraft({ ...draft, lines: draft.lines.map((line) => (line.key === k ? { ...line, ...change } : line)) });

  // El rendimiento se guarda siempre en g, ml o unidades (1 kg = 1000 g).
  const yieldBase = draft ? parseMoney(draft.yieldQuantity) * (draft.yieldUnit === 'kg' || draft.yieldUnit === 'l' ? 1000 : 1) : 0;
  const storedYieldUnit = draft ? (draft.yieldUnit === 'kg' ? 'g' : draft.yieldUnit === 'l' ? 'ml' : draft.yieldUnit) : '';
  const batchCost = draft ? draft.lines.reduce((sum, line) => { const item = line.itemId ? byId.get(line.itemId) : undefined; return item ? sum + item.unitCost * inItemUnit(line, item) : sum; }, 0) : 0;

  async function save() {
    if (!draft) return;
    const lines = draft.lines.filter((line) => line.itemId !== null || line.quantity.trim());
    const parsed = lines.map((line) => ({ itemId: line.itemId, quantity: Math.round(inItemUnit(line, line.itemId ? byId.get(line.itemId) : undefined) * 10000) / 10000 }));
    if (!draft.name.trim()) { setError('Ponle un nombre a la subreceta.'); return; }
    if (!(yieldBase > 0)) { setError('Indica cuánto rinde un lote (por ejemplo 3000 g).'); return; }
    if (!parsed.length || parsed.some((line) => line.itemId === null || !(line.quantity > 0))) { setError('Cada línea necesita un insumo y una cantidad mayor a cero.'); return; }
    if (new Set(parsed.map((line) => line.itemId)).size !== parsed.length) { setError('Hay un insumo repetido.'); return; }
    setSaving(true);
    const body = { name: draft.name.trim(), yieldQuantity: yieldBase, yieldUnit: storedYieldUnit, lines: parsed };
    const result = await adminRequest<SubRecipe>(draft.id ? `/api/sub-recipes/${draft.id}` : '/api/sub-recipes', draft.id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setDraft(null); onToast('Subreceta guardada'); onChanged();
  }

  async function remove() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ removedFromRecipes: string[] }>(`/api/sub-recipes/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    onToast(result.value.removedFromRecipes.length ? `Subreceta eliminada y quitada de: ${result.value.removedFromRecipes.join(', ')}` : 'Subreceta eliminada');
    setToDelete(null); onChanged();
  }

  return (
    <div className="sub-recipes">
      <div className="sub-head"><div><h2>Subrecetas</h2><p className="heading-sub">Preparaciones que se repiten (masa, salsa…). Se arman una vez y se usan en varias recetas; al vender se descuentan sus insumos.</p></div>
        <button className="modal-primary menu-new-button" onClick={() => edit()}><Plus size={16} /> Nueva subreceta</button></div>
      {subs.length === 0 ? <p className="muted">Todavía no hay subrecetas. Ejemplo: «Masa de pizza» que rinde 3000 g con harina, agua y levadura.</p> : <div className="sub-grid">
        {subs.map((sub) => <article key={sub.id} className="sub-card" onClick={() => edit(sub)}>
          <header><ChefHat size={18} /><strong>{sub.name}</strong></header>
          <p>Rinde <b>{sub.yieldQuantity.toLocaleString('es')} {sub.yieldUnit}</b> · lote {currency.format(sub.batchCost)}</p>
          <p className="muted">{currency.format(sub.unitCost * (sub.yieldUnit === 'unid' ? 1 : 100))} por {sub.yieldUnit === 'unid' ? '1 unid' : `100 ${sub.yieldUnit}`}</p>
          <small className="muted">{sub.usedIn.length ? `Usada en: ${sub.usedIn.join(', ')}` : 'Aún no se usa en ninguna receta'}</small>
          <div className="row-actions"><button className="icon-button" aria-label={`Editar ${sub.name}`} onClick={(event) => { event.stopPropagation(); edit(sub); }}><Pencil size={15} /></button>
            <button className="icon-button danger-button" aria-label={`Eliminar ${sub.name}`} onClick={(event) => { event.stopPropagation(); setError(''); setToDelete(sub); }}><Trash2 size={15} /></button></div>
        </article>)}
      </div>}

      {toDelete && <ConfirmDelete title={`¿Eliminar "${toDelete.name}"?`} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void remove()}
        message={toDelete.usedIn.length ? `Se quita de las recetas que la usan (${toDelete.usedIn.join(', ')}) y esas recetas dejan de descontar sus insumos.` : 'No se usa en ninguna receta.'} />}

      {draft && <Modal title={draft.id ? 'Editar subreceta' : 'Nueva subreceta'} eyebrow="RECETAS Y COSTOS" icon={<ChefHat size={19} />} onClose={() => setDraft(null)} wide>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="field-label" htmlFor="sub-name">Nombre</label>
          <input id="sub-name" className="text-input" maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej.: Masa de pizza" />
          <label className="field-label" htmlFor="sub-yield">¿Cuánto rinde un lote?</label>
          <div className="qty-unit"><input id="sub-yield" className="text-input" inputMode="decimal" autoComplete="off" value={draft.yieldQuantity} onChange={(event) => setDraft({ ...draft, yieldQuantity: event.target.value })} placeholder="Ej.: 3000" />
            <select aria-label="Unidad del rendimiento" className="text-input" value={draft.yieldUnit} onChange={(event) => setDraft({ ...draft, yieldUnit: event.target.value })}>{YIELD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
          <span className="field-label">Insumos del lote completo</span>
          <div className="recipe-lines">
            {draft.lines.map((line) => {
              const item = line.itemId ? byId.get(line.itemId) : undefined;
              const cost = item ? item.unitCost * inItemUnit(line, item) : 0;
              return <div className="recipe-line" key={line.key}>
                <select className="text-input" aria-label="Insumo" value={line.itemId ?? ''} onChange={(event) => update(line.key, { itemId: event.target.value ? Number(event.target.value) : null, unit: '' })}>
                  <option value="">Elegir insumo…</option>
                  {selectable.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
                <div className="money-input recipe-quantity"><input aria-label="Cantidad" type="text" inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => update(line.key, { quantity: event.target.value })} placeholder="0" />
                  {item && UNIT_FAMILY[item.unit] ? <select aria-label="Unidad" className="unit-select" value={lineUnit(line, item)} onChange={(event) => update(line.key, { unit: event.target.value })}>{[...UNIT_FAMILY[item.unit]].reverse().map((u) => <option key={u} value={u}>{u}</option>)}</select> : <span>{item?.unit ?? ''}</span>}</div>
                <span className="recipe-line-cost">{cost > 0 ? currency.format(cost) : '—'}</span>
                <button type="button" className="icon-button" aria-label="Quitar insumo" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((other) => other.key !== line.key) })}><Trash2 size={15} /></button>
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button add-line" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { key: ++key, itemId: null, quantity: '', unit: '' }] })}><Plus size={14} /> Agregar insumo</button>
          <div className="checkout-breakdown recipe-summary"><div><span>Costo del lote</span><strong>{currency.format(batchCost)}</strong></div>
            {yieldBase > 0 && batchCost > 0 && <div><span>Costo por {storedYieldUnit === 'unid' ? 'unidad' : `100 ${storedYieldUnit}`}</span><strong>{currency.format((batchCost / yieldBase) * (storedYieldUnit === 'unid' ? 1 : 100))}</strong></div>}</div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar subreceta'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </div>
  );
}
