import { useEffect } from 'react';
import { ChefHat, CloudOff, Pause, Play, Printer } from 'lucide-react';
import type { KitchenStation } from './kitchen';

export function KitchenScreen({ station }: { station: KitchenStation }) {
  const { refreshRecent } = station;
  useEffect(() => {
    void refreshRecent();
    const interval = window.setInterval(() => void refreshRecent(), 10000);
    return () => window.clearInterval(interval);
  }, [refreshRecent]);

  const since = station.since ? new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(station.since)) : '';

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">OPERACIÓN <span>·</span> IMPRESORA DE COCINA</p><h1>Comandas</h1><p className="heading-sub">Activa la estación en la laptop que tiene la impresora térmica. Imprime sola la comanda de cada pedido nuevo, de todos los puntos de venta, aunque estés cobrando en otra pantalla.</p></div>
        <button className="secondary-button" onClick={() => void station.testPrint()}><Printer size={15} /> Imprimir prueba</button></div>

      <div className={`station-card ${station.enabled ? 'is-on' : ''}`}>
        <span className="station-icon"><ChefHat size={24} /></span>
        <div><strong>{station.enabled ? 'Estación activa' : 'Estación pausada'}</strong>
          <small>{station.enabled ? `Imprimiendo los pedidos que llegan desde las ${since}. Revisa cada 4 segundos.` : 'Este dispositivo no está imprimiendo comandas.'}</small></div>
        {station.enabled
          ? <button className="secondary-button" onClick={station.disable}><Pause size={15} /> Pausar</button>
          : <button className="modal-primary menu-new-button" onClick={() => void station.enable()}><Play size={15} /> Activar en este dispositivo</button>}
      </div>
      {station.error && <div className="menu-offline"><CloudOff size={15} /> {station.error}</div>}

      <h2 className="report-title">Últimos pedidos</h2>
      <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>PEDIDO</th><th>HORA</th><th>PUNTO</th><th>PRODUCTOS</th><th>COMANDA</th><th /></tr></thead><tbody>
        {station.recent.length ? station.recent.map((comanda) => <tr key={comanda.id}>
          <td><strong>{comanda.orderCode}</strong></td><td>{comanda.time}</td><td>{comanda.point}</td>
          <td className="comanda-items">{comanda.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</td>
          <td><span className={`sync-label ${comanda.printedAt ? 'synced' : ''}`}>{comanda.printedAt ? `Impresa ${comanda.printedAt}` : 'Sin imprimir'}</span></td>
          <td className="align-right"><button className="secondary-button" onClick={() => void station.reprint(comanda)}><Printer size={14} /> {comanda.printedAt ? 'Reimprimir' : 'Imprimir'}</button></td>
        </tr>) : <tr><td colSpan={6}>Todavía no hay pedidos.</td></tr>}
      </tbody></table></div>

      <details className="station-help">
        <summary>Cómo dejar la impresión automática, sin que pregunte cada vez</summary>
        <ol>
          <li>Conecta la impresora térmica a la laptop y en Windows ponla como <strong>impresora predeterminada</strong> (Configuración → Impresoras → la térmica → Establecer como predeterminada). Papel de 80 mm.</li>
          <li>Crea un acceso directo de Chrome solo para esto: clic derecho en el escritorio → Nuevo → Acceso directo, y en la ubicación pega:<br /><code>"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing {window.location.origin}</code></li>
          <li>Cierra todas las ventanas de Chrome y abre la app <strong>desde ese acceso directo</strong>. Toca “Imprimir prueba”: debería salir sin mostrar la ventana de impresión.</li>
          <li>Activa la estación con el botón de arriba. Deja la laptop enchufada y que no se suspenda (Configuración → Energía → Nunca).</li>
        </ol>
        <p>Sin ese acceso directo también funciona, pero Chrome muestra la ventana de impresión en cada comanda y hay que tocar “Imprimir”.</p>
        <p>Los pedidos de un celular sin conexión se imprimen cuando ese celular vuelve a tener internet. Si la impresora falla o se queda sin papel, usa “Reimprimir”.</p>
      </details>
    </section>
  );
}
