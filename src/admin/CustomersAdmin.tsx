import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Gift, Heart, MessageCircle, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { currency, parseMoney, paymentLabels } from '../data';
import { adminRequest } from '../db';
import { whatsappNumber } from '../ReceiptShare';
import type { CustomerDetail, CustomerReward, CustomerRow, LoyaltyConfig, Product } from '../types';
import { ConfirmDelete, Modal } from './ui';

interface ListResponse { customers: CustomerRow[]; total: number; withReward: number }
const dateOnly = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: '2-digit' });
const dateTime = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function rewardText(reward: CustomerReward, lang: 'es' | 'pt' | 'en'): string {
  if (reward.kind === 'DESCUENTO') return { es: `${reward.percent}% de descuento en tu próximo pedido`, pt: `${reward.percent}% de desconto no próximo pedido`, en: `${reward.percent}% off your next order` }[lang];
  return { es: `un regalo: ${reward.giftName}`, pt: `um brinde: ${reward.giftName}`, en: `a free gift: ${reward.giftName}` }[lang];
}

/** Mensaje de premio para el cliente, en su idioma y sin emojis (algunos WhatsApp de escritorio los muestran rotos). */
function rewardMessage(customer: CustomerRow, reward: CustomerReward): string {
  const name = customer.name || '';
  const text = rewardText(reward, customer.lang);
  return {
    es: `Felicidades ${name}! Completaste ${customer.every} compras en Caraboa Express y ganaste ${text}. Tu código: *${reward.code}*. Preséntalo al hacer tu próximo pedido.`,
    pt: `Parabéns ${name}! Você completou ${customer.every} compras na Caraboa Express e ganhou ${text}. Seu código: *${reward.code}*. Apresente ao fazer seu próximo pedido.`,
    en: `Congratulations ${name}! You completed ${customer.every} purchases at Caraboa Express and won ${text}. Your code: *${reward.code}*. Show it on your next order.`,
  }[customer.lang];
}

