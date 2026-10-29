import Dexie, { type Table } from 'dexie';
import { defaultHeading } from './data';
import type { LocalSale, LocalShift, PointOfSale, PosHeading, Product, QueueOperation } from './types';

class PosDatabase extends Dexie {
  products!: Table<Product, number>;
  shifts!: Table<LocalShift, string>;
  sales!: Table<LocalSale, string>;
  queue!: Table<QueueOperation, number>;

  constructor() {
    super('arepa-club-pos');
    this.version(1).stores({
      products: 'id, category',
      shifts: 'id, openedAt, closedAt, synced',
      sales: 'id, shiftId, createdAt, synced',
      queue: '++id, clientId, type',
    });
  }
}

export const db = new PosDatabase();

export async function refreshMenu(): Promise<Product[] | null> {
  try {
    const response = await fetch('/api/products', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const menu: Product[] = await response.json();
    await db.transaction('rw', db.products, async () => {
      await db.products.clear();
      await db.products.bulkPut(menu);
    });
    return menu;
  } catch {
    return null;
  }
}

export type SaveResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

/** Llamada a la API de administración con el PIN. Devuelve el detalle del error del servidor si lo hay. */
export async function adminRequest<T>(url: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body: unknown, pin: string): Promise<SaveResult<T>> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      let message = response.status === 401 ? 'PIN incorrecto' : 'No se pudo guardar. Revisa los datos.';
      if (response.status !== 401) {
        const detail = await response.json().then((data) => data?.detail, () => undefined);
        if (typeof detail === 'string') message = detail;
      }
      return { ok: false, status: response.status, message };
    }
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false, status: 0, message: 'Sin conexión con el servidor. Inténtalo de nuevo.' };
  }
}

const HEADING_STORAGE_KEY = 'tequenos-club-heading';

export function readCachedHeading(): PosHeading {
  try {
    const cached = localStorage.getItem(HEADING_STORAGE_KEY);
    return cached ? { ...defaultHeading, ...JSON.parse(cached) } : defaultHeading;
  } catch {
    return defaultHeading;
  }
}

function cacheHeading(heading: PosHeading) {
  try {
    localStorage.setItem(HEADING_STORAGE_KEY, JSON.stringify(heading));
  } catch {
    // Sin almacenamiento: se usará el encabezado del servidor en la próxima conexión.
  }
}

export async function refreshHeading(): Promise<PosHeading | null> {
  try {
    const response = await fetch('/api/settings/heading', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const heading: PosHeading = await response.json();
    cacheHeading(heading);
    return heading;
  } catch {
    return null;
  }
}

export async function saveHeading(heading: PosHeading, pin: string): Promise<SaveResult<PosHeading>> {
  const result = await adminRequest<PosHeading>('/api/settings/heading', 'PUT', heading, pin);
  if (result.ok) cacheHeading(result.value);
  return result;
}

export async function saveProduct(
  product: Omit<Product, 'id'> & { id?: number },
  pin: string,
): Promise<SaveResult<Product>> {
  const { id, ...fields } = product;
  const result = await adminRequest<Product>(id ? `/api/products/${id}` : '/api/products', id ? 'PUT' : 'POST', fields, pin);
  if (result.ok) await db.products.put(result.value);
  return result;
}

export async function setProductImage(productId: number, dataUrl: string | null, pin: string): Promise<SaveResult<Product>> {
  const url = `/api/products/${productId}/image`;
  const result = dataUrl
    ? await adminRequest<Product>(url, 'PUT', { dataUrl }, pin)
    : await adminRequest<Product>(url, 'DELETE', undefined, pin);
  if (result.ok) await db.products.put(result.value);
  return result;
}

/** Elimina un producto de la carta (el servidor lo archiva para conservar el historial de ventas). */
export async function deleteProduct(productId: number, pin: string): Promise<SaveResult<{ ok: boolean }>> {
  const result = await adminRequest<{ ok: boolean }>(`/api/products/${productId}`, 'DELETE', undefined, pin);
  if (result.ok) await db.products.delete(productId);
  return result;
}

/** Achica la foto en el dispositivo antes de subirla, para que la carta cargue rápido. */
export function resizeImage(file: File, maxSide = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const webp = canvas.toDataURL('image/webp', 0.82);
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    image.src = url;
  });
}

