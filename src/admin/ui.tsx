import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2, X } from 'lucide-react';
import { adminRequest } from '../db';
import type { StockUnit } from '../types';

export const units: Array<{ value: StockUnit; label: string }> = [
  { value: 'unid', label: 'Unidades' },
  { value: 'kg', label: 'Kilos (kg)' },
  { value: 'g', label: 'Gramos (g)' },
  { value: 'l', label: 'Litros (l)' },
  { value: 'ml', label: 'Mililitros (ml)' },
];

const quantityFormat = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

export function formatQuantity(value: number, unit?: StockUnit): string {
  return unit ? `${quantityFormat.format(value)} ${unit}` : quantityFormat.format(value);
}

/** Valor para un campo editable con coma decimal y sin separador de miles. */
export function numberInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).replace('.', ',');
}

interface ModalProps {
  title: string;
  eyebrow: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, eyebrow, icon, onClose, children, wide }: ModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal product-modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-topline"><span className="modal-symbol orange">{icon}</span><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

interface ConfirmDeleteProps {
  title: string;
  message: ReactNode;
  error: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDelete({ title, message, error, busy, onCancel, onConfirm }: ConfirmDeleteProps) {
  return (
    <Modal title={title} eyebrow="ELIMINAR" icon={<Trash2 size={19} />} onClose={onCancel}>
      <div className="modal-copy">{message}</div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="confirm-buttons"><button className="secondary-button" onClick={onCancel}>Cancelar</button><button className="modal-primary danger" onClick={onConfirm} disabled={busy}>{busy ? 'Eliminando…' : 'Sí, eliminar'} <Trash2 size={16} /></button></div>
    </Modal>
  );
}

/** Carga una lista de la API de administración y permite recargarla. */
export function useAdminList<T>(url: string, pin: string) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const result = await adminRequest<T[]>(url, 'GET', undefined, pin);
    setLoading(false);
    if (result.ok) {
      setItems(result.value);
      setError('');
    } else {
      setError(result.message);
    }
  }, [url, pin]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, setItems, error, loading, reload };
}