export function CustomersAdmin({ pin, menu, onToast }: { pin: string; menu: Product[]; onToast: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ListResponse>({ customers: [], total: 0, withReward: 0 });
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [edit, setEdit] = useState({ name: '', preferences: '' });
  const [config, setConfig] = useState<LoyaltyConfig | null>(null);
  const [minText, setMinText] = useState('');
  const [adding, setAdding] = useState<{ name: string; phone: string; preferences: string } | null>(null);
  const [toDelete, setToDelete] = useState<CustomerDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    const result = await adminRequest<ListResponse>(`/api/customers?q=${encodeURIComponent(query.trim())}`, 'GET', undefined, pin);
    if (result.ok) { setData(result.value); setError(''); } else setError(result.message);
  }, [pin, query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function open(id: number) {
    setModalError('');
    const result = await adminRequest<CustomerDetail>(`/api/customers/${id}`, 'GET', undefined, pin);
    if (!result.ok) { onToast(result.message); return; }
    setDetail(result.value);
    setEdit({ name: result.value.name, preferences: result.value.preferences });
  }

  async function saveDetail() {
    if (!detail) return;
    setSaving(true);
    const result = await adminRequest<CustomerRow>(`/api/customers/${detail.id}`, 'PUT', edit, pin);
    setSaving(false);
    if (!result.ok) { setModalError(result.message); return; }
    onToast('Cliente guardado');
    setDetail(null);
    void load();
  }

  async function useReward(reward: CustomerReward) {
    const result = await adminRequest<CustomerReward>(`/api/loyalty/rewards/${reward.id}/use`, 'POST', undefined, pin);
    if (!result.ok) { onToast(result.message); return; }
    onToast('Premio marcado como usado');
    if (detail) void open(detail.id);
    void load();
  }

  async function openConfig() {
    setModalError('');
    const result = await adminRequest<LoyaltyConfig>('/api/loyalty/config', 'GET', undefined, pin);
    if (!result.ok) { onToast(result.message); return; }
    setConfig(result.value);
    setMinText(result.value.min ? String(result.value.min).replace('.', ',') : '');
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    const result = await adminRequest<LoyaltyConfig>('/api/loyalty/config', 'PUT', { ...config, min: parseMoney(minText) || 0 }, pin);
    setSaving(false);
    if (!result.ok) { setModalError(result.message); return; }
    setConfig(null);
    onToast(result.value.on ? 'Programa de fidelidad guardado' : 'Programa de fidelidad apagado');
    void load();
  }

  async function addCustomer() {
    if (!adding) return;
    setSaving(true);
    const result = await adminRequest<CustomerRow>('/api/customers', 'POST', adding, pin);
    setSaving(false);
    if (!result.ok) { setModalError(result.message); return; }
    setAdding(null);
    onToast('Cliente agregado');
    void load();
  }

  async function remove() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean }>(`/api/customers/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) { setModalError(result.message); return; }
    setToDelete(null); setDetail(null);
    onToast('Cliente eliminado');
    void load();
  }

  const link = (customer: CustomerRow, text: string) => `https://wa.me/${whatsappNumber(customer.phone)}?text=${encodeURIComponent(text)}`;

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> CLIENTES</p><h1>Clientes y fidelidad</h1><p className="heading-sub">Cada cliente se registra por su WhatsApp. Ves cuánto compra, qué le gusta y cuándo gana su premio.</p></div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={() => void openConfig()}><Settings2 size={16} /> Programa de fidelidad</button>
          <button className="modal-primary menu-new-button" onClick={() => { setModalError(''); setAdding({ name: '', phone: '', preferences: '' }); }}><Plus size={16} /> Nuevo cliente</button>
        </div></div>
      <div className="inventory-kpis">
        <div><small>CLIENTES</small><strong>{data.total}</strong></div>
        <div><small>CON PREMIO DISPONIBLE</small><strong>{data.withReward}</strong></div>
      </div>
      <div className="portal-toolbar"><label className="search-box"><Search size={15} /><input aria-label="Buscar cliente" placeholder="Buscar por nombre o WhatsApp" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data.customers.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>CLIENTE</th><th>WHATSAPP</th><th className="align-right">COMPRAS</th><th className="align-right">GASTADO</th><th>FIDELIDAD</th><th>ÚLTIMA COMPRA</th></tr></thead><tbody>
        {data.customers.map((customer) => <tr key={customer.id} onClick={() => void open(customer.id)} className="clickable-row">
          <td><strong>{customer.name || 'Sin nombre'}</strong>{customer.preferences && <><br /><small className="muted">{customer.preferences}</small></>}</td><td>{customer.phone}</td>
          <td className="align-right">{customer.orders}</td><td className="align-right">{currency.format(customer.totalSpent)}</td>
          <td>{customer.rewardsAvailable > 0 ? <span className="reward-badge"><Gift size={12} /> {customer.rewardsAvailable} premio{customer.rewardsAvailable > 1 ? 's' : ''}</span> : <span className="loyalty-bar" title={`${customer.progress} de ${customer.every}`}><i style={{ width: `${Math.min(100, (customer.progress / customer.every) * 100)}%` }} /><em>{customer.progress}/{customer.every}</em></span>}</td>
          <td>{customer.lastOrderAt ? dateOnly.format(new Date(customer.lastOrderAt)) : '—'}</td></tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Heart size={25} /></span><strong>Todavía no hay clientes</strong><span>Se agregan solos cuando alguien compra con su WhatsApp: desde el portal online o al cobrar en la caja.</span></div>}

      {detail && <Modal title={detail.name || 'Cliente'} eyebrow={`CLIENTE · ${detail.phone}`} icon={<Heart size={19} />} onClose={() => setDetail(null)} wide>
        <div className="customer-stats"><div><small>COMPRAS</small><strong>{detail.orders}</strong></div><div><small>GASTADO</small><strong>{currency.format(detail.totalSpent)}</strong></div><div><small>PRÓXIMO PREMIO</small><strong>{detail.loyaltyOn ? `${detail.progress}/${detail.every}` : 'Programa apagado'}</strong></div></div>
        <label className="field-label" htmlFor="cus-name">Nombre</label>
        <input id="cus-name" className="text-input" maxLength={80} value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} />
        <label className="field-label" htmlFor="cus-pref">Preferencias y notas <span>ej.: sin cebolla, pizza calabresa, alérgico a…</span></label>
        <textarea id="cus-pref" className="text-input" rows={3} maxLength={300} value={edit.preferences} onChange={(event) => setEdit({ ...edit, preferences: event.target.value })} />
        {detail.topProducts.length > 0 && <><span className="field-label">Lo que más pide</span><p className="top-products">{detail.topProducts.map((item) => <span key={item.name}>{item.quantity} × {item.name}</span>)}</p></>}
        {detail.rewards.length > 0 && <><span className="field-label">Premios</span><ul className="reward-list">{detail.rewards.map((reward) => (
          <li key={reward.id} className={reward.status === 'USADO' ? 'used' : ''}><div><strong>{reward.code}</strong><small>{rewardText(reward, 'es')} · {reward.status === 'USADO' ? `usado ${reward.usedAt ? dateOnly.format(new Date(reward.usedAt)) : ''}` : `ganado ${dateOnly.format(new Date(reward.createdAt))}`}</small></div>
            {reward.status === 'DISPONIBLE' && <div className="reward-actions"><a className="secondary-button" href={link(detail, rewardMessage(detail, reward))} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} /> Enviar por WhatsApp</a><button className="secondary-button" onClick={() => void useReward(reward)}>Marcar usado</button></div>}</li>))}</ul></>}
        {detail.recent.length > 0 && <><span className="field-label">Últimas compras</span><ul className="recent-list">{detail.recent.map((sale) => <li key={sale.id}><span>{dateTime.format(new Date(sale.createdAt))}{sale.orderCode ? ` · ${sale.orderCode}` : ''}</span><span>{paymentLabels[sale.paymentMethod as keyof typeof paymentLabels] ?? sale.paymentMethod}</span><strong>{currency.format(sale.total)}</strong></li>)}</ul></>}
        {modalError && <p className="form-error" role="alert">{modalError}</p>}
        <div className="customer-actions">
          <button className="secondary-button danger-outline" onClick={() => { setModalError(''); setToDelete(detail); }}><Trash2 size={14} /> Eliminar</button>
          <a className="secondary-button" href={`https://wa.me/${whatsappNumber(detail.phone)}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>
          <button className="modal-primary" onClick={() => void saveDetail()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'} <CheckCircle2 size={17} /></button>
        </div>
      </Modal>}

      {config && <Modal title="Programa de fidelidad" eyebrow="SOLO ADMINISTRADOR" icon={<Gift size={19} />} onClose={() => setConfig(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void saveConfig(); }}>
          <label className="delivery-toggle"><input type="checkbox" checked={config.on} onChange={(event) => setConfig({ ...config, on: event.target.checked })} /> Programa activo</label>
          <label className="field-label" htmlFor="loy-every">Premio cada cuántas compras</label>
          <input id="loy-every" className="text-input" type="number" min={2} max={50} value={config.every} onChange={(event) => setConfig({ ...config, every: Math.max(2, Number(event.target.value) || 2) })} />
          <span className="field-label">Tipo de premio</span>
          <div className="method-options" role="group" aria-label="Tipo de premio">
            <button type="button" className={config.kind === 'DESCUENTO' ? 'selected' : ''} aria-pressed={config.kind === 'DESCUENTO'} onClick={() => setConfig({ ...config, kind: 'DESCUENTO' })}>Cupón de descuento</button>
            <button type="button" className={config.kind === 'REGALO' ? 'selected' : ''} aria-pressed={config.kind === 'REGALO'} onClick={() => setConfig({ ...config, kind: 'REGALO' })}>Producto de regalo</button>
          </div>
          {config.kind === 'DESCUENTO'
            ? <><label className="field-label" htmlFor="loy-percent">Porcentaje de descuento</label><input id="loy-percent" className="text-input" type="number" min={1} max={100} value={config.percent} onChange={(event) => setConfig({ ...config, percent: Number(event.target.value) || 1 })} /></>
            : <><label className="field-label" htmlFor="loy-gift">Producto de regalo</label><select id="loy-gift" className="text-input" value={config.giftId ?? ''} onChange={(event) => { const product = menu.find((item) => item.id === Number(event.target.value)); setConfig({ ...config, giftId: product?.id ?? null, giftName: product?.name ?? '' }); }}><option value="">Elige un producto</option>{menu.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></>}
          <label className="field-label" htmlFor="loy-min">Compra mínima para que cuente <span>opcional</span></label>
          <div className="money-input"><span>R$</span><input id="loy-min" type="text" inputMode="decimal" autoComplete="off" value={minText} onChange={(event) => setMinText(event.target.value)} placeholder="0,00" /></div>
          <p className="muted">Cada compra con WhatsApp suma un punto. Al completar el ciclo, el cliente gana un premio con un código único.</p>
          {modalError && <p className="form-error" role="alert">{modalError}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar programa'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {adding && <Modal title="Nuevo cliente" eyebrow="CLIENTES" icon={<Heart size={19} />} onClose={() => setAdding(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void addCustomer(); }}>
          <label className="field-label" htmlFor="new-cus-phone">WhatsApp</label>
          <input id="new-cus-phone" className="text-input" type="tel" autoFocus placeholder="+55 48 98810-2993" value={adding.phone} onChange={(event) => setAdding({ ...adding, phone: event.target.value })} />
          <label className="field-label" htmlFor="new-cus-name">Nombre</label>
          <input id="new-cus-name" className="text-input" maxLength={80} value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} />
          <label className="field-label" htmlFor="new-cus-pref">Preferencias <span>opcional</span></label>
          <input id="new-cus-pref" className="text-input" maxLength={300} value={adding.preferences} onChange={(event) => setAdding({ ...adding, preferences: event.target.value })} />
          {modalError && <p className="form-error" role="alert">{modalError}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Agregar cliente'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
      {toDelete && <ConfirmDelete title="Eliminar cliente" message={<>¿Eliminar a <strong>{toDelete.name || toDelete.phone}</strong> con sus premios? Sus ventas se conservan en los reportes.</>} error={modalError} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void remove()} />}
    </section>
  );
}
