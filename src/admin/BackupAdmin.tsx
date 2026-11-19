import { Download, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function BackupAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');

  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/backup', { headers: { 'X-Admin-Pin': pin } });
      if (!response.ok) {
        const detail = await response.json().then((data) => data?.detail, () => undefined);
        setError(typeof detail === 'string' ? detail : 'No se pudo crear la copia. Intenta de nuevo.');
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? 'copia-caraboa.json';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setLast(`${name} · ${(blob.size / 1024).toFixed(0)} KB`);
      onToast('Copia de seguridad descargada');
    } catch {
      setError('Sin conexión. La copia necesita internet.');
    } finally { setBusy(false); }
  }

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> SEGURIDAD</p><h1>Copia de seguridad</h1>
        <p className="heading-sub">Descarga todos los datos del negocio (ventas, carta, inventario, gastos, finanzas, clientes y pedidos) en un archivo.</p></div></div>
      <div className="backup-card">
        <ShieldCheck size={40} />
        <p>Guarda el archivo en un lugar seguro: Google Drive, tu correo o la computadora. Hazlo seguido, por ejemplo al cerrar la semana.</p>
        <button className="modal-primary backup-button" onClick={() => void download()} disabled={busy}><Download size={22} /> {busy ? 'Preparando copia…' : 'Descargar copia de seguridad'}</button>
        {last && <p className="backup-ok">Descargado: {last}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <small className="muted">Por seguridad, la copia no incluye las claves de los usuarios. Solo el dueño puede descargarla.</small>
      </div>
    </section>
  );
}
