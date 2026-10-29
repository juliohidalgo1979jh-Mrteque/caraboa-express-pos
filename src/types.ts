export type PaymentMethod = 'EFECTIVO' | 'TARJETA' | 'QR' | 'TRANSFERENCIA' | 'MERCADO_PAGO';

export interface PointOfSale {
  id: number;
  name: string;
  code: string;
  methods: PaymentMethod[];
  active: boolean;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  symbol: string;
  tone: string;
  active: boolean;
  image?: string | null;
}

export interface PosHeading {
  tagline: string;
  label: string;
  title: string;
  subtitle: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface LocalShift {
  id: string;
  openingCash: number;
  openedAt: string;
  closedAt?: string;
  closingCash?: number;
  pointId?: number | null;
  pointName?: string;
  synced: boolean;
}

export interface LocalSale {
  id: string;
  shiftId: string;
  createdAt: string;
  items: Array<{ productId: number; name: string; quantity: number; price: number; subtotal: number }>;
  subtotal: number;
  tip: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  changeGiven: number;
  pointName?: string;
  orderNumber?: number;
  orderCode?: string;
  orderDay?: string;
  orderPointId?: number | null;
  synced: boolean;
}

export interface QueueOperation {
  id?: number;
  type: 'shift.open' | 'shift.close' | 'sale.create';
  clientId: string;
  payload: Record<string, unknown>;
}
export interface Supplier {
  id: number;
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
  itemCount?: number;
}

export type StockKind = 'PRODUCTO' | 'INSUMO';
export type StockUnit = 'unid' | 'kg' | 'g' | 'l' | 'ml';

export interface StockItem {
  id: number;
  kind: StockKind;
  name: string;
  unit: StockUnit;
  stock: number;
  minStock: number;
  unitCost: number;
  supplierId: number | null;
  supplierName: string | null;
  active: boolean;
  low: boolean;
  usedIn: string[];
}

export interface StockMovement {
  id: number;
  itemId: number;
  itemName: string;
  unit: StockUnit;
  kind: 'COMPRA' | 'AJUSTE' | 'VENTA';
  quantity: number;
  unitCost: number | null;
  supplierName: string | null;
  saleId: number | null;
  note: string;
  createdAt: string;
}

export interface RecipeSummary {
  productId: number;
  lines: Array<{ itemId: number; name: string; kind: StockKind; unit: StockUnit; quantity: number; unitCost: number; lineCost: number }>;
  cost: number;
  price: number;
  margin: number | null;
  suggestedPrice: number | null;
  profit: number | null;
  profitPercent: number | null;
}

export type EquipmentStatus = 'OPERATIVO' | 'EN_REPARACION' | 'FUERA_DE_SERVICIO';

export interface Equipment {
  id: number;
  name: string;
  category: string;
  brand: string;
  model: string;
  serialNumber: string;
  location: string;
  status: EquipmentStatus;
  purchaseDate: string | null;
  value: number | null;
  notes: string;
}

export interface DailyReport {
  date: string;
  salesCount: number;
  total: number;
  tips: number;
  averageTicket: number;
  cost: number;
  grossProfit: number | null;
  byPoint: Array<{ name: string; count: number; total: number }>;
  byMethod: Array<{ name: string; count: number; total: number }>;
  products: Array<{ name: string; quantity: number; total: number }>;
  shifts: Array<{
    id: number;
    point: string;
    openedAt: string;
    closedAt: string | null;
    openingCash: number;
    cashSales: number;
    expectedCash: number;
    closingCash: number | null;
    difference: number | null;
    total: number;
  }>;
}

export interface Comanda {
  id: number;
  orderCode: string;
  point: string;
  time: string;
  paymentMethod: string;
  total: number;
  items: Array<{ name: string; quantity: number; unitPrice: number; subtotal: number }>;
  printedAt: string | null;
}
