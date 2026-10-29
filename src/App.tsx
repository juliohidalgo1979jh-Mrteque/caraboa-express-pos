import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  Check,
  ChefHat,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Cloud,
  Globe,
  Handshake,
  CloudOff,
  Coffee,
  CreditCard,
  History,
  Landmark,
  Lock,
  Minus,
  MonitorSmartphone,
  Package,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Search,
  ShoppingBag,
  Smartphone,
  Trash2,
  
  Wallet,
  Wrench,
  X,
} from 'lucide-react';
import { AdminGate } from './admin/AdminGate';
import { EquipmentAdmin } from './admin/EquipmentAdmin';
import { InventoryAdmin } from './admin/InventoryAdmin';
import { PointsAdmin } from './admin/PointsAdmin';
import { RecipesAdmin } from './admin/RecipesAdmin';
import { ReportsAdmin } from './admin/ReportsAdmin';
import { PortalAdmin } from './admin/PortalAdmin';
import { SuppliersAdmin } from './admin/SuppliersAdmin';
import { KitchenScreen } from './KitchenScreen';
import { ReceiptShare } from './ReceiptShare';
import { useKitchenStation } from './kitchen';
import { printHtml, receiptHtml } from './print';
import { currency, formatOrderCode, moneyInputValue, parseMoney, paymentLabels, paymentMethods, products as defaultMenu, symbols, todayInArgentina, tones } from './data';
import { db, deleteProduct, nextOrderNumber, readCachedHeading, readCachedOrderNumbers, readCachedPoints, readDevicePoint, refreshHeading, refreshMenu, refreshOrderNumbers, refreshPoints, resizeImage, saveHeading, saveProduct, setProductImage, storeDevicePoint, syncQueue } from './db';
import type { CartItem, LocalSale, LocalShift, PaymentMethod, PointOfSale, PosHeading, Product } from './types';

type Screen = 'pos' | 'history' | 'menu' | 'kitchen' | 'reports' | 'inventory' | 'recipes' | 'suppliers' | 'equipment' | 'points' | 'portal';
type Dialog = 'open' | 'close' | 'checkout' | 'receipt' | 'product' | 'heading' | 'point' | null;

interface ProductDraft {
  id?: number;
  name: string;
  category: string;
  price: string;
  symbol: string;
  tone: string;
  active: boolean;
  image: string | null;
  imageChanged: boolean;
}

const screenTitles: Record<Screen, string> = {
  pos: 'Punto de venta',
  history: 'Ventas',
  menu: 'Carta',
  kitchen: 'Comandas',
  reports: 'Reportes',
  inventory: 'Inventario',
  recipes: 'Recetas y costos',
  suppliers: 'Proveedores',
  equipment: 'Equipos',
  points: 'Puntos de venta',
  portal: 'Portal de pedidos',
};

const adminScreens: Array<{ screen: Screen; icon: typeof Package }> = [
  { screen: 'reports', icon: BarChart3 },
  { screen: 'inventory', icon: Package },
  { screen: 'recipes', icon: Calculator },
  { screen: 'suppliers', icon: Handshake },
  { screen: 'equipment', icon: Wrench },
  { screen: 'points', icon: MonitorSmartphone },
  { screen: 'portal', icon: Globe },
];

const paymentIcons: Record<PaymentMethod, typeof CreditCard> = {
  EFECTIVO: CircleDollarSign,
  TARJETA: CreditCard,
  QR: QrCode,
  TRANSFERENCIA: Landmark,
  MERCADO_PAGO: Smartphone,
};
const PIN_STORAGE_KEY = 'tequenos-club-admin-pin';

function readStoredPin(): string {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storePin(pin: string) {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    // Sin almacenamiento disponible: el PIN se pedirá de nuevo la próxima vez.
  }
}

function makeId(): string {
  return crypto.randomUUID();
}

