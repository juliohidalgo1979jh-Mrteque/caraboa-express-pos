import type { PaymentMethod, PosHeading, Product } from './types';

// Carta inicial: se usa solo hasta que el dispositivo descarga la carta del servidor.
export const products: Product[] = [
  { id: 1, name: 'Arepa Pabellón', category: 'Arepas', price: 9.5, symbol: '◉', tone: 'gold', active: true },
  { id: 2, name: 'Arepa Pelúa', category: 'Arepas', price: 8.75, symbol: '◌', tone: 'coral', active: true },
  { id: 3, name: 'Arepa Reina Pepiada', category: 'Arepas', price: 8.25, symbol: '◉', tone: 'mint', active: true },
  { id: 4, name: 'Cachapa con queso', category: 'Cachapas', price: 10.5, symbol: '◒', tone: 'yellow', active: true },
  { id: 5, name: 'Tequeños (5)', category: 'Para picar', price: 6.5, symbol: '▰', tone: 'pink', active: true },
  { id: 6, name: 'Yuca frita', category: 'Para picar', price: 5.25, symbol: '✳', tone: 'sage', active: true },
  { id: 7, name: 'Papelón con limón', category: 'Bebidas', price: 3.5, symbol: '◒', tone: 'lime', active: true },
  { id: 8, name: 'Chicha venezolana', category: 'Bebidas', price: 4.25, symbol: '◍', tone: 'cream', active: true },
  { id: 9, name: 'Combo callejero', category: 'Combos', price: 14.5, symbol: '✦', tone: 'blue', active: true },
  { id: 10, name: 'Combo para dos', category: 'Combos', price: 25, symbol: '✦', tone: 'lavender', active: true },
  { id: 11, name: 'Extra queso', category: 'Extras', price: 1.5, symbol: '+', tone: 'cream', active: true },
  { id: 12, name: 'Salsa de ajo', category: 'Extras', price: 0.75, symbol: '◉', tone: 'mint', active: true },
];

export const defaultHeading: PosHeading = {
  tagline: 'MARTES DE ANTOJO',
  label: 'CARTA DEL DÍA',
  title: '¿Qué servimos?',
  subtitle: 'Toca un producto para sumarlo al pedido.',
};

export const paymentMethods: PaymentMethod[] = ['EFECTIVO', 'TARJETA', 'QR', 'TRANSFERENCIA', 'MERCADO_PAGO'];

export const paymentLabels: Record<PaymentMethod, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  QR: 'QR',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
};

export const tones = ['gold', 'coral', 'mint', 'yellow', 'pink', 'sage', 'lime', 'cream', 'blue', 'lavender'];

export const symbols = ['◉', '◌', '◒', '◍', '▰', '✳', '✦', '+', '●', '◆', '★', '♥'];

export const currency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
});

/** Fecha de hoy (o de `when`) en Argentina, en formato AAAA-MM-DD. */
export function todayInArgentina(when = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(when);
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