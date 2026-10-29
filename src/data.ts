import type { PaymentMethod, PosHeading, Product } from './types';

// Carta inicial: se usa solo hasta que el dispositivo descarga la carta del servidor.
export const products: Product[] = [
  { id: 1, name: 'Pizza Margarita 25 cm', category: 'Pizzas', price: 25, symbol: '◉', tone: 'coral', active: true },
  { id: 2, name: 'Pizza Portuguesa 25 cm', category: 'Pizzas', price: 25, symbol: '◉', tone: 'gold', active: true },
  { id: 3, name: 'Pizza Calabresa 25 cm', category: 'Pizzas', price: 25, symbol: '◉', tone: 'pink', active: true },
  { id: 4, name: 'Pizza 4 Quesos 25 cm', category: 'Pizzas', price: 25, symbol: '◉', tone: 'yellow', active: true },
  { id: 5, name: 'Pizza Salami 25 cm', category: 'Pizzas', price: 25, symbol: '◉', tone: 'lavender', active: true },
  { id: 6, name: 'Hamburguesa normal', category: 'Hamburguesas', price: 25, symbol: '●', tone: 'sage', active: true },
  { id: 7, name: 'Hamburguesa especial', category: 'Hamburguesas', price: 30, symbol: '●', tone: 'lime', active: true },
  { id: 8, name: 'Sándwich de pollo', category: 'Sándwiches', price: 25, symbol: '◒', tone: 'mint', active: true },
  { id: 9, name: 'Sándwich de pernil', category: 'Sándwiches', price: 25, symbol: '◒', tone: 'cream', active: true },
  { id: 10, name: 'Tequeños (10 unidades)', category: 'Tequeños', price: 20, symbol: '▰', tone: 'blue', active: true },
];

export const defaultHeading: PosHeading = {
  tagline: 'CARABOA EXPRESS',
  label: 'CARTA DEL DÍA',
  title: '¿Qué servimos?',
  subtitle: 'Toca un producto para sumarlo al pedido.',
};

export const paymentMethods: PaymentMethod[] = ['EFECTIVO', 'TARJETA', 'QR', 'TRANSFERENCIA', 'MERCADO_PAGO'];

export const paymentLabels: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  QR: 'Pix / QR',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
};

export const tones = ['gold', 'coral', 'mint', 'yellow', 'pink', 'sage', 'lime', 'cream', 'blue', 'lavender'];

export const symbols = ['◉', '◌', '◒', '◍', '▰', '✳', '✦', '+', '●', '◆', '★', '♥'];

export const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Fecha de hoy (o de `when`) en Brasil (hora de Santa Catarina), en formato AAAA-MM-DD. */
export function todayInArgentina(when = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(when);
}

/** Número de pedido visible: letra del punto + número del día (A-001). */
export function formatOrderCode(pointCode: string | undefined, orderNumber: number): string {
  const number = String(orderNumber).padStart(3, '0');
  return pointCode ? `${pointCode}-${number}` : number;
}

/** Interpreta importes escritos al estilo argentino: "1.250,50", "1250,5", "1250.50" o "1250". */
export function parseMoney(text: string): number {
  const clean = text.replace(/[\s$]/g, '');
  if (!clean) return Number.NaN;
  let normalized = clean;
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if ((clean.match(/\./g) ?? []).length > 1 || /\.\d{3}$/.test(clean)) {
    normalized = clean.replace(/\./g, '');
  }
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

/** Importe para mostrar dentro de un campo editable: "1250,5" (sin separador de miles). */
export function moneyInputValue(amount: number): string {
  return String(Math.round(amount * 100) / 100).replace('.', ',');
}