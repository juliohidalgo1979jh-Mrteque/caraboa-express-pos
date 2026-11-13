import { currency } from './data';

/** Billetes y monedas del real brasileño. */
export const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05];

export type Breakdown = Record<string, number>;

export function breakdownTotal(breakdown: Breakdown): number {
  const cents = Object.entries(breakdown).reduce((sum, [value, count]) => sum + Math.round(Number(value) * 100) * count, 0);
  return cents / 100;
}

/** Quita las denominaciones en cero para guardar solo lo que se contó. */
export function cleanBreakdown(breakdown: Breakdown): Breakdown {
  return Object.fromEntries(Object.entries(breakdown).filter(([, count]) => count > 0));
}

const label = (value: number) => (value >= 1 ? `R$ ${value}` : `${Math.round(value * 100)} centavos`);

interface DenominationsProps {
  value: Breakdown;
  onChange: (value: Breakdown) => void;
}

export function Denominations({ value, onChange }: DenominationsProps) {
  return (
    <div className="denominations">
      <div className="denom-grid">
        {DENOMINATIONS.map((denomination) => {
          const key = String(denomination);
          const count = value[key] ?? 0;
          return (
            <label key={key} className={`denom-row ${count > 0 ? 'filled' : ''}`}>
              <span className="denom-name">{label(denomination)}</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                aria-label={`Cantidad de ${label(denomination)}`}
                value={count === 0 ? '' : String(count)}
                placeholder="0"
                onChange={(event) => {
                  const parsed = Math.min(99999, Math.max(0, parseInt(event.target.value.replace(/\D/g, ''), 10) || 0));
                  onChange({ ...value, [key]: parsed });
                }}
              />
              <span className="denom-sub">{count > 0 ? currency.format(denomination * count) : ''}</span>
            </label>
          );
        })}
      </div>
      <div className="denom-total"><span>Total contado</span><strong>{currency.format(breakdownTotal(value))}</strong></div>
    </div>
  );
}
