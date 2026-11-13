import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Pencil, Plus, Receipt, Trash2, UserRound, Wallet } from 'lucide-react';
import { currency, parseMoney } from '../data';
import { adminRequest } from '../db';
import type { AccountKey, Expense, ExpenseSummary, Worker, WorkerPayment } from '../types';
import { accountLabels } from './PurchaseModal';
import { Modal, useAdminList } from './ui';

type Tab = 'GASTOS' | 'PERSONAL';

const FIXED_CATEGORIES = ['Alquiler', 'Luz', 'Agua', 'Gas', 'Internet', 'Teléfono', 'Impuestos', 'Contador', 'Seguro'];
const VARIABLE_CATEGORIES = ['Mantenimiento', 'Reparaciones', 'Limpieza', 'Bolsas y envases', 'Publicidad', 'Combustible', 'Transporte', 'Otros'];
const dayFormat = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' });
const formatDay = (iso: string) => dayFormat.format(new Date(`${iso}T12:00:00`));
const currentMonth = () => new Date().toISOString().slice(0, 7);

interface ExpenseDraft { kind: 'FIJO' | 'VARIABLE'; category: string; description: string; amount: string; paidOn: string; account: AccountKey }
interface WorkerDraft { id?: number; name: string; payType: 'DIA' | 'HORA'; rate: string; phone: string; active: boolean }
interface WorkDraft { workerId: number | ''; workedOn: string; units: string; paid: boolean; account: AccountKey; note: string }

