import { useCallback, useEffect, useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { currency, todayInArgentina } from '../data';
import { adminDownload, adminRequest } from '../db';
import type { DailyReport, PointOfSale } from '../types';

export function ReportsAdmin({ pin, points }: { pin: string; points: PointOfSale[] }) {
  const [day, setDay] = useState(todayInArgentina);
  const [pointId, setPointId] = useState<number | null>(null);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const query = `date=${day}${pointId ? `&point_id=${pointId}` : ''}`;

  const load = useCallback(async () => {
    const result = await adminRequest<DailyReport>(`/api/reports/daily?${query}`, 'GET', undefined, pin);
    if (result.ok) {
      setReport(result.value);
      setError('');
    } else {
      setError(result.message);
    }
  }, [query, pin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(url: string, filename: string, key: string) {
    setDownloading(key);
    const failure = await adminDownload(url, filename, pin);
    setDownloading(null);
    setError(failure ?? '');
  }

  const breakdown = (title: string, rows: DailyReport['byPoint']) => (
    <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>{title}</th><th className="align-right">VENTAS</th><th className="align-right">TOTAL</th></tr></thead><tbody>
      {rows.length ? rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td className="align-right">{row.count}</td><td className="align-right"><strong>{currency.format(row.total)}</strong></td></tr>)
        : <tr><td colSpan={3}>Sin ventas</td></tr>}
    </tbody></table></div>
  );

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> REPORTES</p><h1>Reportes de ventas</h1><p className="heading-sub">Ventas por día, por turno y por punto de venta, en horario de Santa Catarina. Incluye las ventas ya sincronizadas.</p></div>
        <button className="modal-primary menu-new-button" disabled={downloading !== null} onClick={() => void download(`/api/reports/daily.pdf?${query}`, `ventas-${day}.pdf`, 'day')}><FileDown size={16} /> {downloading === 'day' ? 'Generando…' : 'PDF del día'}</button></div>

      <div className="report-filters">
        <div><label className="field-label" htmlFor="report-day">Día</label><input id="report-day" className="text-input" type="date" value={day} max={todayInArgentina()} onChange={(event) => event.target.value && setDay(event.target.value)} /></div>
        <div><label className="field-label" htmlFor="report-point">Punto de venta</label><select id="report-point" className="text-input" value={pointId ?? ''} onChange={(event) => setPointId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">Todos los puntos</option>
          {points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}
        </select></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {report && <>
        <div className="report-cards">
          <div><small>VENTAS</small><strong>{report.salesCount}</strong></div>
          <div><small>TOTAL VENDIDO</small><strong>{currency.format(report.total)}</strong></div>
          <div><small>TICKET PROMEDIO</small><strong>{currency.format(report.averageTicket)}</strong></div>
          <div><small>GANANCIA BRUTA</small><strong>{report.grossProfit !== null ? currency.format(report.grossProfit) : '—'}</strong>{report.grossProfit !== null && <span>costo {currency.format(report.cost)}</span>}</div>
        </div>
        <div className="report-grid">{breakdown('PUNTO DE VENTA', report.byPoint)}{breakdown('MEDIO DE PAGO', report.byMethod)}</div>

        <h2 className="report-title">Turnos del día</h2>
        <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PUNTO</th><th>HORARIO</th><th className="align-right">ESPERADO</th><th className="align-right">CONTADO</th><th className="align-right">DIFERENCIA</th><th className="align-right">VENDIDO</th><th /></tr></thead><tbody>
          {report.shifts.length ? report.shifts.map((shift) => <tr key={shift.id}>
            <td><strong>{shift.point}</strong></td><td>{shift.openedAt}–{shift.closedAt ?? 'abierto'}</td>
            <td className="align-right">{currency.format(shift.expectedCash)}</td>
            <td className="align-right">{shift.closingCash !== null ? currency.format(shift.closingCash) : '—'}</td>
            <td className={`align-right ${shift.difference !== null && shift.difference < 0 ? 'negative' : ''}`}>{shift.difference !== null ? currency.format(shift.difference) : '—'}</td>
            <td className="align-right"><strong>{currency.format(shift.total)}</strong></td>
            <td className="align-right"><button className="secondary-button" disabled={downloading !== null} onClick={() => void download(`/api/reports/shift/${shift.id}.pdf`, `turno-${shift.id}.pdf`, `shift-${shift.id}`)}><FileText size={14} /> {downloading === `shift-${shift.id}` ? 'Generando…' : 'PDF'}</button></td>
          </tr>) : <tr><td colSpan={7}>No se abrieron turnos este día.</td></tr>}
        </tbody></table></div>

        <h2 className="report-title">Productos vendidos</h2>
        <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PRODUCTO</th><th className="align-right">CANTIDAD</th><th className="align-right">TOTAL</th></tr></thead><tbody>
          {report.products.length ? report.products.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td className="align-right">{row.quantity}</td><td className="align-right">{currency.format(row.total)}</td></tr>)
            : <tr><td colSpan={3}>Sin ventas</td></tr>}
        </tbody></table></div>
      </>}
    </section>
  );
}
