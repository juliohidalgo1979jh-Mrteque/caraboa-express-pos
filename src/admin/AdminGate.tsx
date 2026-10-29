import { useEffect, useState, type ReactNode } from 'react';
import { CloudOff, Lock } from 'lucide-react';
import { adminRequest } from '../db';

interface AdminGateProps {
  pin: string;
  onPinChange: (pin: string) => void;
  verified: boolean;
  onVerified: () => void;
  isOnline: boolean;
  children: ReactNode;
}

/** Pide el PIN de administrador antes de mostrar pantallas con datos del negocio. */
export function AdminGate({ pin, onPinChange, verified, onVerified, isOnline, children }: AdminGateProps) {
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function verify(showError: boolean) {
    setChecking(true);
    const result = await adminRequest<{ ok: boolean }>('/api/admin/verify', 'POST', undefined, pin);
    setChecking(false);
    if (result.ok) onVerified();
    else if (showError) setError(result.message);
  }

  useEffect(() => {
    // Si el PIN guardado sigue siendo válido, entra directo.
    if (!verified && isOnline) void verify(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, isOnline]);

  if (verified) return <>{children}</>;
  if (!isOnline) {
    return <div className="admin-gate"><span className="empty-bag"><CloudOff size={24} /></span><strong>Sin conexión</strong><span>Esta sección necesita internet.</span></div>;
  }
  return (
    <form className="admin-gate" onSubmit={(event) => { event.preventDefault(); void verify(true); }}>
      <span className="empty-bag"><Lock size={24} /></span>
      <strong>Sección de administración</strong>
      <span>Ingresa el PIN de administrador para continuar.</span>
      <div className="money-input"><Lock size={15} /><input aria-label="PIN de administrador" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(event) => { onPinChange(event.target.value); setError(''); }} placeholder="PIN" /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="modal-primary" type="submit" disabled={checking}>{checking ? 'Verificando…' : 'Entrar'}</button>
    </form>
  );
}
