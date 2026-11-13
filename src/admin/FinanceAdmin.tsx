import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Landmark, ListChecks, Settings2, TrendingDown, TrendingUp } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import { Denominations, breakdownTotal, cleanBreakdown } from '../Denominations';
import type { Breakdown } from '../Denominations';
import type { AccountAudit, AccountKey, AccountMovement, FinanceOverview, ShiftClosing } from '../types';
import { accountLabels } from './PurchaseModal';
import { Modal } from './ui';

type Tab = 'CUENTAS' | 'ARQUEOS' | 'CIERRES';
type Dialog = 'TRANSFER' | 'INGRESO' | 'RETIRO' | 'OPENING' | 'AUDIT' | null;

const ACCOUNT_KEYS = Object.keys(accountLabels) as AccountKey[];
const kindLabels: Record<AccountMovement['kind'], string> = { TRANSFERENCIA: 'Transferencia', INGRESO: 'Ingreso', RETIRO: 'Retiro', AJUSTE_ARQUEO: 'Ajuste de arqueo' };
const dateTime = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' });
const formatDay = (iso: string) => dayFormat.format(new Date(`${iso}T12:00:00`));
const denomText = (key: string) => `R$ ${Number(key).toString().replace('.', ',')}`;

function BreakdownText({ value }: { value: Record<string, number> | null }) {
  if (!value) return <span className="muted">—</span>;
  const keys = Object.keys(value).sort((a, b) => Number(b) - Number(a));
  return <span className="breakdown-text">{keys.map((key) => `${value[key]}× ${denomText(key)}`).join(' · ')}</span>;
}

