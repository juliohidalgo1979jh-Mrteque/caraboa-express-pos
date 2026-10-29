import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, MessageCircle, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { adminRequest } from '../db';
import { currency } from '../data';
import { whatsappNumber } from '../ReceiptShare';
import { ConfirmDelete, Modal, useAdminList } from './ui';

type Tab = 'orders' | 'promos' | 'texts' | 'settings';
type Status = 'NUEVO' | 'CONFIRMADO' | 'LISTO' | 'ENTREGADO' | 'CANCELADO';

interface OnlineOrder {
  id: number;
  code: string;
  name: string;
  phone: string;
  fulfillment: 'ENTREGA' | 'RETIRO';
  address: string;
  notes: string;
  lang: 'es' | 'pt' | 'en';
  subtotal: number;
  discount: number;
  promotion: string;
  total: number;
  status: Status;
  createdAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number; subtotal: number }>;
}

interface PromoRow {
  id: number;
  kind: 'INFO' | 'PERCENT' | 'PERCENT_FIRST';
  percent: number;
  minTotal: number;
  validUntil: string | null;
  active: boolean;
  titleEs: string;
  titlePt: string;
  titleEn: string;
  textEs: string;
  textPt: string;
  textEn: string;
}

type LangText = { name: string; description: string };
interface TextRow {
  productId: number;
  category: string;
  es: LangText;
  pt: LangText;
  en: LangText;
}

interface PortalSettings {
  name: string;
  whatsapp: string;
  enabled: boolean;
  infoEs: string;
  infoPt: string;
  infoEn: string;
}

const tabLabels: Record<Tab, string> = { orders: 'Pedidos online', promos: 'Promociones', texts: 'Traducciones', settings: 'Enlace y ajustes' };
const statusLabels: Record<Status, string> = { NUEVO: 'Nuevo', CONFIRMADO: 'Confirmado', LISTO: 'Listo', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado' };
const langNames = { es: 'Español', pt: 'Português', en: 'English' };
const kindLabels: Record<PromoRow['kind'], string> = {
  PERCENT_FIRST: '% en la primera compra del cliente',
  PERCENT: '% automático en todos los pedidos',
  INFO: 'Solo aviso (sin descuento)',
};

const timeFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export function portalUrl(): string {
  return `${window.location.origin}/pedir`;
}

export function PortalAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('orders');
  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> PEDIDOS DIRECTOS</p><h1>Portal de pedidos</h1><p className="heading-sub">Tus clientes piden desde un enlace (en español, portugués o inglés) y el pedido te llega por WhatsApp y a esta pantalla.</p></div></div>
      <div className="category-tabs admin-tabs" role="tablist" aria-label="Secciones del portal">
        {(Object.keys(tabLabels) as Tab[]).map((key) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'selected' : ''} onClick={() => setTab(key)}>{tabLabels[key]}</button>)}
      </div>
      {tab === 'orders' && <OrdersTab pin={pin} onToast={onToast} />}
      {tab === 'promos' && <PromosTab pin={pin} onToast={onToast} />}
      {tab === 'texts' && <TextsTab pin={pin} onToast={onToast} />}
      {tab === 'settings' && <SettingsTab pin={pin} onToast={onToast} />}
    </section>
  );
}

/* ---------------------------------- Pedidos ---------------------------------- */

const nextStep: Partial<Record<Status, { to: Status; label: string }>> = {
  NUEVO: { to: 'CONFIRMADO', label: 'Confirmar' },
  CONFIRMADO: { to: 'LISTO', label: 'Marcar listo' },
  LISTO: { to: 'ENTREGADO', label: 'Marcar entregado' },
};

