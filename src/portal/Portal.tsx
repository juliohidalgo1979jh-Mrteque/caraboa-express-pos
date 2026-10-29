import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MapPin, Minus, Plus, ShoppingBag, Store, Tag, X } from 'lucide-react';
import { LANGS, LANG_NAMES, categoryLabel, detectLang, formatDate, formatMoney, strings, type Lang } from './i18n';

type Names = Record<Lang, string>;

interface PortalProduct {
  id: number;
  category: string;
  price: number;
  symbol: string;
  tone: string;
  image: string | null;
  name: Names;
  description: Names;
}

interface PortalPromo {
  id: number;
  kind: 'INFO' | 'PERCENT' | 'PERCENT_FIRST';
  percent: number;
  minTotal: number;
  validUntil: string | null;
  title: Names;
  text: Names;
}

interface PortalData {
  name: string;
  enabled: boolean;
  whatsapp: string;
  info: Names;
  products: PortalProduct[];
  promotions: PortalPromo[];
}

interface Quote {
  subtotal: number;
  discount: number;
  promotion: PortalPromo | null;
  total: number;
  firstOrder: boolean | null;
}

interface PlacedOrder {
  code: string;
  name: string;
  phone: string;
  fulfillment: 'ENTREGA' | 'RETIRO';
  address: string;
  notes: string;
  subtotal: number;
  discount: number;
  promotion: string;
  promotionTitles: Names | null;
  total: number;
  items: Array<{ name: string; quantity: number; unitPrice: number; subtotal: number }>;
}

type Fulfillment = 'RETIRO' | 'ENTREGA';

const digits = (value: string) => value.replace(/\D/g, '');

function readSaved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** El mensaje es para el negocio, por eso va siempre en español, con el idioma del cliente al final. */
function whatsappText(order: PlacedOrder, businessName: string, lang: Lang): string {
  const money = (value: number) => formatMoney(value, 'es');
  const lines = [
    `🍕 *Pedido ${order.code}* · ${businessName}`,
    `Cliente: ${order.name}`,
    `WhatsApp: ${order.phone.length >= 12 ? '+' : ''}${order.phone}`,
    order.fulfillment === 'ENTREGA' ? `Entrega a domicilio: ${order.address}` : 'Retira en el local',
    '',
    ...order.items.map((item) => `• ${item.quantity} × ${item.name} — ${money(item.subtotal)}`),
    '',
  ];
  if (order.discount > 0) lines.push(`Descuento (${order.promotion}): -${money(order.discount)}`);
  lines.push(`*Total: ${money(order.total)}*`);
  if (order.notes) lines.push(`Notas: ${order.notes}`);
  lines.push(`Idioma del cliente: ${LANG_NAMES[lang]}`);
  return lines.join('\n');
}