/** Descarga un archivo protegido con el PIN (por ejemplo, un reporte PDF). */
export async function adminDownload(url: string, filename: string, pin: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { 'X-Admin-Pin': pin } });
    if (!response.ok) return response.status === 401 ? 'PIN incorrecto' : 'No se pudo generar el archivo.';
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    return null;
  } catch {
    return 'Sin conexión con el servidor.';
  }
}

const POINTS_STORAGE_KEY = 'tequenos-club-points';
const ORDER_NUMBERS_STORAGE_KEY = 'tequenos-club-order-numbers';
const DEVICE_POINT_STORAGE_KEY = 'tequenos-club-device-point';

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin almacenamiento disponible: se volverá a pedir en la próxima apertura.
  }
}

export const readCachedPoints = () => readJson<PointOfSale[]>(POINTS_STORAGE_KEY, []);

export async function refreshPoints(): Promise<PointOfSale[] | null> {
  try {
    const response = await fetch('/api/points', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const points: PointOfSale[] = await response.json();
    writeJson(POINTS_STORAGE_KEY, points);
    return points;
  } catch {
    return null;
  }
}

export interface ServerOrderNumbers {
  day: string;
  numbers: Record<string, number>;
}

export const readCachedOrderNumbers = () => readJson<ServerOrderNumbers>(ORDER_NUMBERS_STORAGE_KEY, { day: '', numbers: {} });

/** Últimos números de pedido que el servidor ya recibió hoy, por punto (por si este dispositivo perdió sus datos). */
export async function refreshOrderNumbers(day: string): Promise<ServerOrderNumbers | null> {
  try {
    const response = await fetch(`/api/order-numbers?date=${day}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const result: ServerOrderNumbers = { day, numbers: await response.json() };
    writeJson(ORDER_NUMBERS_STORAGE_KEY, result);
    return result;
  } catch {
    return null;
  }
}

/** Próximo número de pedido del día para un punto: sigue al mayor entre lo vendido acá y lo que ya tiene el servidor. */
export function nextOrderNumber(sales: LocalSale[], pointId: number | null, day: string, server: ServerOrderNumbers): number {
  const local = sales
    .filter((sale) => sale.orderDay === day && (sale.orderPointId ?? null) === pointId)
    .reduce((max, sale) => Math.max(max, sale.orderNumber ?? 0), 0);
  const remote = server.day === day && pointId !== null ? server.numbers[String(pointId)] ?? 0 : 0;
  return Math.max(local, remote) + 1;
}

/** Punto de venta elegido en este dispositivo (cada laptop o celular elige el suyo). */
export const readDevicePoint = () => readJson<PointOfSale | null>(DEVICE_POINT_STORAGE_KEY, null);
export const storeDevicePoint = (point: PointOfSale) => writeJson(DEVICE_POINT_STORAGE_KEY, point);

export async function syncQueue(): Promise<{ connected: boolean; pending: number }> {
  if (!navigator.onLine) return { connected: false, pending: await db.queue.count() };

  let connected = false;
  try {
    const health = await fetch('/api/health', { signal: AbortSignal.timeout(2500) });
    connected = health.ok;
    if (connected) {
      const operations = await db.queue.orderBy('id').toArray();
      for (const operation of operations) {
        const response = await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation),
        });
        if (!response.ok) break;
        await db.queue.delete(operation.id!);
        if (operation.type === 'sale.create') {
          await db.sales.update(operation.clientId, { synced: true });
        } else {
          await db.shifts.update(operation.clientId, { synced: true });
        }
      }
    }
  } catch {
    connected = false;
  }

  return { connected, pending: await db.queue.count() };
}