function OrdersTab({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const { items: orders, error, loading, reload } = useAdminList<OnlineOrder>(`/api/portal/orders?scope=${scope}`, pin);

  // Los pedidos nuevos aparecen solos: se actualiza cada 20 segundos mientras se mira esta pestaña.
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 20_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function setStatus(order: OnlineOrder, status: Status) {
    const result = await adminRequest<OnlineOrder>(`/api/portal/orders/${order.id}`, 'PUT', { status }, pin);
    if (!result.ok) {
      onToast(result.message);
      return;
    }
    onToast(`${order.code}: ${statusLabels[status].toLowerCase()}`);
    void reload();
  }

  const newCount = orders.filter((order) => order.status === 'NUEVO').length;

  return (
    <>
      <div className="portal-toolbar">
        <div className="category-tabs" role="group" aria-label="Filtro de pedidos">
          <button className={scope === 'active' ? 'selected' : ''} onClick={() => setScope('active')}>En curso{scope === 'active' && newCount > 0 ? ` · ${newCount} nuevos` : ''}</button>
          <button className={scope === 'all' ? 'selected' : ''} onClick={() => setScope('all')}>Todos</button>
        </div>
        <button className="secondary-button" onClick={() => void reload()}>Actualizar</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && orders.length === 0 && <div className="history-empty"><span className="empty-bag"><Globe size={25} /></span><strong>Todavía no hay pedidos online</strong><span>Comparte el enlace del portal (pestaña “Enlace y ajustes”) en el perfil de WhatsApp y en Instagram.</span></div>}
      <div className="portal-orders">
        {orders.map((order) => {
          const step = nextStep[order.status];
          const waLink = `https://wa.me/${whatsappNumber(order.phone)}?text=${encodeURIComponent(`Hola ${order.name}, te escribimos por tu pedido ${order.code}.`)}`;
          return (
            <article key={order.id} className={`portal-order status-${order.status.toLowerCase()}`}>
              <header>
                <div><strong>{order.code}</strong><small>{timeFormat.format(new Date(order.createdAt))} · cliente en {langNames[order.lang]}</small></div>
                <span className={`order-status ${order.status.toLowerCase()}`}>{statusLabels[order.status]}</span>
              </header>
              <p className="order-who"><strong>{order.name}</strong> · <a href={waLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={12} /> {order.phone}</a></p>
              <p className="order-how">{order.fulfillment === 'ENTREGA' ? `Entrega a domicilio: ${order.address}` : 'Retira en el local'}</p>
              <ul>{order.items.map((item) => <li key={item.name}><span>{item.quantity} × {item.name}</span><span>{currency.format(item.subtotal)}</span></li>)}</ul>
              {order.notes && <p className="order-notes">Notas: {order.notes}</p>}
              <footer>
                <div className="order-total">
                  {order.discount > 0 && <small>Descuento {order.promotion}: −{currency.format(order.discount)}</small>}
                  <strong>{currency.format(order.total)}</strong>
                </div>
                <div className="order-actions">
                  {order.status !== 'CANCELADO' && order.status !== 'ENTREGADO' && <button className="secondary-button" onClick={() => void setStatus(order, 'CANCELADO')}>Cancelar</button>}
                  {step && <button className="modal-primary" onClick={() => void setStatus(order, step.to)}>{step.label}</button>}
                </div>
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* -------------------------------- Promociones -------------------------------- */

type PromoDraft = Omit<PromoRow, 'id' | 'percent' | 'minTotal'> & { id?: number; percent: string; minTotal: string };
const emptyPromo: PromoDraft = { kind: 'PERCENT_FIRST', percent: '10', minTotal: '', validUntil: null, active: true, titleEs: '', titlePt: '', titleEn: '', textEs: '', textPt: '', textEn: '' };

const toNumber = (value: string) => Number(value.replace(',', '.')) || 0;

function promoSummary(promo: PromoRow): string {
  const parts = [promo.kind === 'INFO' ? 'Solo aviso' : `${promo.percent}% ${promo.kind === 'PERCENT_FIRST' ? 'en la primera compra' : 'en todos los pedidos'}`];
  if (promo.minTotal > 0) parts.push(`mínimo ${currency.format(promo.minTotal)}`);
  if (promo.validUntil) parts.push(`hasta ${promo.validUntil.split('-').reverse().join('/')}`);
  return parts.join(' · ');
}

function PromosTab({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items: promos, error: loadError, reload } = useAdminList<PromoRow>('/api/portal/promotions', pin);
  const [draft, setDraft] = useState<PromoDraft | null>(null);
  const [toDelete, setToDelete] = useState<PromoRow | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function edit(promo?: PromoRow) {
    setError('');
    setDraft(promo ? { ...promo, percent: String(promo.percent).replace('.', ','), minTotal: promo.minTotal ? String(promo.minTotal).replace('.', ',') : '' } : { ...emptyPromo });
  }

  async function save() {
    if (!draft) return;
    if (!draft.titleEs.trim()) return setError('Escribe el título en español.');
    if (draft.kind !== 'INFO' && toNumber(draft.percent) <= 0) return setError('Indica el porcentaje de descuento.');
    setSaving(true);
    const { id, percent, minTotal, ...rest } = draft;
    const body = { ...rest, percent: draft.kind === 'INFO' ? 0 : toNumber(percent), minTotal: toNumber(minTotal), validUntil: draft.validUntil || null };
    const result = await adminRequest<PromoRow>(id ? `/api/portal/promotions/${id}` : '/api/portal/promotions', id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setDraft(null);
    onToast('Promoción guardada');
    void reload();
  }

  async function remove() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean }>(`/api/portal/promotions/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    onToast('Promoción eliminada');
    setToDelete(null);
    void reload();
  }

  const input = (key: keyof PromoDraft, label: string, props: Record<string, unknown> = {}) => draft && (
    <div><label className="field-label" htmlFor={`promo-${key}`}>{label}</label>
      <input id={`promo-${key}`} className="text-input" value={String(draft[key] ?? '')} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} {...props} /></div>
  );

  return (
    <>
      <div className="portal-toolbar"><p className="heading-sub">Los descuentos se aplican solos en el portal. Si hay varios, se usa el mejor (no se suman).</p><button className="modal-primary menu-new-button" onClick={() => edit()}><Plus size={16} /> Nueva promoción</button></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {promos.length === 0 ? <div className="history-empty"><span className="empty-bag"><Tag size={25} /></span><strong>Sin promociones</strong><span>Ejemplo: “10% en tu primera compra”. El portal verifica el teléfono del cliente para aplicarla una sola vez.</span></div> : (
        <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PROMOCIÓN</th><th>REGLA</th><th>ESTADO</th><th /></tr></thead><tbody>
          {promos.map((promo) => <tr key={promo.id} className={promo.active ? '' : 'is-hidden'} onClick={() => edit(promo)}>
            <td><strong>{promo.titleEs}</strong></td><td>{promoSummary(promo)}</td>
            <td><span className={`sync-label ${promo.active ? 'synced' : ''}`}>{promo.active ? 'Activa' : 'Apagada'}</span></td>
            <td className="align-right row-actions"><button className="icon-button" onClick={(event) => { event.stopPropagation(); edit(promo); }} aria-label={`Editar ${promo.titleEs}`}><Pencil size={15} /></button>{' '}
              <button className="icon-button danger-button" onClick={(event) => { event.stopPropagation(); setError(''); setToDelete(promo); }} aria-label={`Eliminar ${promo.titleEs}`}><Trash2 size={15} /></button></td>
          </tr>)}
        </tbody></table></div>
      )}

      {draft && (
        <Modal title={draft.id ? 'Editar promoción' : 'Nueva promoción'} eyebrow="PORTAL DE PEDIDOS" icon={<Tag size={19} />} onClose={() => setDraft(null)} wide>
          <label className="field-label" htmlFor="promo-kind">Tipo</label>
          <select id="promo-kind" className="text-input" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as PromoRow['kind'] })}>
            {(Object.keys(kindLabels) as PromoRow['kind'][]).map((kind) => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}
          </select>
          {draft.kind !== 'INFO' && (
            <div className="product-form-row">
              {input('percent', 'Descuento (%)', { inputMode: 'decimal', placeholder: '10' })}
              {input('minTotal', 'Pedido mínimo (R$) · opcional', { inputMode: 'decimal', placeholder: '0' })}
            </div>
          )}
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="promo-valid">Vence el · opcional</label>
              <input id="promo-valid" className="text-input" type="date" value={draft.validUntil ?? ''} onChange={(event) => setDraft({ ...draft, validUntil: event.target.value || null })} /></div>
            <div><label className="field-label" htmlFor="promo-active">Estado</label>
              <select id="promo-active" className="text-input" value={draft.active ? '1' : '0'} onChange={(event) => setDraft({ ...draft, active: event.target.value === '1' })}><option value="1">Activa</option><option value="0">Apagada</option></select></div>
          </div>
          {input('titleEs', 'Título en español', { maxLength: 80, placeholder: '10% en tu primera compra' })}
          {input('textEs', 'Texto en español · opcional', { maxLength: 200 })}
          <div className="product-form-row">{input('titlePt', 'Título en portugués', { maxLength: 80, placeholder: '10% na sua primeira compra' })}{input('titleEn', 'Título en inglés', { maxLength: 80, placeholder: '10% off your first order' })}</div>
          <div className="product-form-row">{input('textPt', 'Texto en portugués', { maxLength: 200 })}{input('textEn', 'Texto en inglés', { maxLength: 200 })}</div>
          <p className="heading-sub">Si dejas portugués o inglés vacío, el portal muestra el texto en español.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar promoción'}</button>
        </Modal>
      )}
      {toDelete && <ConfirmDelete title="Eliminar promoción" message={<>Se quitará “{toDelete.titleEs}” del portal.</>} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void remove()} />}
    </>
  );
}

/* ------------------------------- Traducciones -------------------------------- */

function TextsTab({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items, error, reload } = useAdminList<TextRow>('/api/portal/texts', pin);
  const [edits, setEdits] = useState<Record<number, TextRow>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [rowError, setRowError] = useState('');

  const current = (row: TextRow) => edits[row.productId] ?? row;
  const set = (row: TextRow, lang: 'es' | 'pt' | 'en', field: keyof LangText, value: string) =>
    setEdits((all) => ({ ...all, [row.productId]: { ...current(row), [lang]: { ...current(row)[lang], [field]: value } } }));

  async function save(row: TextRow) {
    const value = current(row);
    setSaving(row.productId);
    setRowError('');
    const result = await adminRequest<{ ok: boolean }>(`/api/portal/texts/${row.productId}`, 'PUT', { es: value.es, pt: value.pt, en: value.en }, pin);
    setSaving(null);
    if (!result.ok) return setRowError(result.message);
    onToast(`Textos de “${row.es.name}” guardados`);
    setEdits((all) => {
      const { [row.productId]: _removed, ...rest } = all;
      return rest;
    });
    void reload();
  }

  return (
    <>
      <p className="heading-sub portal-help">Lo que ve el cliente según su idioma. El nombre en español sale de la pestaña “Carta”. Si dejas un nombre vacío, se usa el español. La descripción (ingredientes, tamaño) es opcional.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {rowError && <p className="form-error" role="alert">{rowError}</p>}
      <div className="portal-texts">
        {items.map((row) => {
          const value = current(row);
          const dirty = Boolean(edits[row.productId]);
          return (
            <article key={row.productId} className="portal-text-card">
              <header><strong>{row.es.name}</strong><small>{row.category}</small></header>
              <label className="field-label">Descripción en español<input className="text-input" maxLength={300} value={value.es.description} onChange={(event) => set(row, 'es', 'description', event.target.value)} placeholder="Ej.: salsa de tomate, muzzarella y albahaca" /></label>
              <div className="product-form-row">
                <label className="field-label">Nombre en portugués<input className="text-input" maxLength={100} value={value.pt.name} onChange={(event) => set(row, 'pt', 'name', event.target.value)} /></label>
                <label className="field-label">Descripción en portugués<input className="text-input" maxLength={300} value={value.pt.description} onChange={(event) => set(row, 'pt', 'description', event.target.value)} /></label>
              </div>
              <div className="product-form-row">
                <label className="field-label">Nombre en inglés<input className="text-input" maxLength={100} value={value.en.name} onChange={(event) => set(row, 'en', 'name', event.target.value)} /></label>
                <label className="field-label">Descripción en inglés<input className="text-input" maxLength={300} value={value.en.description} onChange={(event) => set(row, 'en', 'description', event.target.value)} /></label>
              </div>
              <button className="secondary-button" onClick={() => void save(row)} disabled={!dirty || saving === row.productId}>{saving === row.productId ? 'Guardando…' : dirty ? 'Guardar cambios' : <><Check size={14} /> Guardado</>}</button>
            </article>
          );
        })}
      </div>
    </>
  );
}

/* ------------------------------ Enlace y ajustes ------------------------------ */

function SettingsTab({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [form, setForm] = useState<PortalSettings | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const url = portalUrl();

  const load = useCallback(async () => {
    const result = await adminRequest<PortalSettings>('/api/portal/settings', 'GET', undefined, pin);
    if (result.ok) setForm(result.value);
    else setError(result.message);
  }, [pin]);
  useEffect(() => {
    void load();
  }, [load]);

  const qrSvg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onToast('Enlace copiado');
    } catch {
      onToast('No se pudo copiar. Mantén presionado el enlace para copiarlo.');
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError('');
    const result = await adminRequest<PortalSettings>('/api/portal/settings', 'PUT', form, pin);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    setForm(result.value);
    onToast('Ajustes del portal guardados');
  }

  const field = (key: keyof PortalSettings, label: string, props: Record<string, unknown> = {}) => form && (
    <div><label className="field-label" htmlFor={`portal-${key}`}>{label}</label>
      <input id={`portal-${key}`} className="text-input" value={String(form[key] ?? '')} onChange={(event) => setForm({ ...form, [key]: event.target.value })} {...props} /></div>
  );

  return (
    <div className="portal-settings">
      <div className="heading-card portal-link-card">
        <div>
          <span className="field-label">Enlace del portal para tus clientes</span>
          <a className="portal-link" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
          <small>Pégalo en el perfil de WhatsApp Business, en la bio de Instagram y en tus estados. Se abre en el idioma del celular del cliente.</small>
          <div className="portal-link-actions">
            <button className="secondary-button" onClick={() => void copy()}><Copy size={14} /> Copiar enlace</button>
            <a className="secondary-button" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Abrir portal</a>
          </div>
        </div>
        <div className="ticket-qr"><div className="ticket-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} /><small>QR para imprimir en el local o en las cajas</small></div>
      </div>

      {form && (
        <div className="portal-form">
          {field('name', 'Nombre del negocio', { maxLength: 60 })}
          {field('whatsapp', 'WhatsApp del negocio (donde llegan los pedidos)', { inputMode: 'tel', placeholder: '5548988102993', maxLength: 30 })}
          <p className="heading-sub">Con código de país y área, sin signos. Brasil: 55 + área + número. Si lo dejas vacío, el pedido igual llega a la pestaña “Pedidos online”, pero el cliente no verá el botón de WhatsApp.</p>
          <label className="field-label" htmlFor="portal-enabled">Recepción de pedidos</label>
          <select id="portal-enabled" className="text-input" value={form.enabled ? '1' : '0'} onChange={(event) => setForm({ ...form, enabled: event.target.value === '1' })}>
            <option value="1">Abierto: el portal recibe pedidos</option>
            <option value="0">Cerrado: el portal muestra el menú pero no recibe pedidos</option>
          </select>
          {field('infoEs', 'Mensaje bajo el nombre (español)', { maxLength: 200, placeholder: 'Delivery y retiro · Florianópolis' })}
          {field('infoPt', 'Mensaje en portugués', { maxLength: 200 })}
          {field('infoEn', 'Mensaje en inglés', { maxLength: 200 })}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajustes'}</button>
        </div>
      )}
      {!form && error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