export function ExpensesAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('GASTOS');
  const [month, setMonth] = useState(currentMonth());
  const { items: expenses, error: loadError, reload: reloadExpenses } = useAdminList<Expense>(`/api/expenses?month=${month}`, pin);
  const { items: workers, reload: reloadWorkers } = useAdminList<Worker>('/api/workers', pin);
  const { items: payments, reload: reloadPayments } = useAdminList<WorkerPayment>(`/api/worker-payments?month=${month}`, pin);
  const { items: pending, reload: reloadPending } = useAdminList<WorkerPayment>('/api/worker-payments?pending=true', pin);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [workerDraft, setWorkerDraft] = useState<WorkerDraft | null>(null);
  const [workDraft, setWorkDraft] = useState<WorkDraft | null>(null);
  const [payTarget, setPayTarget] = useState<{ payment: WorkerPayment; account: AccountKey } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSummary = useCallback(async () => {
    const result = await adminRequest<ExpenseSummary>(`/api/expenses/summary?month=${month}`, 'GET', undefined, pin);
    if (result.ok) setSummary(result.value);
  }, [month, pin]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  function refreshAll() {
    void reloadExpenses(); void reloadWorkers(); void reloadPayments(); void reloadPending(); void loadSummary();
  }

  async function send<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown, done: string, close: () => void) {
    setSaving(true);
    const result = await adminRequest<T>(url, method, body, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); onToast(result.message); return; }
    close();
    onToast(done);
    refreshAll();
  }

  function newExpense() {
    setError('');
    setExpenseDraft({ kind: 'FIJO', category: '', description: '', amount: '', paidOn: '', account: 'CAJA' });
  }

  async function saveExpense() {
    if (!expenseDraft) return;
    const amount = parseMoney(expenseDraft.amount);
    if (!expenseDraft.category.trim() || !(amount > 0)) { setError('Indica la categoría y un monto mayor a cero.'); return; }
    await send('/api/expenses', 'POST', { ...expenseDraft, amount, paidOn: expenseDraft.paidOn || null }, 'Gasto registrado', () => setExpenseDraft(null));
  }

  async function saveWorker() {
    if (!workerDraft) return;
    const rate = parseMoney(workerDraft.rate);
    if (!workerDraft.name.trim() || !(rate >= 0)) { setError('Escribe el nombre y una tarifa válida.'); return; }
    const { id, ...rest } = workerDraft;
    await send(id ? `/api/workers/${id}` : '/api/workers', id ? 'PUT' : 'POST', { ...rest, rate }, id ? 'Persona actualizada' : 'Persona agregada', () => setWorkerDraft(null));
  }

  async function saveWork() {
    if (!workDraft) return;
    const units = parseMoney(workDraft.units);
    if (workDraft.workerId === '' || !(units > 0)) { setError('Elige a la persona y cuántos días u horas trabajó.'); return; }
    await send('/api/worker-payments', 'POST', { ...workDraft, units, workedOn: workDraft.workedOn || null }, workDraft.paid ? 'Trabajo registrado y pagado' : 'Trabajo registrado (pago pendiente)', () => setWorkDraft(null));
  }

  const workerFor = (id: number | '') => workers.find((worker) => worker.id === id);
  const draftWorker = workDraft ? workerFor(workDraft.workerId) : undefined;
  const draftAmount = draftWorker && workDraft ? (parseMoney(workDraft.units) || 0) * draftWorker.rate : 0;
  const unitLabel = (type: 'DIA' | 'HORA', units: number) => `${units} ${type === 'DIA' ? (units === 1 ? 'día' : 'días') : (units === 1 ? 'hora' : 'horas')}`;

  const kpi = (label: string, value: number | undefined, tone = '') => <div><small>{label}</small><strong className={tone}>{currency.format(value ?? 0)}</strong></div>;

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> FINANZAS</p><h1>Gastos y personal</h1><p className="heading-sub">Gastos fijos y variables del local, y pago de las personas que trabajan por día o por hora.</p></div>
        <div className="heading-actions"><input type="month" className="text-input month-input" aria-label="Mes" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
          {tab === 'GASTOS' ? <button className="modal-primary menu-new-button" onClick={newExpense}><Plus size={16} /> Nuevo gasto</button>
            : <><button className="secondary-button" onClick={() => { setError(''); setWorkerDraft({ name: '', payType: 'DIA', rate: '', phone: '', active: true }); }}><UserRound size={15} /> Nueva persona</button>
              <button className="modal-primary menu-new-button" onClick={() => { setError(''); setWorkDraft({ workerId: workers.find((worker) => worker.active)?.id ?? '', workedOn: '', units: '', paid: false, account: 'CAJA', note: '' }); }}><Plus size={16} /> Registrar trabajo</button></>}
        </div></div>
      <div className="inventory-kpis">
        {kpi('GASTOS FIJOS', summary?.fixed)}{kpi('GASTOS VARIABLES', summary?.variable)}{kpi('PERSONAL PAGADO', summary?.staffPaid)}{kpi('PERSONAL PENDIENTE', summary?.staffPending, (summary?.staffPending ?? 0) > 0 ? 'negative' : '')}{kpi('COMPRAS DE MERCADERÍA', summary?.purchases)}{kpi('TOTAL DE SALIDAS', summary?.total)}
      </div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      <div className="category-tabs admin-tabs" role="tablist" aria-label="Secciones">
        <button role="tab" aria-selected={tab === 'GASTOS'} className={tab === 'GASTOS' ? 'selected' : ''} onClick={() => setTab('GASTOS')}>Gastos del local ({expenses.length})</button>
        <button role="tab" aria-selected={tab === 'PERSONAL'} className={tab === 'PERSONAL' ? 'selected' : ''} onClick={() => setTab('PERSONAL')}>Personal{pending.length > 0 ? ` · ${pending.length} por pagar` : ''}</button>
      </div>

      {tab === 'GASTOS' ? (
        expenses.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>FECHA</th><th>TIPO</th><th>CATEGORÍA</th><th>DETALLE</th><th>PAGADO CON</th><th className="align-right">MONTO</th><th /></tr></thead><tbody>
          {expenses.map((expense) => <tr key={expense.id}><td>{formatDay(expense.paidOn)}</td><td><span className={`sync-label ${expense.kind === 'FIJO' ? 'synced' : ''}`}>{expense.kind === 'FIJO' ? 'Fijo' : 'Variable'}</span></td><td><strong>{expense.category}</strong></td><td>{expense.description || '—'}</td><td>{accountLabels[expense.account]}</td><td className="align-right"><strong>{currency.format(expense.amount)}</strong></td>
            <td className="align-right row-actions"><button className="icon-button danger-button" aria-label={`Eliminar gasto ${expense.category}`} onClick={() => { if (window.confirm(`¿Eliminar el gasto "${expense.category}" de ${currency.format(expense.amount)}?`)) void send(`/api/expenses/${expense.id}`, 'DELETE', undefined, 'Gasto eliminado', () => undefined); }}><Trash2 size={15} /></button></td></tr>)}
        </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><Receipt size={25} /></span><strong>Sin gastos este mes</strong><span>Registra alquiler, luz, internet, reparaciones y otros gastos del local.</span></div>
      ) : (
        <>
          {pending.length > 0 && <div className="pending-box"><strong>Pagos pendientes</strong>{pending.map((payment) => <div key={payment.id} className="pending-row"><span>{payment.workerName} · {formatDay(payment.workedOn)} · {unitLabel(payment.payType, payment.units)}</span><strong>{currency.format(payment.amount)}</strong><button className="secondary-button" onClick={() => setPayTarget({ payment, account: 'CAJA' })}><Wallet size={14} /> Marcar pagado</button></div>)}</div>}
          <h3 className="section-title">Trabajo del mes</h3>
          {payments.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>FECHA</th><th>PERSONA</th><th>TRABAJO</th><th className="align-right">TARIFA</th><th>ESTADO</th><th className="align-right">MONTO</th><th /></tr></thead><tbody>
            {payments.map((payment) => <tr key={payment.id}><td>{formatDay(payment.workedOn)}</td><td><strong>{payment.workerName}</strong></td><td>{unitLabel(payment.payType, payment.units)}</td><td className="align-right">{currency.format(payment.rate)} / {payment.payType === 'DIA' ? 'día' : 'hora'}</td><td>{payment.pending ? <span className="sync-label low-label">Pendiente</span> : <span className="sync-label synced">Pagado {payment.paidOn ? formatDay(payment.paidOn) : ''}{payment.account ? ` · ${accountLabels[payment.account]}` : ''}</span>}</td><td className="align-right"><strong>{currency.format(payment.amount)}</strong></td>
              <td className="align-right row-actions"><button className="icon-button danger-button" aria-label={`Eliminar registro de ${payment.workerName}`} onClick={() => { if (window.confirm('¿Eliminar este registro de trabajo?')) void send(`/api/worker-payments/${payment.id}`, 'DELETE', undefined, 'Registro eliminado', () => undefined); }}><Trash2 size={15} /></button></td></tr>)}
          </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><UserRound size={25} /></span><strong>Sin trabajo registrado este mes</strong><span>{workers.length ? 'Usa «Registrar trabajo» para anotar días u horas.' : 'Primero agrega a las personas con «Nueva persona».'}</span></div>}
          <h3 className="section-title">Personas</h3>
          {workers.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>NOMBRE</th><th>PAGO</th><th className="align-right">TARIFA</th><th>TELÉFONO</th><th /></tr></thead><tbody>
            {workers.map((worker) => <tr key={worker.id} className={worker.active ? '' : 'is-hidden'}><td><strong>{worker.name}</strong></td><td>{worker.payType === 'DIA' ? 'Por día' : 'Por hora'}</td><td className="align-right">{currency.format(worker.rate)} / {worker.payType === 'DIA' ? 'día' : 'hora'}</td><td>{worker.phone || '—'}</td>
              <td className="align-right row-actions"><button className="icon-button" aria-label={`Editar ${worker.name}`} onClick={() => { setError(''); setWorkerDraft({ id: worker.id, name: worker.name, payType: worker.payType, rate: String(worker.rate).replace('.', ','), phone: worker.phone, active: worker.active }); }}><Pencil size={15} /></button>{' '}
                <button className="icon-button danger-button" aria-label={`Eliminar ${worker.name}`} onClick={() => { if (window.confirm(`¿Eliminar a ${worker.name}? Sus pagos anteriores se conservan.`)) void send(`/api/workers/${worker.id}`, 'DELETE', undefined, 'Persona eliminada', () => undefined); }}><Trash2 size={15} /></button></td></tr>)}
          </tbody></table></div> : <p className="muted">Todavía no hay personas cargadas.</p>}
        </>
      )}

      {expenseDraft && <Modal title="Nuevo gasto" eyebrow="GASTOS DEL LOCAL" icon={<Receipt size={19} />} onClose={() => setExpenseDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void saveExpense(); }}>
          <span className="field-label">Tipo</span>
          <div className="method-options" role="group" aria-label="Tipo de gasto">{(['FIJO', 'VARIABLE'] as const).map((kind) => <button type="button" key={kind} className={expenseDraft.kind === kind ? 'selected' : ''} aria-pressed={expenseDraft.kind === kind} onClick={() => setExpenseDraft({ ...expenseDraft, kind, category: '' })}>{kind === 'FIJO' ? 'Fijo (se repite cada mes)' : 'Variable (cambia o es ocasional)'}</button>)}</div>
          <label className="field-label" htmlFor="exp-category">Categoría</label>
          <input id="exp-category" className="text-input" list="exp-categories" maxLength={40} autoFocus value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })} placeholder="Elige o escribe una" />
          <datalist id="exp-categories">{(expenseDraft.kind === 'FIJO' ? FIXED_CATEGORIES : VARIABLE_CATEGORIES).map((category) => <option key={category} value={category} />)}</datalist>
          <label className="field-label" htmlFor="exp-desc">Detalle <span>opcional</span></label>
          <input id="exp-desc" className="text-input" maxLength={120} value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} placeholder="Ej. Factura de octubre" />
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="exp-amount">Monto</label><div className="money-input"><span>R$</span><input id="exp-amount" type="text" inputMode="decimal" autoComplete="off" value={expenseDraft.amount} onChange={(event) => setExpenseDraft({ ...expenseDraft, amount: event.target.value })} placeholder="0,00" /></div></div>
            <div><label className="field-label" htmlFor="exp-date">Fecha <span>vacío = hoy</span></label><input id="exp-date" className="text-input" type="date" value={expenseDraft.paidOn} onChange={(event) => setExpenseDraft({ ...expenseDraft, paidOn: event.target.value })} /></div>
          </div>
          <label className="field-label" htmlFor="exp-account">Pagado con</label>
          <select id="exp-account" className="text-input" value={expenseDraft.account} onChange={(event) => setExpenseDraft({ ...expenseDraft, account: event.target.value as AccountKey })}>{(Object.keys(accountLabels) as AccountKey[]).map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar gasto'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {workerDraft && <Modal title={workerDraft.id ? 'Editar persona' : 'Nueva persona'} eyebrow="PERSONAL" icon={<UserRound size={19} />} onClose={() => setWorkerDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void saveWorker(); }}>
          <label className="field-label" htmlFor="wk-name">Nombre</label>
          <input id="wk-name" className="text-input" autoFocus maxLength={100} value={workerDraft.name} onChange={(event) => setWorkerDraft({ ...workerDraft, name: event.target.value })} />
          <span className="field-label">Forma de pago</span>
          <div className="method-options" role="group" aria-label="Forma de pago">{(['DIA', 'HORA'] as const).map((type) => <button type="button" key={type} className={workerDraft.payType === type ? 'selected' : ''} aria-pressed={workerDraft.payType === type} onClick={() => setWorkerDraft({ ...workerDraft, payType: type })}>{type === 'DIA' ? 'Por día' : 'Por hora'}</button>)}</div>
          <label className="field-label" htmlFor="wk-rate">Tarifa <span>por {workerDraft.payType === 'DIA' ? 'día' : 'hora'}</span></label>
          <div className="money-input"><span>R$</span><input id="wk-rate" type="text" inputMode="decimal" autoComplete="off" value={workerDraft.rate} onChange={(event) => setWorkerDraft({ ...workerDraft, rate: event.target.value })} placeholder="0,00" /></div>
          <label className="field-label" htmlFor="wk-phone">Teléfono <span>opcional</span></label>
          <input id="wk-phone" className="text-input" maxLength={40} value={workerDraft.phone} onChange={(event) => setWorkerDraft({ ...workerDraft, phone: event.target.value })} />
          <label className="availability-toggle"><input type="checkbox" checked={workerDraft.active} onChange={(event) => setWorkerDraft({ ...workerDraft, active: event.target.checked })} /><span><strong>Activo</strong><small>Los inactivos no aparecen al registrar trabajo.</small></span></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar persona'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {workDraft && <Modal title="Registrar trabajo" eyebrow="PERSONAL" icon={<Wallet size={19} />} onClose={() => setWorkDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void saveWork(); }}>
          <label className="field-label" htmlFor="work-person">Persona</label>
          <select id="work-person" className="text-input" value={workDraft.workerId} onChange={(event) => setWorkDraft({ ...workDraft, workerId: event.target.value ? Number(event.target.value) : '' })}>
            <option value="">Elegir…</option>{workers.filter((worker) => worker.active).map((worker) => <option key={worker.id} value={worker.id}>{worker.name} ({currency.format(worker.rate)} / {worker.payType === 'DIA' ? 'día' : 'hora'})</option>)}
          </select>
          <div className="product-form-row">
            <div><label className="field-label" htmlFor="work-units">{draftWorker?.payType === 'HORA' ? 'Horas trabajadas' : 'Días trabajados'}</label><input id="work-units" className="text-input" type="text" inputMode="decimal" autoComplete="off" value={workDraft.units} onChange={(event) => setWorkDraft({ ...workDraft, units: event.target.value })} placeholder={draftWorker?.payType === 'HORA' ? 'Ej. 6' : 'Ej. 1'} /></div>
            <div><label className="field-label" htmlFor="work-date">Fecha <span>vacío = hoy</span></label><input id="work-date" className="text-input" type="date" value={workDraft.workedOn} onChange={(event) => setWorkDraft({ ...workDraft, workedOn: event.target.value })} /></div>
          </div>
          <div className="denom-total"><span>A pagar</span><strong>{currency.format(draftAmount)}</strong></div>
          <label className="availability-toggle"><input type="checkbox" checked={workDraft.paid} onChange={(event) => setWorkDraft({ ...workDraft, paid: event.target.checked })} /><span><strong>Ya se pagó</strong><small>Si no, queda como pendiente hasta marcarlo pagado.</small></span></label>
          {workDraft.paid && <><label className="field-label" htmlFor="work-account">Pagado con</label><select id="work-account" className="text-input" value={workDraft.account} onChange={(event) => setWorkDraft({ ...workDraft, account: event.target.value as AccountKey })}>{(Object.keys(accountLabels) as AccountKey[]).map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select></>}
          <label className="field-label" htmlFor="work-note">Nota <span>opcional</span></label>
          <input id="work-note" className="text-input" maxLength={200} value={workDraft.note} onChange={(event) => setWorkDraft({ ...workDraft, note: event.target.value })} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Registrar'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}

      {payTarget && <Modal title="Marcar como pagado" eyebrow={payTarget.payment.workerName.toUpperCase()} icon={<Wallet size={19} />} onClose={() => setPayTarget(null)}>
        <p className="modal-copy">{formatDay(payTarget.payment.workedOn)} · {unitLabel(payTarget.payment.payType, payTarget.payment.units)} · <strong>{currency.format(payTarget.payment.amount)}</strong></p>
        <label className="field-label" htmlFor="pay-account">Pagado con</label>
        <select id="pay-account" className="text-input" value={payTarget.account} onChange={(event) => setPayTarget({ ...payTarget, account: event.target.value as AccountKey })}>{(Object.keys(accountLabels) as AccountKey[]).map((key) => <option key={key} value={key}>{accountLabels[key]}</option>)}</select>
        <button className="modal-primary" disabled={saving} onClick={() => void send(`/api/worker-payments/${payTarget.payment.id}/pay`, 'PUT', { account: payTarget.account }, 'Pago registrado', () => setPayTarget(null))}>Confirmar pago <CheckCircle2 size={18} /></button>
      </Modal>}
    </section>
  );
}
