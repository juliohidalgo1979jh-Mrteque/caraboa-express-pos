import { parseMoney } from '../data';
import { factor } from './PurchaseModal';

// Las recetas se escriben en gramos o mililitros; el sistema convierte a la unidad del artículo (ej. 150 g = 0,15 kg).
export const entryUnit = (unit: string) => (unit === 'kg' || unit === 'g' ? 'g' : unit === 'l' || unit === 'ml' ? 'ml' : unit);
export const lineUnit = (line: { unit: string }, item?: { unit: string }) => line.unit || (item ? entryUnit(item.unit) : '');
export const inItemUnit = (line: { quantity: string; unit: string }, item?: { unit: string }) => (parseMoney(line.quantity) || 0) * (item ? factor(lineUnit(line, item), item.unit) : 1);