export default function Portal() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = strings[lang];
  const [data, setData] = useState<PortalData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState(() => readSaved('portal-name'));
  const [phone, setPhone] = useState(() => readSaved('portal-phone'));
  const [fulfillment, setFulfillment] = useState<Fulfillment>('RETIRO');
  const [address, setAddress] = useState(() => readSaved('portal-address'));
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const quoteSeq = useRef(0);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/portal');
      if (!response.ok) throw new Error('bad status');
      setData(await response.json());
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.documentElement.lang = lang;
    save('portal-lang', lang);
  }, [lang]);

  const products = data?.products ?? [];
  const categories = useMemo(() => [...new Set(products.map((product) => product.category))], [products]);
  const visible = category ? products.filter((product) => product.category === category) : products;
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const cartLines = Object.entries(cart)
    .map(([id, quantity]) => ({ product: byId.get(Number(id)), quantity }))
    .filter((line): line is { product: PortalProduct; quantity: number } => Boolean(line.product) && line.quantity > 0);
  const itemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const localSubtotal = cartLines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  // El servidor calcula descuentos y total; aquí solo se muestra lo que devuelve.
  const cartKey = cartLines.map((line) => `${line.product.id}:${line.quantity}`).join(',');
  const phoneDigits = digits(phone);
  useEffect(() => {
    if (!cartKey) {
      setQuote(null);
      return;
    }
    const seq = ++quoteSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/portal/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phoneDigits.length >= 8 ? phoneDigits : '', items: cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })) }),
        });
        if (response.ok && seq === quoteSeq.current) setQuote(await response.json());
      } catch {
        /* sin conexión: se muestra el subtotal local */
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, phoneDigits]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [sheetOpen]);

  const change = (productId: number, delta: number) =>
    setCart((current) => {
      const next = Math.max(0, Math.min(50, (current[productId] ?? 0) + delta));
      const copy = { ...current };
      if (next === 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });

  const subtotal = quote?.subtotal ?? localSubtotal;
  const discount = quote?.discount ?? 0;
  const total = quote?.total ?? localSubtotal;
  const firstOrderPromo = data?.promotions.find((promo) => promo.kind === 'PERCENT_FIRST');
  const open = data?.enabled ?? true;

  async function submit() {
    if (!data) return;
    if (!name.trim()) return setError(t.errName);
    if (phoneDigits.length < 8) return setError(t.errPhone);
    if (fulfillment === 'ENTREGA' && address.trim().length < 5) return setError(t.errAddress);
    setError('');
    setSending(true);
    try {
      const response = await fetch('/api/portal/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: phoneDigits, fulfillment, address: address.trim(), notes: notes.trim(), lang,
          items: cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      });
      if (response.status === 409) {
        setError(t.closedTitle);
        void load();
        return;
      }
      if (!response.ok) {
        setError(t.errGeneric);
        return;
      }
      setPlaced(await response.json());
      save('portal-name', name.trim());
      save('portal-phone', phoneDigits);
      if (fulfillment === 'ENTREGA') save('portal-address', address.trim());
      setCart({});
      setNotes('');
      setSheetOpen(false);
    } catch {
      setError(t.errGeneric);
    } finally {
      setSending(false);
    }
  }

  const money = (value: number) => formatMoney(value, lang);

  if (placed && data) {
    const link = data.whatsapp ? `https://wa.me/${data.whatsapp}?text=${encodeURIComponent(whatsappText(placed, data.name, lang))}` : '';
    return (
      <div className="portal">
        <Header name={data.name} lang={lang} onLang={setLang} languageLabel={t.language} />
        <main className="thanks">
          <CheckCircle2 size={56} className="thanks-icon" />
          <h2>{t.thanksTitle}</h2>
          <p className="thanks-code"><span>{t.thanksCode}</span><strong>{placed.code}</strong></p>
          <ul className="thanks-items">
            {placed.items.map((item) => <li key={item.name}><span>{item.quantity} × {item.name}</span><strong>{money(item.subtotal)}</strong></li>)}
          </ul>
          {placed.discount > 0 && <p className="thanks-discount">{t.discount} ({placed.promotionTitles?.[lang] ?? placed.promotion}): −{money(placed.discount)}</p>}
          <p className="thanks-total">{t.total} <strong>{money(placed.total)}</strong></p>
          <p className="thanks-note">{link ? t.thanksWhatsapp : t.thanksNoWhatsapp}</p>
          {link && <a className="btn-primary whatsapp" href={link} target="_blank" rel="noopener noreferrer">{t.sendWhatsapp}</a>}
          <button className="btn-ghost" onClick={() => setPlaced(null)}>{t.newOrder}</button>
        </main>
      </div>
    );
  }

  return (
    <div className="portal">
      <Header name={data?.name ?? 'Caraboa Express'} lang={lang} onLang={setLang} languageLabel={t.language} info={data?.info[lang]} />

      {!data && !loadFailed && <p className="state-message">{t.loading}</p>}
      {loadFailed && <div className="state-message"><p>{t.loadError}</p><button className="btn-ghost" onClick={() => void load()}>{t.retry}</button></div>}

      {data && (
        <main>
          {!open && (
            <div className="closed-banner" role="status"><Store size={20} /><div><strong>{t.closedTitle}</strong><span>{t.closedText}</span></div></div>
          )}

          {data.promotions.length > 0 && (
            <section className="promos" aria-label={t.promos}>
              {data.promotions.map((promo) => (
                <article key={promo.id} className={`promo ${promo.kind === 'INFO' ? 'promo-info' : ''}`}>
                  {promo.kind !== 'INFO' && <span className="promo-badge">−{Math.round(promo.percent)}%</span>}
                  <div>
                    <h2><Tag size={14} /> {promo.title[lang]}</h2>
                    {promo.text[lang] && <p>{promo.text[lang]}</p>}
                    <small>
                      {[
                        promo.kind === 'PERCENT_FIRST' ? t.firstOrderOnly : '',
                        promo.minTotal > 0 ? t.minTotal(money(promo.minTotal)) : '',
                        promo.validUntil ? t.validUntil(formatDate(promo.validUntil, lang)) : '',
                      ].filter(Boolean).join(' · ')}
                    </small>
                  </div>
                </article>
              ))}
            </section>
          )}

          {categories.length > 1 && (
            <nav className="chips" aria-label="Menu">
              <button className={category === '' ? 'on' : ''} onClick={() => setCategory('')}>{t.all}</button>
              {categories.map((item) => <button key={item} className={category === item ? 'on' : ''} onClick={() => setCategory(item)}>{categoryLabel(item, lang)}</button>)}
            </nav>
          )}

          {products.length === 0 && <p className="state-message">{t.noProducts}</p>}
          <ul className="menu">
            {visible.map((product) => {
              const quantity = cart[product.id] ?? 0;
              return (
                <li key={product.id} className="dish">
                  <div className={`dish-art ${product.tone}`}>
                    {product.image ? <img src={product.image} alt="" loading="lazy" /> : <span aria-hidden="true">{product.symbol}</span>}
                  </div>
                  <div className="dish-body">
                    <h3>{product.name[lang]}</h3>
                    {product.description[lang] && <p>{product.description[lang]}</p>}
                    <strong className="dish-price">{money(product.price)}</strong>
                  </div>
                  <div className="dish-action">
                    {quantity > 0 ? (
                      <div className="stepper">
                        <button onClick={() => change(product.id, -1)} aria-label={`${t.remove}: ${product.name[lang]}`}><Minus size={16} /></button>
                        <output>{quantity}</output>
                        <button onClick={() => change(product.id, 1)} aria-label={`${t.add}: ${product.name[lang]}`}><Plus size={16} /></button>
                      </div>
                    ) : (
                      <button className="add" onClick={() => change(product.id, 1)} disabled={!open} aria-label={`${t.add}: ${product.name[lang]}`}><Plus size={18} /></button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="foot">{t.poweredBy}</p>
        </main>
      )}

      {itemCount > 0 && !sheetOpen && (
        <button className="cart-bar" onClick={() => setSheetOpen(true)}>
          <span className="cart-bar-count"><ShoppingBag size={18} /> {itemCount}</span>
          <span className="cart-bar-label">{t.viewOrder}</span>
          <strong>{money(total)}</strong>
        </button>
      )}

      {sheetOpen && data && (
        <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheetOpen(false); }}>
          <section className="sheet" role="dialog" aria-modal="true" aria-label={t.yourOrder}>
            <header className="sheet-head"><h2>{t.yourOrder}</h2><button className="icon-btn" onClick={() => setSheetOpen(false)} aria-label={t.close}><X size={20} /></button></header>

            {cartLines.length === 0 ? <p className="state-message">{t.emptyCart}</p> : (
              <>
                <ul className="lines">
                  {cartLines.map(({ product, quantity }) => (
                    <li key={product.id}>
                      <div><strong>{product.name[lang]}</strong><span>{money(product.price)}</span></div>
                      <div className="stepper small">
                        <button onClick={() => change(product.id, -1)} aria-label={`${t.remove}: ${product.name[lang]}`}><Minus size={14} /></button>
                        <output>{quantity}</output>
                        <button onClick={() => change(product.id, 1)} aria-label={`${t.add}: ${product.name[lang]}`}><Plus size={14} /></button>
                      </div>
                    </li>
                  ))}
                </ul>

                {firstOrderPromo && phoneDigits.length < 8 && <p className="hint promo-hint"><Tag size={14} /> {t.firstOrderHint}</p>}

                <dl className="totals">
                  <div><dt>{t.subtotal}</dt><dd>{money(subtotal)}</dd></div>
                  {discount > 0 && quote?.promotion && <div className="discount"><dt>{t.discount} · {quote.promotion.title[lang]}</dt><dd>−{money(discount)}</dd></div>}
                  <div className="grand"><dt>{t.total}</dt><dd>{money(total)}</dd></div>
                </dl>

                <div className="form">
                  <label>{t.name}<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} /></label>
                  <label>{t.phone}<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder={t.phoneHint} maxLength={30} /></label>
                  <fieldset>
                    <legend>{t.howToReceive}</legend>
                    <div className="segmented">
                      <button type="button" className={fulfillment === 'RETIRO' ? 'on' : ''} onClick={() => setFulfillment('RETIRO')}><Store size={16} /> {t.pickup}</button>
                      <button type="button" className={fulfillment === 'ENTREGA' ? 'on' : ''} onClick={() => setFulfillment('ENTREGA')}><MapPin size={16} /> {t.delivery}</button>
                    </div>
                  </fieldset>
                  {fulfillment === 'ENTREGA' && <label>{t.address}<input value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" maxLength={200} /></label>}
                  <label>{t.notes}<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={300} placeholder={t.notesHint} /></label>
                </div>

                <p className="hint">{t.paymentNote}</p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="btn-primary" onClick={() => void submit()} disabled={sending || !open}>{sending ? t.sending : `${t.send} · ${money(total)}`}</button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Header({ name, lang, onLang, languageLabel, info }: { name: string; lang: Lang; onLang: (lang: Lang) => void; languageLabel: string; info?: string }) {
  return (
    <header className="top">
      <div className="top-row">
        <img className="top-logo" src="/logo.png" alt="" width="52" height="52" />
        <div className="top-title"><h1>{name}</h1>{info && <p>{info}</p>}</div>
        <div className="lang" role="group" aria-label={languageLabel}>
          {LANGS.map((code) => <button key={code} className={lang === code ? 'on' : ''} onClick={() => onLang(code)} aria-pressed={lang === code} lang={code} title={LANG_NAMES[code]}>{code.toUpperCase()}</button>)}
        </div>
      </div>
    </header>
  );
}
