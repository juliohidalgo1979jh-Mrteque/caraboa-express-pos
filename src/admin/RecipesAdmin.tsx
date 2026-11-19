import { UNIT_FAMILY, factor } from './PurchaseModal';
import { SubRecipes } from './SubRecipes';
import { entryUnit, inItemUnit, lineUnit } from './recipeUnits';
import { useMemo, useState } from 'react';
import { Calculator, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { currency, moneyInputValue, parseMoney } from '../data';
import { adminRequest, deleteProduct, saveProduct } from '../db';
import type { Product, RecipeSummary, StockItem, SubRecipe } from '../types';
import { ConfirmDelete, formatQuantity, Modal, numberInputValue, useAdminList } from './ui';

interface RecipesAdminProps {
  pin: string;
  menu: Product[];
  onProductSaved: (product: Product) => void;
  onProductDeleted: (productId: number) => void;
  onToast: (message: string) => void;
}

interface LineDraft {
  key: number;
  itemId: number | null;
  quantity: string;
  unit: string;
}

interface SubLineDraft { key: number; subId: number | null; quantity: string }

interface RecipeDraft {
  product: Product;
  lines: LineDraft[];
  subLines: SubLineDraft[];
  margin: string;
  price: string;
}

/** Igual que en el servidor: costo + % de ganancia, redondeado hacia arriba a los $10. */
function suggest(cost: number, margin: number): number | null {
  if (!(cost > 0) || !Number.isFinite(margin)) return null;
  return Math.ceil((cost * (1 + margin / 100)) / 10 - 1e-9) * 10;
}

let lineKey = 0;

export function RecipesAdmin({ pin, menu, onProductSaved, onProductDeleted, onToast }: RecipesAdminProps) {
  const { items: costs, error: loadError, reload } = useAdminList<RecipeSummary>('/api/menu-costs', pin);
  const { items: stockItems } = useAdminList<StockItem>('/api/stock-items', pin);
  const { items: subs, reload: reloadSubs } = useAdminList<SubRecipe>('/api/sub-recipes', pin);
  const subById = useMemo(() => new Map(subs.map((sub) => [sub.id, sub])), [subs]);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Product | null>(null);

  const costByProduct = useMemo(() => new Map(costs.map((row) => [row.productId, row])), [costs]);
  const itemById = useMemo(() => new Map(stockItems.map((item) => [item.id, item])), [stockItems]);
  const selectableItems = stockItems.filter((item) => item.active);

  function edit(product: Product) {
    const summary = costByProduct.get(product.id);
    setError('');
    setDraft({
      product,
      lines: (summary?.lines ?? []).map((line) => { const item = itemById.get(line.itemId); const unit = item ? entryUnit(item.unit) : ''; return { key: ++lineKey, itemId: line.itemId, unit, quantity: numberInputValue(Math.round((item ? line.quantity * factor(item.unit, unit) : line.quantity) * 10000) / 10000) }; }),
      subLines: (summary?.subLines ?? []).map((line) => ({ key: ++lineKey, subId: line.subId, quantity: numberInputValue(line.quantity) })),
      margin: numberInputValue(summary?.margin ?? 60),
      price: moneyInputValue(product.price),
    });
  }

  const draftCost = draft ? draft.lines.reduce((sum, line) => {
    const item = line.itemId ? itemById.get(line.itemId) : undefined;
    const quantity = inItemUnit(line, item);
    return item && quantity > 0 ? sum + item.unitCost * quantity : sum;
  }, 0) + (draft ? draft.subLines.reduce((sum, line) => { const sub = line.subId ? subById.get(line.subId) : undefined; return sub ? sum + sub.unitCost * (parseMoney(line.quantity) || 0) : sum; }, 0) : 0) : 0;
  const draftMargin = draft ? parseMoney(draft.margin) : Number.NaN;
  const draftSuggested = suggest(draftCost, draftMargin);
  const draftPrice = draft ? parseMoney(draft.price) : Number.NaN;

  function updateLine(key: number, change: Partial<LineDraft>) {
    if (!draft) return;
    setDraft({ ...draft, lines: draft.lines.map((line) => (line.key === key ? { ...line, ...change } : line)) });
  }

  async function save() {
    if (!draft) return;
    const lines = draft.lines.filter((line) => line.itemId !== null || line.quantity.trim());
    const parsed = lines.map((line) => ({ itemId: line.itemId, quantity: Math.round(inItemUnit(line, line.itemId ? itemById.get(line.itemId) : undefined) * 10000) / 10000 }));
    if (parsed.some((line) => line.itemId === null || !(line.quantity > 0))) {
      setError('Cada línea necesita un artículo y una cantidad mayor a cero.');
      return;
    }
    if (new Set(parsed.map((line) => line.itemId)).size !== parsed.length) {
      setError('Hay un artículo repetido en la receta.');
      return;
    }
    const subLines = draft.subLines.filter((line) => line.subId !== null || line.quantity.trim());
    const parsedSubs = subLines.map((line) => ({ subId: line.subId, quantity: parseMoney(line.quantity) }));
    if (parsedSubs.some((line) => line.subId === null || !(line.quantity > 0))) {
      setError('Cada subreceta necesita una cantidad mayor a cero.');
      return;
    }
    if (new Set(parsedSubs.map((line) => line.subId)).size !== parsedSubs.length) {
      setError('Hay una subreceta repetida en la receta.');
      return;
    }
    if (!(draftPrice >= 0)) {
      setError('El precio de venta no es válido.');
      return;
    }
    const margin = draft.margin.trim() ? draftMargin : null;
    if (margin !== null && !(margin >= 0)) {
      setError('El % de ganancia no es válido.');
      return;
    }
    setSaving(true);
    const recipe = await adminRequest<RecipeSummary>(`/api/products/${draft.product.id}/recipe`, 'PUT', { lines: parsed, subLines: parsedSubs, margin }, pin);
    if (!recipe.ok) {
      setSaving(false);
      setError(recipe.message);
      return;
    }
    const price = Math.round(draftPrice * 100) / 100;
    if (price !== draft.product.price) {
      const { id, name, category, symbol, tone, active } = draft.product;
      const saved = await saveProduct({ id, name, category, price, symbol, tone, active }, pin);
      if (!saved.ok) {
        setSaving(false);
        setError(`La receta se guardó, pero el precio no: ${saved.message}`);
        return;
      }
      onProductSaved(saved.value);
    }
    setSaving(false);
    setDraft(null);
    onToast('Receta guardada');
    void reload();
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSaving(true);
    const result = await deleteProduct(toDelete.id, pin);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onProductDeleted(toDelete.id);
    onToast(`"${toDelete.name}" se eliminó de la carta`);
    setToDelete(null);
    void reload();
  }

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> COSTOS DE LA CARTA</p><h1>Recetas y costos</h1><p className="heading-sub">Arma cada ítem de la carta con productos e insumos. El costo se suma solo y te sugiere el precio con tu % de ganancia. Al vender, se descuenta del inventario.</p></div></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>ÍTEM DE LA CARTA</th><th>RECETA</th><th className="align-right">COSTO</th><th className="align-right">PRECIO</th><th className="align-right">GANANCIA</th><th /></tr></thead><tbody>
        {menu.map((product) => {
          const summary = costByProduct.get(product.id);
          const partCount = (summary?.lines.length ?? 0) + (summary?.subLines?.length ?? 0);
          const hasRecipe = partCount > 0;
          const profit = hasRecipe && summary ? product.price - summary.cost : null;
          return <tr key={product.id} className={product.active ? '' : 'is-hidden'} onClick={() => edit(product)}>
            <td><strong>{product.name}</strong></td>
            <td>{hasRecipe ? `${partCount} ${partCount === 1 ? 'artículo' : 'artículos'}${summary!.subLines?.length ? ` (${summary!.subLines.length} subreceta${summary!.subLines.length === 1 ? '' : 's'})` : ''}` : <span className="sync-label">Sin receta</span>}</td>
            <td className="align-right">{hasRecipe ? currency.format(summary!.cost) : '—'}</td>
            <td className="align-right"><strong>{currency.format(product.price)}</strong></td>
            <td className={`align-right ${profit !== null && profit < 0 ? 'negative' : ''}`}>{profit !== null ? <>{currency.format(profit)}{summary!.cost > 0 && <small> · {Math.round((profit / summary!.cost) * 100)}%</small>}</> : '—'}</td>
            <td className="align-right row-actions"><button className="icon-button" onClick={(event) => { event.stopPropagation(); edit(product); }} aria-label={`Editar receta de ${product.name}`} title="Editar receta"><Pencil size={15} /></button> <button className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); setError(''); setToDelete(product); }} aria-label={`Eliminar ${product.name}`} title="Eliminar de la carta"><Trash2 size={15} /></button></td>
          </tr>;
        })}
      </tbody></table></div>

      <SubRecipes pin={pin} subs={subs} items={stockItems} onChanged={() => { void reloadSubs(); void reload(); }} onToast={onToast} />

      {toDelete && <ConfirmDelete title={`¿Eliminar "${toDelete.name}"?`} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void confirmDelete()}
        message="Desaparece de la carta, del punto de venta y de esta lista en todos los dispositivos. Las ventas que ya tuvo se conservan en los reportes. Si solo se agotó, mejor ocúltalo desde Carta." />}

      {draft && <Modal title={draft.product.name} eyebrow="RECETA Y PRECIO" icon={<Calculator size={19} />} onClose={() => setDraft(null)} wide>
        <p className="modal-copy">Lo que lleva <strong>una unidad</strong> de este ítem. Las cantidades van en la unidad de cada artículo.</p>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {selectableItems.length === 0 && <p className="form-error">Primero carga productos e insumos en Inventario.</p>}
          <div className="recipe-lines">
            {draft.lines.map((line) => {
              const item = line.itemId ? itemById.get(line.itemId) : undefined;
              const quantity = inItemUnit(line, item);
              return <div className="recipe-line" key={line.key}>
                <select className="text-input" aria-label="Artículo" value={line.itemId ?? ''} onChange={(event) => updateLine(line.key, { itemId: event.target.value ? Number(event.target.value) : null, unit: '' })}>
                  <option value="">Elegir artículo…</option>
                  <optgroup label="Productos">{selectableItems.filter((option) => option.kind === 'PRODUCTO').map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</optgroup>
                  <optgroup label="Insumos">{selectableItems.filter((option) => option.kind === 'INSUMO').map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</optgroup>
                </select>
                <div className="money-input recipe-quantity"><input aria-label="Cantidad" type="text" inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} placeholder="0" />{item && UNIT_FAMILY[item.unit] ? <select aria-label="Unidad" className="unit-select" value={lineUnit(line, item)} onChange={(event) => updateLine(line.key, { unit: event.target.value })}>{[...UNIT_FAMILY[item.unit]].reverse().map((u) => <option key={u} value={u}>{u}</option>)}</select> : <span>{item?.unit ?? ''}</span>}</div>
                <span className="recipe-line-cost">{item && quantity > 0 ? currency.format(item.unitCost * quantity) : '—'}</span>
                <button type="button" className="icon-button" onClick={() => setDraft({ ...draft, lines: draft.lines.filter((other) => other.key !== line.key) })} aria-label="Quitar artículo"><Trash2 size={15} /></button>
              </div>;
            })}
          </div>
          {draft.subLines.length > 0 && <span className="field-label">Subrecetas</span>}
          <div className="recipe-lines">
            {draft.subLines.map((line) => {
              const sub = line.subId ? subById.get(line.subId) : undefined;
              const quantity = parseMoney(line.quantity) || 0;
              return <div className="recipe-line" key={line.key}>
                <select className="text-input" aria-label="Subreceta" value={line.subId ?? ''} onChange={(event) => setDraft({ ...draft, subLines: draft.subLines.map((other) => (other.key === line.key ? { ...other, subId: event.target.value ? Number(event.target.value) : null } : other)) })}>
                  <option value="">Elegir subreceta…</option>
                  {subs.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
                <div className="money-input recipe-quantity"><input aria-label="Cantidad de subreceta" type="text" inputMode="decimal" autoComplete="off" value={line.quantity} onChange={(event) => setDraft({ ...draft, subLines: draft.subLines.map((other) => (other.key === line.key ? { ...other, quantity: event.target.value } : other)) })} placeholder="0" /><span>{sub?.yieldUnit ?? ''}</span></div>
                <span className="recipe-line-cost">{sub && quantity > 0 ? currency.format(sub.unitCost * quantity) : '—'}</span>
                <button type="button" className="icon-button" onClick={() => setDraft({ ...draft, subLines: draft.subLines.filter((other) => other.key !== line.key) })} aria-label="Quitar subreceta"><Trash2 size={15} /></button>
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button add-line" onClick={() => setDraft({ ...draft, lines: [...draft.lines, { key: ++lineKey, itemId: null, quantity: '', unit: '' }] })}><Plus size={14} /> Agregar artículo</button>
          <button type="button" className="secondary-button add-line" disabled={subs.length === 0} title={subs.length === 0 ? 'Primero crea una subreceta' : ''} onClick={() => setDraft({ ...draft, subLines: [...draft.subLines, { key: ++lineKey, subId: null, quantity: '' }] })}><Plus size={14} /> Agregar subreceta</button>

          <div className="checkout-breakdown recipe-summary"><div><span>Costo total</span><strong>{currency.format(draftCost)}</strong></div></div>
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="recipe-margin">Ganancia <span>% sobre el costo</span></label><div className="money-input"><input id="recipe-margin" type="text" inputMode="decimal" autoComplete="off" value={draft.margin} onChange={(event) => setDraft({ ...draft, margin: event.target.value })} placeholder="60" /><span>%</span></div></div>
            <div><label className="field-label" htmlFor="recipe-price">Precio de venta</label><div className="money-input"><span>R$</span><input id="recipe-price" type="text" inputMode="decimal" autoComplete="off" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="0,00" /></div></div>
          </div>
          {draftSuggested !== null && <div className="suggested-price"><span>Precio sugerido <small>(redondeado a $10)</small></span><strong>{currency.format(draftSuggested)}</strong><button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, price: moneyInputValue(draftSuggested) })}>Usar este precio</button></div>}
          {draftCost > 0 && draftPrice >= 0 && <div className={`change-row ${draftPrice - draftCost < 0 ? 'negative' : 'balanced'}`}><span>Ganancia con el precio elegido</span><strong>{currency.format(draftPrice - draftCost)} · {Math.round(((draftPrice - draftCost) / draftCost) * 100)}%</strong></div>}
          {(draft.lines.length > 0 || draft.subLines.length > 0) && <p className="modal-copy form-hint">Cada venta descuenta: {draft.lines.filter((line) => line.itemId).map((line) => { const item = itemById.get(line.itemId!); const quantity = inItemUnit(line, item); return item && quantity > 0 ? `${UNIT_FAMILY[item.unit] ? `${line.quantity} ${lineUnit(line, item)}` : formatQuantity(quantity, item.unit)} de ${item.name}` : null; }).filter(Boolean).join(', ') || '—'}.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar receta y precio'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </section>
  );
}