function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>('pos');
  const [activeDialog, setActiveDialog] = useState<Dialog>(null);
  const [activeShift, setActiveShift] = useState<LocalShift | null>(null);
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('EFECTIVO');
  const [cashReceived, setCashReceived] = useState('');
  const [tipRate, setTipRate] = useState<number | 'custom' | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [lastSale, setLastSale] = useState<LocalSale | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState<Product[]>([]);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [adminPin, setAdminPin] = useState(readStoredPin);
  const [pinRequired, setPinRequired] = useState(false);
  const [productError, setProductError] = useState('');
  const [savingProduct, setSavingProduct] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [heading, setHeading] = useState<PosHeading>(readCachedHeading);
  const [points, setPoints] = useState<PointOfSale[]>(readCachedPoints);
  const [devicePoint, setDevicePoint] = useState<PointOfSale | null>(readDevicePoint);
  const [adminVerified, setAdminVerified] = useState(false);
  const allowedMethods = devicePoint?.methods.length ? devicePoint.methods : paymentMethods;
  const [serverOrderNumbers, setServerOrderNumbers] = useState(readCachedOrderNumbers);
  const kitchen = useKitchenStation(isOnline, (comandas) => setToast(`Comanda impresa: ${comandas.map((comanda) => comanda.orderCode).join(', ')}`));
  const orderDay = todayInArgentina();
  const nextOrderCode = formatOrderCode(devicePoint?.code, nextOrderNumber(sales, devicePoint?.id ?? null, orderDay, serverOrderNumbers));
  const [headingDraft, setHeadingDraft] = useState<PosHeading>(heading);

  const activeProducts = useMemo(() => menu.filter((product) => product.active), [menu]);
  const categories = useMemo(() => ['Todos', ...new Set(activeProducts.map((product) => product.category))], [activeProducts]);
  const allCategories = useMemo(() => [...new Set(menu.map((product) => product.category))], [menu]);

  const cartTotal = useMemo(
    () => cart.reduce((total, item) => total + item.product.price * item.quantity, 0),
    [cart],
  );
  const todaySales = useMemo(
    () => sales.filter((sale) => sale.shiftId === activeShift?.id),
    [activeShift, sales],
  );
  const cashSales = todaySales
    .filter((sale) => sale.paymentMethod === 'EFECTIVO')
    .reduce((total, sale) => total + sale.total, 0);
  const expectedCash = (activeShift?.openingCash ?? 0) + cashSales;
  const tipAmount = tipRate === null ? 0 : tipRate === 'custom' ? (parseMoney(customTip) || 0) : Math.round(cartTotal * tipRate) / 100;
  const amountDue = Math.round((cartTotal + tipAmount) * 100) / 100;
  const filteredProducts = activeProducts.filter((product) => {
    const matchesCategory = category === 'Todos' || product.category === category;
    const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });
  const changeDue = Math.max(0, (parseMoney(cashReceived) || 0) - amountDue);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if ((await db.products.count()) === 0) await db.products.bulkPut(defaultMenu);
      // Las cartas guardadas por versiones anteriores no tenían el campo "active".
      const savedMenu = (await db.products.toArray()).map((product) => ({ ...product, active: product.active ?? true }));
      if (mounted) setMenu(savedMenu);
      const shift = await db.shifts.orderBy('openedAt').reverse().first();
      if (!mounted) return;
      if (shift && !shift.closedAt) setActiveShift(shift);
      else setActiveDialog(readDevicePoint() ? 'open' : 'point');
      setSales(await db.sales.orderBy('createdAt').reverse().toArray());
      setPendingCount(await db.queue.count());
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    const sync = async () => {
      const result = await syncQueue();
      setIsOnline(result.connected);
      setPendingCount(result.pending);
      setSales(await db.sales.orderBy('createdAt').reverse().toArray());
      if (result.connected) {
        const [latestMenu, latestHeading, latestPoints, latestNumbers] = await Promise.all([refreshMenu(), refreshHeading(), refreshPoints(), refreshOrderNumbers(todayInArgentina())]);
        if (latestMenu) setMenu(latestMenu);
        if (latestHeading) setHeading(latestHeading);
        if (latestPoints) applyPoints(latestPoints);
        if (latestNumbers) setServerOrderNumbers(latestNumbers);
      }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 15000);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!categories.includes(category)) setCategory('Todos');
  }, [categories, category]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function applyPoints(latestPoints: PointOfSale[]) {
    setPoints(latestPoints);
    // Si cambiaron el nombre o los medios de pago del punto de este dispositivo, se actualizan acá.
    const current = readDevicePoint();
    const updated = current && latestPoints.find((point) => point.id === current.id);
    if (updated) {
      storeDevicePoint(updated);
      setDevicePoint(updated);
    }
  }

  function choosePoint(point: PointOfSale) {
    storeDevicePoint(point);
    setDevicePoint(point);
    setActiveDialog(activeShift ? null : 'open');
    setToast(`Este dispositivo es "${point.name}"`);
  }

  function savePoint(point: PointOfSale) {
    applyPoints(points.some((item) => item.id === point.id) ? points.map((item) => (item.id === point.id ? point : item)) : [...points, point]);
    void refreshPoints();
    setToast('Punto de venta guardado');
  }

  function addToCart(product: Product) {
    setCart((items) => {
      const existing = items.find((item) => item.product.id === product.id);
      if (existing) {
        return items.map((item) =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      return [...items, { product, quantity: 1 }];
    });
  }

  function adjustQuantity(productId: number, amount: number) {
    setCart((items) =>
      items
        .map((item) =>
          item.product.id === productId ? { ...item, quantity: item.quantity + amount } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  async function openShift() {
    const amount = parseMoney(openingCash);
    if (!Number.isFinite(amount) || amount < 0) return;
    const shift: LocalShift = {
      id: makeId(),
      openingCash: amount,
      openedAt: new Date().toISOString(),
      pointId: devicePoint?.id ?? null,
      pointName: devicePoint?.name,
      synced: false,
    };
    await db.transaction('rw', db.shifts, db.queue, async () => {
      await db.shifts.add(shift);
      await db.queue.add({ type: 'shift.open', clientId: shift.id, payload: { ...shift } });
    });
    setActiveShift(shift);
    setActiveDialog(null);
    setOpeningCash('');
    setToast('Turno abierto');
    const result = await syncQueue();
    setPendingCount(result.pending);
    setSales(await db.sales.orderBy('createdAt').reverse().toArray());
  }

  async function closeShift() {
    if (!activeShift) return;
    const amount = parseMoney(closingCash);
    if (!Number.isFinite(amount) || amount < 0) return;
    const closed: LocalShift = { ...activeShift, closedAt: new Date().toISOString(), closingCash: amount };
    await db.transaction('rw', db.shifts, db.queue, async () => {
      await db.shifts.put(closed);
      await db.queue.add({ type: 'shift.close', clientId: closed.id, payload: { ...closed } });
    });
    setActiveShift(null);
    setActiveDialog(null);
    setClosingCash('');
    setToast(`Turno cerrado · diferencia ${currency.format(amount - expectedCash)}`);
    const result = await syncQueue();
    setPendingCount(result.pending);
    setSales(await db.sales.orderBy('createdAt').reverse().toArray());
  }

  async function completeSale() {
    if (!activeShift || cart.length === 0) return;
    const received = paymentMethod === 'EFECTIVO' ? (parseMoney(cashReceived) || 0) : amountDue;
    if (paymentMethod === 'EFECTIVO' && received < amountDue) return;

    // Se calcula con las ventas guardadas (no con el estado en pantalla) para no repetir si se cobra muy rápido.
    const day = todayInArgentina();
    const pointId = devicePoint?.id ?? null;
    const orderNumber = nextOrderNumber(await db.sales.toArray(), pointId, day, readCachedOrderNumbers());
    const sale: LocalSale = {
      id: makeId(),
      shiftId: activeShift.id,
      createdAt: new Date().toISOString(),
      items: cart.map(({ product, quantity }) => ({
        productId: product.id,
        name: product.name,
        quantity,
        price: product.price,
        subtotal: product.price * quantity,
      })),
      subtotal: cartTotal,
      tip: tipAmount,
      total: amountDue,
      paymentMethod,
      amountReceived: received,
      changeGiven: paymentMethod === 'EFECTIVO' ? received - amountDue : 0,
      pointName: activeShift.pointName,
      orderNumber,
      orderCode: formatOrderCode(devicePoint?.code, orderNumber),
      orderDay: day,
      orderPointId: pointId,
      synced: false,
    };
    await db.transaction('rw', db.sales, db.queue, async () => {
      await db.sales.add(sale);
      await db.queue.add({
        type: 'sale.create',
        clientId: sale.id,
        payload: {
          uuid_local: sale.id,
          turno_local_id: sale.shiftId,
          subtotal: sale.subtotal,
          propina: sale.tip,
          total: sale.total,
          metodo_pago: sale.paymentMethod,
          creado_en: sale.createdAt,
          detalles: sale.items,
          numero_pedido: sale.orderNumber,
          codigo_pedido: sale.orderCode,
        },
      });
    });
    setSales((items) => [sale, ...items]);
    setLastSale(sale);
    setCart([]);
    setCashReceived('');
    setActiveDialog('receipt');
    const result = await syncQueue();
    setPendingCount(result.pending);
    setSales(await db.sales.orderBy('createdAt').reverse().toArray());
  }

  function editProduct(product?: Product) {
    setDraft(product
      ? { id: product.id, name: product.name, category: product.category, price: moneyInputValue(product.price), symbol: product.symbol, tone: product.tone, active: product.active, image: product.image ?? null, imageChanged: false }
      : { name: '', category: category !== 'Todos' ? category : allCategories[0] ?? '', price: '', symbol: symbols[0], tone: tones[0], active: true, image: null, imageChanged: false });
    setProductError('');
    setPinRequired(false);
    setConfirmingDelete(false);
    setActiveDialog('product');
  }

  async function submitProduct() {
    if (!draft || savingProduct) return;
    const price = parseMoney(draft.price);
    if (!draft.name.trim() || !draft.category.trim() || !Number.isFinite(price) || price < 0) {
      setProductError('Completa nombre, categoría y un precio válido.');
      return;
    }
    setSavingProduct(true);
    const result = await saveProduct({
      id: draft.id,
      name: draft.name.trim(),
      category: draft.category.trim(),
      price: Math.round(price * 100) / 100,
      symbol: draft.symbol.trim() || symbols[0],
      tone: draft.tone,
      active: draft.active,
    }, adminPin);
    if (!result.ok) {
      setSavingProduct(false);
      if (result.status === 401) setPinRequired(true);
      setProductError(result.message);
      return;
    }
    let saved = result.value;
    if (draft.imageChanged) {
      const imageResult = await setProductImage(saved.id, draft.image, adminPin);
      if (!imageResult.ok) {
        // El producto ya quedó guardado: se conserva como edición para reintentar solo la imagen.
        setDraft({ ...draft, id: saved.id });
        setMenu((items) => items.some((item) => item.id === saved.id) ? items.map((item) => (item.id === saved.id ? saved : item)) : [...items, saved]);
        setSavingProduct(false);
        setProductError(`El producto se guardó, pero la imagen no: ${imageResult.message}`);
        return;
      }
      saved = imageResult.value;
    }
    setSavingProduct(false);
    storePin(adminPin);
    setMenu((items) => items.some((item) => item.id === saved.id) ? items.map((item) => (item.id === saved.id ? saved : item)) : [...items, saved]);
    setCart((items) => saved.active
      ? items.map((item) => (item.product.id === saved.id ? { ...item, product: saved } : item))
      : items.filter((item) => item.product.id !== saved.id));
    setDraft(null);
    setActiveDialog(null);
    setToast(draft.id ? 'Producto actualizado' : 'Producto agregado a la carta');
  }

  function editHeading() {
    setHeadingDraft(heading);
    setProductError('');
    setPinRequired(false);
    setActiveDialog('heading');
  }

  function removeProduct(productId: number) {
    setMenu((items) => items.filter((item) => item.id !== productId));
    setCart((items) => items.filter((item) => item.product.id !== productId));
  }

  async function removeDraftProduct() {
    if (!draft?.id || savingProduct) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setSavingProduct(true);
    const result = await deleteProduct(draft.id, adminPin);
    setSavingProduct(false);
    if (!result.ok) {
      if (result.status === 401) setPinRequired(true);
      setProductError(result.message);
      return;
    }
    storePin(adminPin);
    removeProduct(draft.id);
    setToast(`"${draft.name}" se eliminó de la carta`);
    setDraft(null);
    setActiveDialog(null);
  }

  async function pickProductImage(file: File | undefined) {
    if (!file || !draft) return;
    try {
      setDraft({ ...draft, image: await resizeImage(file), imageChanged: true });
      setProductError('');
    } catch {
      setProductError('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
    }
  }

  async function submitHeading() {
    if (savingProduct) return;
    if (!headingDraft.title.trim()) {
      setProductError('El título es obligatorio.');
      return;
    }
    setSavingProduct(true);
    const result = await saveHeading(headingDraft, adminPin);
    setSavingProduct(false);
    if (!result.ok) {
      if (result.status === 401) setPinRequired(true);
      setProductError(result.message);
      return;
    }
    storePin(adminPin);
    setHeading(result.value);
    setActiveDialog(null);
    setToast('Encabezado actualizado');
  }

  const pinField = pinRequired && <><label className="field-label" htmlFor="admin-pin">PIN de administrador</label><div className="money-input"><Lock size={15} /><input id="admin-pin" type="password" inputMode="numeric" autoComplete="off" value={adminPin} onChange={(event) => setAdminPin(event.target.value)} placeholder="Ingresa el PIN" /></div></>;

  const dateLabel = new Intl.DateTimeFormat('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#pos" onClick={() => setActiveScreen('pos')} aria-label="Caraboa Express, inicio">
          <span className="brand-mark has-logo"><img src="/logo.png" alt="" /></span>
          <span className="brand-copy"><strong>caraboa express</strong><small>food truck · POS</small></span>
        </a>

        <div className="sidebar-section-label">OPERACIÓN</div>
        <nav className="side-nav" aria-label="Navegación principal">
          <button className={`nav-item ${activeScreen === 'pos' ? 'active' : ''}`} onClick={() => setActiveScreen('pos')} aria-label="Punto de venta" title="Punto de venta">
            <ShoppingBag size={18} /><span>Punto de venta</span><kbd>1</kbd>
          </button>
          <button className={`nav-item ${activeScreen === 'history' ? 'active' : ''}`} onClick={() => setActiveScreen('history')} aria-label="Ventas" title="Ventas">
            <History size={18} /><span>Ventas</span><kbd>2</kbd>
          </button>
          <button className={`nav-item ${activeScreen === 'menu' ? 'active' : ''}`} onClick={() => setActiveScreen('menu')} aria-label="Carta" title="Carta">
            <BookOpen size={18} /><span>Carta</span><kbd>3</kbd>
          </button>
          <button className={`nav-item ${activeScreen === 'kitchen' ? 'active' : ''}`} onClick={() => setActiveScreen('kitchen')} aria-label="Comandas" title="Comandas">
            <ChefHat size={18} /><span>Comandas</span>{kitchen.enabled && <i className="nav-live" title="Imprimiendo comandas" />}
          </button>
        </nav>

        <div className="sidebar-section-label admin-label">ADMINISTRACIÓN</div>
        <nav className="side-nav" aria-label="Administración">
          {adminScreens.map(({ screen, icon: Icon }) => <button key={screen} className={`nav-item ${activeScreen === screen ? 'active' : ''}`} onClick={() => setActiveScreen(screen)} aria-label={screenTitles[screen]} title={screenTitles[screen]}>
            <Icon size={18} /><span>{screenTitles[screen]}</span>
          </button>)}
        </nav>

        <div className="sidebar-rule" />
        <div className="sidebar-section-label">ESTADO DEL TURNO</div>
        <div className={`shift-card ${activeShift ? 'is-open' : ''}`}>
          <span className="shift-dot" />
          <div><strong>{activeShift ? 'Caja abierta' : 'Caja cerrada'}</strong><small>{activeShift ? `Desde ${new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(activeShift.openedAt))}` : 'Abre un turno para cobrar'}</small></div>
        </div>

        <div className="sidebar-bottom">
          <div className="connection-card">
            {isOnline ? <Cloud size={16} /> : <CloudOff size={16} />}
            <div><strong>{isOnline ? 'En línea' : 'Modo sin conexión'}</strong><small>{pendingCount ? `${pendingCount} por sincronizar` : 'Datos guardados localmente'}</small></div>
            <span className={`connection-pip ${isOnline ? 'online' : ''}`} />
          </div>
          <div className="user-row"><span className="avatar">CE</span><span><strong>Caraboa Express</strong><small>{devicePoint?.name ?? 'Sin punto asignado'}</small></span><button aria-label="Cambiar punto de venta de este dispositivo" title="Cambiar punto de venta" className="user-more" onClick={() => { if (activeShift) setToast('Cierra el turno para cambiar el punto de venta.'); else setActiveDialog('point'); }}>···</button></div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Caraboa Express</span><ArrowRight size={14} /><strong>{screenTitles[activeScreen]}</strong></div>
          <div className="topbar-right"><span className="date-label"><Clock3 size={15} />{dateLabel}</span><span className="topbar-divider" /><span className="live-indicator"><i />{activeShift ? 'Turno activo' : 'Sin turno'}</span></div>
        </header>

            {activeScreen === 'pos' ? (
          <div className="pos-layout">
            <section className="catalog-area">
              <div className="page-heading">
                <div>{(heading.tagline || heading.label) && <p className="eyebrow">{heading.tagline}{heading.tagline && heading.label && <span>·</span>}{heading.label}</p>}<h1>{heading.title}</h1>{heading.subtitle && <p className="heading-sub">{heading.subtitle}</p>}</div>
                <div className="sales-pill"><span className="sales-pill-icon"><CircleDollarSign size={17} /></span><span><small>VENTAS DEL TURNO</small><strong>{currency.format(todaySales.reduce((sum, sale) => sum + sale.total, 0))}</strong></span></div>
              </div>

              <div className="catalog-tools">
                <div className="category-tabs" role="tablist" aria-label="Categorías de productos">
                  {categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}
                </div>
                <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto" aria-label="Buscar producto" /><kbd>/</kbd></label>
              </div>

              <div className="product-grid">
                {filteredProducts.map((product, index) => {
                  const quantity = cart.find((item) => item.product.id === product.id)?.quantity ?? 0;
                  return (
                    <button className={`product-tile ${product.tone}`} key={product.id} onClick={() => activeShift ? addToCart(product) : setActiveDialog('open')} style={{ animationDelay: `${index * 35}ms` }}>
                      <span className="product-art">{product.image ? <img src={product.image} alt="" loading="lazy" /> : <span>{product.symbol}</span>}{quantity > 0 && <b>{quantity}</b>}</span>
                      <span className="product-info"><span className="product-name">{product.name}</span><span className="product-meta">{product.category}<strong>{currency.format(product.price)}</strong></span></span>
                      <span className="product-add"><Plus size={17} /></span>
                    </button>
                  );
                })}
                {filteredProducts.length === 0 && <div className="empty-products"><Search size={21} /><span>No hay productos con ese nombre.</span></div>}
              </div>
              <div className="catalog-footnote"><span><span className="stock-indicator" />Carta activa</span><span>{filteredProducts.length} productos <span className="footnote-separator">·</span> Precios en pesos</span></div>
            </section>

            <aside className="order-panel">
              <div className="order-head"><div><div className="order-title-row"><h2>Pedido actual</h2><span className="order-number">{nextOrderCode}</span></div><p>{cart.length ? `${cart.reduce((sum, item) => sum + item.quantity, 0)} artículos` : 'Aún no hay artículos'}</p></div><button className="icon-button" onClick={() => setCart([])} disabled={!cart.length} aria-label="Vaciar pedido" title="Vaciar pedido"><Trash2 size={17} /></button></div>

              {cart.length ? <div className="cart-list">
                {cart.map(({ product, quantity }) => <div className="cart-item" key={product.id}>
                  <span className={`cart-thumb ${product.tone}`}>{product.image ? <img src={product.image} alt="" /> : product.symbol}</span>
                  <div className="cart-item-main"><strong>{product.name}</strong><small>{currency.format(product.price)} c/u</small><div className="quantity-control"><button onClick={() => adjustQuantity(product.id, -1)} aria-label={`Quitar uno de ${product.name}`}><Minus size={13} /></button><span>{quantity}</span><button onClick={() => adjustQuantity(product.id, 1)} aria-label={`Agregar uno de ${product.name}`}><Plus size={13} /></button></div></div>
                  <strong className="cart-line-total">{currency.format(product.price * quantity)}</strong>
                </div>)}
              </div> : <div className="cart-empty"><span className="empty-bag"><ShoppingBag size={25} /></span><strong>Tu pedido empieza aquí</strong><span>Elige algo rico de la carta.</span></div>}

              <div className="order-bottom"><div className="order-summary"><div><span>Subtotal</span><strong>{currency.format(cartTotal)}</strong></div><div><span>Descuento</span><button className="discount-button" onClick={() => setToast('Los descuentos se habilitarán en una próxima fase.')} disabled={!cart.length}>Añadir</button></div><div className="total-row"><span>Total</span><strong>{currency.format(cartTotal)}</strong></div></div><button className="checkout-button" onClick={() => { setPaymentMethod(allowedMethods[0]); setCashReceived(''); setTipRate(null); setCustomTip(''); setActiveDialog('checkout'); }} disabled={!cart.length || !activeShift}><span><CreditCard size={18} />Cobrar pedido</span><span>{currency.format(cartTotal)}<ArrowRight size={16} /></span></button><div className="order-hint"><span>Enter</span> para cobrar <i /> <span>+ −</span> para cantidad</div></div>
            </aside>
          </div>
        ) : activeScreen === 'history' ? (
          <section className="history-page">
            <div className="page-heading"><div><p className="eyebrow">REGISTRO LOCAL <span>·</span> {sales.length} VENTAS</p><h1>Historial de ventas</h1><p className="heading-sub">Las ventas se guardan en este dispositivo y se sincronizan al volver la conexión.</p></div><button className="secondary-button" onClick={() => window.print()}><ArrowDownToLine size={16} /> Imprimir resumen</button></div>
            {sales.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>VENTA</th><th>HORA</th><th>ARTÍCULOS</th><th>PAGO</th><th>ESTADO</th><th className="align-right">TOTAL</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id} onClick={() => { setLastSale(sale); setActiveDialog('receipt'); }}><td><strong>{sale.orderCode ?? `#${sale.id.slice(0, 6).toUpperCase()}`}</strong></td><td>{new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }).format(new Date(sale.createdAt))}</td><td>{sale.items.reduce((sum, item) => sum + item.quantity, 0)} artículos</td><td><span className="payment-label"><CreditCard size={14} />{paymentLabels[sale.paymentMethod] ?? sale.paymentMethod}</span></td><td><span className={`sync-label ${sale.synced ? 'synced' : ''}`}>{sale.synced ? 'Sincronizada' : 'Pendiente'}</span></td><td className="align-right"><strong>{currency.format(sale.total)}</strong></td></tr>)}</tbody></table></div> : <div className="history-empty"><span className="empty-bag"><ReceiptText size={25} /></span><strong>Todavía no hay ventas</strong><span>Las ventas de tu turno aparecerán aquí.</span><button onClick={() => setActiveScreen('pos')}>Ir al punto de venta <ArrowRight size={15} /></button></div>}
          </section>
        ) : activeScreen === 'kitchen' ? (
          <KitchenScreen station={kitchen} />
        ) : activeScreen !== 'menu' ? (
          <AdminGate pin={adminPin} onPinChange={setAdminPin} verified={adminVerified} onVerified={() => { setAdminVerified(true); storePin(adminPin); }} isOnline={isOnline}>
            {activeScreen === 'reports' && <ReportsAdmin pin={adminPin} points={points} />}
            {activeScreen === 'inventory' && <InventoryAdmin pin={adminPin} onToast={setToast} />}
            {activeScreen === 'recipes' && <RecipesAdmin pin={adminPin} menu={menu} onProductSaved={(saved) => setMenu((items) => items.map((item) => (item.id === saved.id ? saved : item)))} onProductDeleted={removeProduct} onToast={setToast} />}
            {activeScreen === 'suppliers' && <SuppliersAdmin pin={adminPin} onToast={setToast} />}
            {activeScreen === 'equipment' && <EquipmentAdmin pin={adminPin} onToast={setToast} />}
            {activeScreen === 'portal' && <PortalAdmin pin={adminPin} onToast={setToast} />}
            {activeScreen === 'points' && <PointsAdmin pin={adminPin} points={points} devicePointId={devicePoint?.id ?? null} onSaved={savePoint} />}
          </AdminGate>
        ) : (
          <section className="history-page menu-page">
            <div className="page-heading"><div><p className="eyebrow">CARTA <span>·</span> {activeProducts.length} DE {menu.length} DISPONIBLES</p><h1>Editar carta</h1><p className="heading-sub">Cambia nombres, precios, categorías, íconos y colores. Oculta lo que se agote.</p></div><button className="modal-primary menu-new-button" onClick={() => editProduct()} disabled={!isOnline}><Plus size={16} /> Nuevo producto</button></div>
            <div className="heading-card"><div><span className="field-label">Encabezado del punto de venta</span>{(heading.tagline || heading.label) && <p className="eyebrow">{heading.tagline}{heading.tagline && heading.label && <span>·</span>}{heading.label}</p>}<strong>{heading.title}</strong>{heading.subtitle && <small>{heading.subtitle}</small>}</div><button className="secondary-button" onClick={editHeading} disabled={!isOnline}><Pencil size={14} /> Editar encabezado</button></div>
            {!isOnline && <div className="menu-offline"><CloudOff size={15} /> Sin conexión: puedes ver la carta, pero para editarla necesitas internet.</div>}
            <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PRODUCTO</th><th>CATEGORÍA</th><th>ESTADO</th><th className="align-right">PRECIO</th><th /></tr></thead><tbody>{menu.map((product) => <tr key={product.id} className={product.active ? '' : 'is-hidden'} onClick={() => { if (isOnline) editProduct(product); }}><td><span className="menu-product"><span className={`cart-thumb ${product.tone}`}>{product.image ? <img src={product.image} alt="" loading="lazy" /> : product.symbol}</span><strong>{product.name}</strong></span></td><td>{product.category}</td><td><span className={`sync-label ${product.active ? 'synced' : ''}`}>{product.active ? 'Disponible' : 'Oculto'}</span></td><td className="align-right"><strong>{currency.format(product.price)}</strong></td><td className="align-right"><button className="icon-button" disabled={!isOnline} onClick={(event) => { event.stopPropagation(); editProduct(product); }} aria-label={`Editar ${product.name}`} title="Editar"><Pencil size={15} /></button></td></tr>)}</tbody></table></div>
          </section>
        )}
      </main>

      {!activeShift && !activeDialog && <button className="floating-open" onClick={() => setActiveDialog(devicePoint ? 'open' : 'point')}><Wallet size={17} /> Abrir caja</button>}

      {activeDialog && <div className={`modal-backdrop ${activeDialog === 'receipt' ? 'receipt-backdrop' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget && activeDialog !== 'open') setActiveDialog(null); }}>
        {activeDialog === 'open' && <section className="modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="open-title"><div className="modal-topline"><span className="modal-symbol green"><Wallet size={20} /></span><button className="icon-button" onClick={() => { if (activeShift) setActiveDialog(null); }} aria-label="Cerrar"><X size={18} /></button></div><p className="eyebrow">INICIO DE JORNADA</p><h2 id="open-title">Abrir caja</h2><p className="modal-copy">Registra el efectivo inicial para comenzar a vender. Este monto será la base del arqueo.</p><label className="field-label" htmlFor="opening-cash">Efectivo inicial <span>BRL</span></label><div className="money-input"><span>$</span><input id="opening-cash" autoFocus type="text" inputMode="decimal" autoComplete="off" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="0,00" onKeyDown={(event) => { if (event.key === 'Enter') void openShift(); }} /></div><button className="modal-primary" onClick={() => void openShift()} disabled={!(parseMoney(openingCash) >= 0)}>Abrir turno <ArrowRight size={17} /></button><div className="modal-footnote"><Cloud size={14} /> Quedará guardado en este dispositivo si no hay conexión.</div></section>}

        {activeDialog === 'point' && <section className="modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="point-choose-title">
          <div className="modal-topline"><span className="modal-symbol orange"><MonitorSmartphone size={20} /></span>{devicePoint && <button className="icon-button" onClick={() => setActiveDialog(activeShift ? null : 'open')} aria-label="Cerrar"><X size={18} /></button>}</div>
          <p className="eyebrow">CONFIGURACIÓN DEL DISPOSITIVO</p>
          <h2 id="point-choose-title">¿Qué punto de venta es este?</h2>
          <p className="modal-copy">Las ventas y los turnos de este dispositivo quedarán identificados con este punto. Usa un punto distinto en cada dispositivo: así los números de pedido (A-001, B-001…) no se repiten.</p>
          {points.filter((point) => point.active).length ? <div className="payment-options" role="group" aria-label="Puntos de venta">{points.filter((point) => point.active).map((point) => <button key={point.id} className={devicePoint?.id === point.id ? 'selected' : ''} onClick={() => choosePoint(point)}><span className="point-code">{point.code || <MonitorSmartphone size={18} />}</span><strong>{point.name}<small className="point-methods">{point.methods.map((method) => paymentLabels[method]).join(' · ')}</small></strong>{devicePoint?.id === point.id && <Check size={16} />}</button>)}</div>
            : <p className="form-error">{isOnline ? 'Cargando puntos de venta…' : 'Sin conexión: no se pudieron cargar los puntos de venta.'}</p>}
          {!devicePoint && <button className="secondary-button point-skip" onClick={() => setActiveDialog('open')}>Continuar sin punto por ahora</button>}
        </section>}

        {activeDialog === 'checkout' && <section className="modal checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title"><div className="modal-topline"><span className="modal-symbol orange"><CreditCard size={20} /></span><button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Cerrar"><X size={18} /></button></div><p className="eyebrow">PEDIDO {nextOrderCode}</p><h2 id="checkout-title">Forma de pago</h2><p className="modal-copy">Selecciona cómo recibes el pago.</p><div className="payment-options" role="group" aria-label="Método de pago">{allowedMethods.map((method) => { const Icon = paymentIcons[method]; return <button key={method} className={paymentMethod === method ? 'selected' : ''} onClick={() => setPaymentMethod(method)}><span><Icon size={19} /></span><strong>{paymentLabels[method]}</strong>{paymentMethod === method && <Check size={16} />}</button>; })}</div><div className="tip-picker"><span className="tip-label">Propina <small>opcional</small></span><div className="tip-options"><button className={tipRate === null ? 'selected' : ''} onClick={() => { setTipRate(null); setCustomTip(''); }}>Sin propina</button><button className={tipRate === 10 ? 'selected' : ''} onClick={() => setTipRate(10)}>10%</button><button className={tipRate === 15 ? 'selected' : ''} onClick={() => setTipRate(15)}>15%</button><button className={tipRate === 'custom' ? 'selected' : ''} onClick={() => setTipRate('custom')}>Libre</button></div>{tipRate === 'custom' && <div className="money-input custom-tip-input"><span>$</span><input aria-label="Propina libre" type="text" inputMode="decimal" autoComplete="off" value={customTip} onChange={(event) => setCustomTip(event.target.value)} placeholder="0,00" /></div>}</div>{paymentMethod === 'EFECTIVO' && <><label className="field-label" htmlFor="cash-received">Efectivo recibido <span>BRL</span></label><div className="money-input"><span>$</span><input id="cash-received" autoFocus type="text" inputMode="decimal" autoComplete="off" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder={moneyInputValue(amountDue)} /></div><div className="change-row"><span>Cambio</span><strong>{currency.format(changeDue)}</strong></div></>}<div className="checkout-breakdown"><div><span>Consumo</span><strong>{currency.format(cartTotal)}</strong></div><div><span>Propina</span><strong>{currency.format(tipAmount)}</strong></div></div><div className="checkout-total"><span>Total a cobrar</span><strong>{currency.format(amountDue)}</strong></div><button className="modal-primary" onClick={() => void completeSale()} disabled={paymentMethod === 'EFECTIVO' && (parseMoney(cashReceived) || 0) < amountDue}>Confirmar cobro <CheckCircle2 size={18} /></button><div className="modal-footnote"><Cloud size={14} /> Pago registrado localmente. La integración con terminales se configura aparte.</div></section>}

        {activeDialog === 'product' && draft && <section className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="product-title">
          <div className="modal-topline"><span className={`cart-thumb ${draft.tone}`}>{draft.image ? <img src={draft.image} alt="" /> : draft.symbol || symbols[0]}</span><button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Cerrar"><X size={18} /></button></div>
          <p className="eyebrow">CARTA</p>
          <h2 id="product-title">{draft.id ? 'Editar producto' : 'Nuevo producto'}</h2>
          <form onSubmit={(event) => { event.preventDefault(); void submitProduct(); }}>
            <label className="field-label" htmlFor="product-name">Nombre</label>
            <input id="product-name" className="text-input" autoFocus maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Tequeños de queso (6)" />
            <div className="product-form-row">
              <div><label className="field-label" htmlFor="product-category">Categoría <span>elige o escribe una nueva</span></label>
                <input id="product-category" className="text-input" list="category-options" maxLength={50} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="Ej. Tequeños" />
                <datalist id="category-options">{allCategories.map((item) => <option key={item} value={item} />)}</datalist></div>
              <div><label className="field-label" htmlFor="product-price">Precio <span>BRL</span></label>
                <div className="money-input"><span>$</span><input id="product-price" type="text" inputMode="decimal" autoComplete="off" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} placeholder="0,00" /></div></div>
            </div>
            <span className="field-label">Imagen <span>opcional · reemplaza al ícono</span></span>
            <div className="image-picker">
              {draft.image ? <img src={draft.image} alt="Vista previa del producto" /> : <span className={`cart-thumb ${draft.tone}`}>{draft.symbol || symbols[0]}</span>}
              <label className="secondary-button">{draft.image ? 'Cambiar foto' : 'Subir foto'}<input type="file" accept="image/*" onChange={(event) => { void pickProductImage(event.target.files?.[0]); event.target.value = ''; }} /></label>
              {draft.image && <button type="button" className="secondary-button" onClick={() => setDraft({ ...draft, image: null, imageChanged: true })}>Quitar</button>}
            </div>
            <span className="field-label">Ícono <span>o escribe un emoji</span></span>
            <div className="symbol-options" role="group" aria-label="Ícono">{symbols.map((item) => <button type="button" key={item} className={draft.symbol === item ? 'selected' : ''} onClick={() => setDraft({ ...draft, symbol: item })}>{item}</button>)}<input aria-label="Ícono personalizado" className="text-input" maxLength={2} value={symbols.includes(draft.symbol) ? '' : draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value })} placeholder="🧀" /></div>
            <span className="field-label">Color</span>
            <div className="tone-options" role="group" aria-label="Color">{tones.map((item) => <button type="button" key={item} className={`cart-thumb ${item} ${draft.tone === item ? 'selected' : ''}`} onClick={() => setDraft({ ...draft, tone: item })} aria-label={item} aria-pressed={draft.tone === item} />)}</div>
            <label className="availability-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><span><strong>Disponible para vender</strong><small>Desmárcalo para ocultarlo del punto de venta (por ejemplo, si se agotó).</small></span></label>
            {pinField}
            {productError && <p className="form-error" role="alert">{productError}</p>}
            <button className="modal-primary" type="submit" disabled={savingProduct || !isOnline}>{savingProduct ? 'Guardando…' : draft.id ? 'Guardar cambios' : 'Agregar a la carta'} <CheckCircle2 size={18} /></button>
            {draft.id && <button type="button" className={`secondary-button delete-product ${confirmingDelete ? 'confirming' : ''}`} onClick={() => void removeDraftProduct()} disabled={savingProduct || !isOnline}><Trash2 size={14} /> {confirmingDelete ? 'Toca de nuevo para confirmar: se elimina de la carta' : 'Eliminar producto'}</button>}
          </form>
        </section>}

        {activeDialog === 'heading' && <section className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="heading-title">
          <div className="modal-topline"><span className="modal-symbol orange"><Pencil size={18} /></span><button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Cerrar"><X size={18} /></button></div>
          <p className="eyebrow">CARTA</p>
          <h2 id="heading-title">Encabezado</h2>
          <p className="modal-copy">Los textos que aparecen sobre los productos en el punto de venta.</p>
          <form onSubmit={(event) => { event.preventDefault(); void submitHeading(); }}>
            <div className="product-form-row">
              <div><label className="field-label" htmlFor="heading-tagline">Línea superior</label><input id="heading-tagline" className="text-input" autoFocus maxLength={60} value={headingDraft.tagline} onChange={(event) => setHeadingDraft({ ...headingDraft, tagline: event.target.value })} placeholder="Ej. VIERNES DE TEQUEÑOS" /></div>
              <div><label className="field-label" htmlFor="heading-label">Etiqueta</label><input id="heading-label" className="text-input" maxLength={60} value={headingDraft.label} onChange={(event) => setHeadingDraft({ ...headingDraft, label: event.target.value })} placeholder="Ej. CARTA DEL DÍA" /></div>
            </div>
            <label className="field-label" htmlFor="heading-main">Título</label>
            <input id="heading-main" className="text-input" maxLength={80} value={headingDraft.title} onChange={(event) => setHeadingDraft({ ...headingDraft, title: event.target.value })} placeholder="Ej. ¿Qué te provoca hoy?" />
            <label className="field-label" htmlFor="heading-subtitle">Subtítulo <span>opcional</span></label>
            <input id="heading-subtitle" className="text-input" maxLength={160} value={headingDraft.subtitle} onChange={(event) => setHeadingDraft({ ...headingDraft, subtitle: event.target.value })} placeholder="Ej. Toca un producto para sumarlo al pedido." />
            {pinField}
            {productError && <p className="form-error" role="alert">{productError}</p>}
            <button className="modal-primary" type="submit" disabled={savingProduct || !isOnline}>{savingProduct ? 'Guardando…' : 'Guardar encabezado'} <CheckCircle2 size={18} /></button>
          </form>
        </section>}

        {activeDialog === 'close' && <section className="modal shift-modal" role="dialog" aria-modal="true" aria-labelledby="close-title">
          <div className="modal-topline"><span className="modal-symbol red"><Wallet size={20} /></span><button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Cerrar"><X size={18} /></button></div>
          <p className="eyebrow">CIERRE DE JORNADA</p>
          <h2 id="close-title">Arqueo de caja</h2>
          <p className="modal-copy">Cuenta el efectivo físico e ingresa el monto. La diferencia se mostrará después del conteo.</p>
          <label className="field-label" htmlFor="closing-cash">Efectivo contado <span>BRL</span></label>
          <div className="money-input"><span>$</span><input id="closing-cash" autoFocus type="text" inputMode="decimal" autoComplete="off" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} placeholder="0,00" /></div>
          {closingCash !== '' && <div className={`change-row ${parseMoney(closingCash) - expectedCash === 0 ? 'balanced' : ''}`}><span>Diferencia</span><strong>{currency.format(parseMoney(closingCash) - expectedCash)}</strong></div>}
          <button className="modal-primary" onClick={() => void closeShift()} disabled={!(parseMoney(closingCash) >= 0)}>Cerrar turno <CheckCircle2 size={18} /></button>
        </section>}

        {activeDialog === 'receipt' && lastSale && <section className="receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div className="receipt-actions"><span className="saved-badge"><CheckCircle2 size={15} /> Venta guardada</span><button className="icon-button" onClick={() => setActiveDialog(null)} aria-label="Cerrar ticket"><X size={18} /></button></div><div className="receipt-paper"><div className="receipt-brand"><span className="receipt-brand-mark has-logo"><img src="/logo.png" alt="" /></span><strong>caraboa express</strong><small>FOOD TRUCK · PUNTO DE VENTA</small></div>{lastSale.orderCode && <div className="receipt-order"><small>PEDIDO</small><strong>{lastSale.orderCode}</strong></div>}<div className="receipt-divider" /><div className="receipt-meta"><span>{lastSale.orderCode ? <>Pedido <strong>{lastSale.orderCode}</strong></> : <>Ticket <strong>#{lastSale.id.slice(0, 6).toUpperCase()}</strong></>}</span><span>{new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastSale.createdAt))}</span></div><div className="receipt-items">{lastSale.items.map((item, index) => <div key={`${item.productId}-${index}`}><span>{item.quantity} × {item.name}</span><strong>{currency.format(item.subtotal)}</strong></div>)}</div><div className="receipt-divider" /><div className="receipt-subtotals"><div><span>Subtotal</span><strong>{currency.format(lastSale.subtotal)}</strong></div><div><span>Propina</span><strong>{currency.format(lastSale.tip)}</strong></div></div><div className="receipt-total"><span>TOTAL</span><strong>{currency.format(lastSale.total)}</strong></div><div className="receipt-payment"><span>Pago · {paymentLabels[lastSale.paymentMethod] ?? lastSale.paymentMethod}</span>{lastSale.pointName && <span>Punto · {lastSale.pointName}</span>}{lastSale.paymentMethod === 'EFECTIVO' && <><span>Recibido · {currency.format(lastSale.amountReceived)}</span><span>Cambio · {currency.format(lastSale.changeGiven)}</span></>}</div><div className="receipt-thanks">¡Gracias por comer rico!<small>Hecho con cariño en Caraboa Express</small></div></div><ReceiptShare sale={lastSale} /><div className="receipt-buttons"><button className="secondary-button" onClick={() => void printHtml(receiptHtml(lastSale))}><Printer size={16} /> Imprimir ticket</button><button className="modal-primary" onClick={() => { setActiveDialog(null); setActiveScreen('pos'); }}><Coffee size={17} /> Nuevo pedido</button></div></section>}
      </div>}

      {activeShift && <button className="close-shift-button" onClick={() => { setClosingCash(''); setActiveDialog('close'); }}><Wallet size={16} /> Cerrar turno</button>}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}

export default App;