export function FinanceAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('CUENTAS');
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [movements, setMovements] = useState<AccountMovement[]>([]);
  const [audits, setAudits] = useState<AccountAudit[]>([]);
  const [shifts, setShifts] = useState<ShiftClosing[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [account, setAccount] = useState<AccountKey>('CAJA');
  const [target, setTarget] = useState<AccountKey>('BANCO');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [movedOn, setMovedOn] = useState('');
  const [startDate, setStartDate] = useState('');
  const [initial, setInitial] = useState<Record<AccountKey, string>>({ CAJA: '', BANCO: '', MERCADOPAGO: '' });
  const [counts, setCounts] = useState<Breakdown>({});
  const [counted, setCounted] = useState('');

  const load = useCallback(async () => {
    const [a, m, u, s] = await Promise.all([
      adminRequest<FinanceOverview>('/api/finance/accounts', 'GET', undefined, pin),
      adminRequest<AccountMovement[]>('/api/finance/movements', 'GET', undefined, pin),
      adminRequest<AccountAudit[]>('/api/finance/audits', 'GET', undefined, pin),
      adminRequest<ShiftClosing[]>('/api/finance/shifts', 'GET', undefined, pin),
    ]);
    if (!a.ok) { setLoadError(a.message); return; }
    setLoadError('');
    setOverview(a.value);
    if (m.ok) setMovements(m.value);
    if (u.ok) setAudits(u.value);
    if (s.ok) setShifts(s.value);
  }, [pin]);
  useEffect(() => { void load(); }, [load]);

  function open(kind: Exclude<Dialog, null>, preset?: AccountKey) {
    setError(''); setAmount(''); setNote(''); setMovedOn(''); setCounts({}); setCounted('');
    if (preset) setAccount(preset);
    if (kind === 'OPENING' && overview) {
      setStartDate(overview.start ?? new Date().toISOString().slice(0, 10));
      setInitial(Object.fromEntries(overview.accounts.map((item) => [item.key, item.initial ? String(item.initial).replace('.', ',') : ''])) as Record<AccountKey, string>);
    }
    setDialog(kind);
  }

  async function send<T>(url: string, method: 'POST' | 'PUT', body: unknown, done: string) {
    setSaving(true);
    const result = await adminRequest<T>(url, method, body, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return null; }
    setDialog(null);
    onToast(done);
    void load();
    return result.value;
  }

  async function submitMove() {
    const value = parseMoney(amount);
    if (!(value > 0)) { setError('Indica un monto mayor a cero.'); return; }
    const date = movedOn || undefined;
    if (dialog === 'TRANSFER') await send('/api/finance/transfers', 'POST', { from: account, to: target, amount: value, movedOn: date, note }, 'Transferencia registrada');
    else await send('/api/finance/flows', 'POST', { account, kind: dialog, amount: value, movedOn: date, note }, dialog === 'INGRESO' ? 'Ingreso registrado' : 'Retiro registrado');
  }

  async function submitOpening() {
    if (!startDate) { setError('Indica desde qué fecha se controla el dinero.'); return; }
    const balances = Object.fromEntries(ACCOUNT_KEYS.map((key) => [key, parseMoney(initial[key]) || 0]));
    await send('/api/finance/opening', 'PUT', { start: startDate, balances }, 'Saldos iniciales guardados');
  }

  const cashAudit = dialog === 'AUDIT' && account === 'CAJA';
  const countedValue = cashAudit ? breakdownTotal(counts) : parseMoney(counted);
  const expected = overview?.accounts.find((item) => item.key === account)?.balance ?? 0;

  async function submitAudit() {
    if (!cashAudit && counted.trim() === '') { setError('Indica cuánto hay realmente en la cuenta.'); return; }
    const result = await send<{ difference: number }>('/api/finance/audits', 'POST', { account, counted: countedValue, breakdown: cashAudit ? cleanBreakdown(counts) : undefined, note }, 'Arqueo guardado');
    if (result && result.difference !== 0) onToast(`Arqueo guardado · ${result.difference > 0 ? 'sobrante' : 'faltante'} de ${currency.format(Math.abs(result.difference))}`);
  }

  const diffClass = (value: number | null) => (value === null || value === 0 ? '' : value > 0 ? 'positive' : 'negative');
  const configured = overview?.start != null;

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> FINANZAS</p><h1>Finanzas</h1><p className="heading-sub">Cuánto dinero hay en la caja y en cada cuenta, arqueos y cierres de caja.</p></div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={() => open('OPENING')}><Settings2 size={16} /> Saldos iniciales</button>
          <button className="modal-primary menu-new-button" onClick={() => open('AUDIT', 'CAJA')}><ListChecks size={16} /> Hacer arqueo</button>
        </div></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {overview && !configured && <p className="pending-box">Aún no hay saldos iniciales. Toca «Saldos iniciales» e indica cuánto dinero hay hoy en cada cuenta para empezar a controlarlas (solo el administrador).</p>}

      <div className="account-cards">
        {overview?.accounts.map((item) => (
          <article key={item.key} className="account-card" data-account={item.key}>
            <header><Landmark size={16} /><span>{item.label}</span></header>
            <strong className={item.balance < 0 ? 'negative' : ''}>{currency.format(item.balance)}</strong>
            <dl>
              <div><dt>Saldo inicial</dt><dd>{currency.format(item.initial)}</dd></div>
              <div><dt>Ventas cobradas</dt><dd>+ {currency.format(item.sales)}</dd></div>
              <div><dt>Compras, gastos y personal</dt><dd>− {currency.format(item.purchases + item.expenses + item.staff)}</dd></div>
              <div><dt>Movimientos manuales</dt><dd>{item.movements < 0 ? '− ' : '+ '}{currency.format(Math.abs(item.movements))}</dd></div>
            </dl>
            <button className="secondary-button" onClick={() => open('AUDIT', item.key)}>Arqueo</button>
          </article>
        ))}
        {overview && <article className="account-card total"><header><Landmark size={16} /><span>Total de dinero</span></header><strong>{currency.format(overview.total)}</strong><small className="muted">Suma de las tres cuentas{overview.start ? ` desde ${formatDay(overview.start)}` : ''}</small></article>}
      </div>

      <div className="finance-actions">
        <button className="secondary-button" onClick={() => open('TRANSFER', 'CAJA')}><ArrowLeftRight size={15} /> Transferir entre cuentas</button>
        <button className="secondary-button" onClick={() => open('INGRESO', 'CAJA')}><TrendingUp size={15} /> Ingreso de dinero</button>
        <button className="secondary-button" onClick={() => open('RETIRO', 'CAJA')}><TrendingDown size={15} /> Retiro de dinero</button>
      </div>

      <div className="category-tabs admin-tabs" role="tablist" aria-label="Secciones">
        <button role="tab" aria-selected={tab === 'CUENTAS'} className={tab === 'CUENTAS' ? 'selected' : ''} onClick={() => setTab('CUENTAS')}>Movimientos ({movements.length})</button>
        <button role="tab" aria-selected={tab === 'ARQUEOS'} className={tab === 'ARQUEOS' ? 'selected' : ''} onClick={() => setTab('ARQUEOS')}>Arqueos ({audits.length})</button>
        <button role="tab" aria-selected={tab === 'CIERRES'} className={tab === 'CIERRES' ? 'selected' : ''} onClick={() => setTab('CIERRES')}>Cierres de caja ({shifts.length})</button>
      </div>

      {tab === 'CUENTAS' && (movements.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>FECHA</th><th>TIPO</th><th>CUENTA</th><th>DETALLE</th><th className="align-right">MONTO</th></tr></thead><tbody>
        {movements.map((m) => <tr key={m.id}><td>{formatDay(m.movedOn)}</td><td>{kindLabels[m.kind]}</td><td>{accountLabels[m.account]}</td><td>{m.note || '—'}</td><td className={`align-right ${m.amount < 0 ? 'negative' : 'positive'}`}>{m.amount < 0 ? '− ' : '+ '}{currency.format(Math.abs(m.amount))}</td></tr>)}
      </tbody></table></div> : <p className="muted">Aún no hay transferencias, ingresos ni retiros manuales. Las ventas, compras, gastos y pagos al personal se suman solos.</p>)}

      {tab === 'ARQUEOS' && (audits.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>FECHA</th><th>CUENTA</th><th className="align-right">ESPERADO</th><th className="align-right">CONTADO</th><th className="align-right">DIFERENCIA</th><th>DETALLE</th></tr></thead><tbody>
        {audits.map((a) => <tr key={a.id}><td>{dateTime.format(new Date(a.createdAt))}</td><td>{accountLabels[a.account]}</td><td className="align-right">{currency.format(a.expected)}</td><td className="align-right">{currency.format(a.counted)}</td>
          <td className={`align-right ${diffClass(a.difference)}`}>{a.difference === 0 ? 'Cuadra' : `${a.difference > 0 ? '+' : '−'} ${currency.format(Math.abs(a.difference))}`}</td><td><BreakdownText value={a.breakdown} />{a.note ? <small className="muted"> {a.note}</small> : null}</td></tr>)}
      </tbody></table></div> : <p className="muted">Todavía no se hizo ningún arqueo. Cuenta el dinero real y compáralo con lo que el sistema espera.</p>)}

      {tab === 'CIERRES' && (shifts.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>TURNO</th><th className="align-right">APERTURA</th><th className="align-right">VENTAS EN EFECTIVO</th><th className="align-right">ESPERADO</th><th className="align-right">CONTADO AL CERRAR</th><th className="align-right">DIFERENCIA</th></tr></thead><tbody>
        {shifts.map((s) => <tr key={s.id}><td><strong>{s.point}</strong><br /><small className="muted">{dateTime.format(new Date(s.openedAt))}{s.closedAt ? ` → ${dateTime.format(new Date(s.closedAt))}` : ' · abierto'}</small></td>
          <td className="align-right">{currency.format(s.openingCash)}<br /><small><BreakdownText value={s.openingBreakdown} /></small></td>
          <td className="align-right">{currency.format(s.cashSales)}</td><td className="align-right">{currency.format(s.expectedCash)}</td>
          <td className="align-right">{s.closingCash === null ? '—' : currency.format(s.closingCash)}<br /><small><BreakdownText value={s.closingBreakdown} /></small></td>
          <td className={`align-right ${diffClass(s.difference)}`}>{s.difference === null ? '—' : s.difference === 0 ? 'Cuadra' : `${s.difference > 0 ? '+' : '−'} ${currency.format(Math.abs(s.difference))}`}</td></tr>)}
      </tbody></table></div> : <p className="muted">Aún no hay turnos de caja.</p>)}

      {(dialog === 'TRANSFER' || dialog === 'INGRESO' || dialog === 'RETIRO') && <Modal title={dialog === 'TRANSFER' ? 'Transferir entre cuentas' : dialog === 'INGRESO' ? 'Ingreso de dinero' : 'Retiro de dinero'} eyebrow="FINANZAS" icon={<ArrowLeftRight size={19} />} onClose={() => setDialog(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void submitMove(); }}>
          <label className="field-label" htmlFor="fin-account">{dialog === 'TRANSFER' ? 'Sale de' : 'Cuenta'}</label>
          <select id="fin-account" className="text-input" value={account} onChange={(event) => setAccount(event.target.value as AccountKey)}>{ACCOUNT_KEYS.map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select>
          {dialog === 'TRANSFER' && <><label className="field-label" htmlFor="fin-target">Entra a</label>
            <select id="fin-target" className="text-input" value={target} onChange={(event) => setTarget(event.target.value as AccountKey)}>{ACCOUNT_KEYS.map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select></>}
          <div className="form-grid-2">
            <div><label className="field-label" htmlFor="fin-amount">Monto</label><div className="money-input"><span>R$</span><input id="fin-amount" type="text" inputMode="decimal" autoComplete="off" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></div></div>
            <div><label className="field-label" htmlFor="fin-date">Fecha <span>vacío = hoy</span></label><input id="fin-date" className="text-input" type="date" value={movedOn} onChange={(event) => setMovedOn(event.target.value)} /></div>
          </div>
          <label className="field-label" htmlFor="fin-note">Detalle <span>opcional</span></label>
          <input id="fin-note" className="text-input" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder={dialog === 'TRANSFER' ? 'Ej.: depósito en el banco' : dialog === 'INGRESO' ? 'Ej.: aporte del dueño' : 'Ej.: retiro del dueño'} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {dialog === 'OPENING' && <Modal title="Saldos iniciales" eyebrow="SOLO ADMINISTRADOR" icon={<Settings2 size={19} />} onClose={() => setDialog(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void submitOpening(); }}>
          <p className="muted">Indica cuánto dinero hay hoy en cada cuenta. El sistema suma y resta desde esta fecha en adelante.</p>
          <label className="field-label" htmlFor="fin-start">Controlar desde</label>
          <input id="fin-start" className="text-input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          {ACCOUNT_KEYS.map((key) => <div key={key}><label className="field-label" htmlFor={`fin-init-${key}`}>{accountLabels[key]}</label>
            <div className="money-input"><span>R$</span><input id={`fin-init-${key}`} type="text" inputMode="decimal" autoComplete="off" value={initial[key]} onChange={(event) => setInitial({ ...initial, [key]: event.target.value })} placeholder="0,00" /></div></div>)}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar saldos'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {dialog === 'AUDIT' && <Modal title="Arqueo de cuenta" eyebrow="FINANZAS" icon={<ListChecks size={19} />} onClose={() => setDialog(null)} wide>
        <form onSubmit={(event) => { event.preventDefault(); void submitAudit(); }}>
          <label className="field-label" htmlFor="aud-account">Cuenta</label>
          <select id="aud-account" className="text-input" value={account} onChange={(event) => { setAccount(event.target.value as AccountKey); setCounts({}); setCounted(''); }}>{ACCOUNT_KEYS.map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select>
          <p className="audit-expected">El sistema espera: <strong>{currency.format(expected)}</strong></p>
          {cashAudit
            ? <><span className="field-label">Cuenta el efectivo por denominación</span><Denominations value={counts} onChange={setCounts} /><p className="audit-expected">Contado: <strong>{currency.format(countedValue)}</strong></p></>
            : <><label className="field-label" htmlFor="aud-counted">Saldo real según el banco / app</label><div className="money-input"><span>R$</span><input id="aud-counted" type="text" inputMode="decimal" autoComplete="off" value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0,00" /></div></>}
          {(cashAudit ? Object.values(counts).some((n) => n > 0) : counted.trim() !== '') && (() => { const diff = Math.round((countedValue - expected) * 100) / 100; return <p className={`audit-diff ${diffClass(diff)}`}>{diff === 0 ? 'Cuadra exacto' : diff > 0 ? `Sobran ${currency.format(diff)}` : `Faltan ${currency.format(-diff)}`}</p>; })()}
          <label className="field-label" htmlFor="aud-note">Observación <span>opcional</span></label>
          <input id="aud-note" className="text-input" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar arqueo'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
    </section>
  );
}

