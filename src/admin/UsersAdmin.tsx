import { useState } from 'react';
import { CheckCircle2, KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { adminRequest } from '../db';
import { ConfirmDelete, Modal, useAdminList } from './ui';

type Role = 'DUENO' | 'ENCARGADO' | 'CAJERO';
interface AppUser { id: number; name: string; role: Role; roleLabel: string; active: boolean; lastLogin: string | null }
interface Activity { id: number; user: string; role: string; action: string; createdAt: string }
interface Draft { id?: number; name: string; role: Role; pin: string; active: boolean }

const roleHelp: Record<Role, string> = {
  DUENO: 'Ve y cambia todo, incluidos borrar, finanzas, ajustes y usuarios.',
  ENCARGADO: 'Carga y edita datos (compras, gastos, inventario, pedidos), pero no borra ni cambia ajustes del dueño.',
  CAJERO: 'Solo atiende los pedidos online. No ve reportes, finanzas ni inventario.',
};
const dateTime = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function UsersAdmin({ pin, onToast }: { pin: string; onToast: (message: string) => void }) {
  const { items: users, error: loadError, reload } = useAdminList<AppUser>('/api/users', pin);
  const { items: activity, reload: reloadActivity } = useAdminList<Activity>('/api/users/activity?limit=100', pin);
  const [tab, setTab] = useState<'USERS' | 'ACTIVITY'>('USERS');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<AppUser | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { setError('Escribe el nombre de la persona.'); return; }
    if (!draft.id && !draft.pin) { setError('Elige una clave de 4 a 8 números.'); return; }
    setSaving(true);
    const body = { name: draft.name.trim(), role: draft.role, active: draft.active, pin: draft.pin || undefined };
    const result = await adminRequest<AppUser>(draft.id ? `/api/users/${draft.id}` : '/api/users', draft.id ? 'PUT' : 'POST', body, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setDraft(null);
    onToast(draft.id ? 'Usuario actualizado' : 'Usuario creado');
    void reload(); void reloadActivity();
  }

  async function remove() {
    if (!toDelete) return;
    setSaving(true);
    const result = await adminRequest<{ ok: boolean }>(`/api/users/${toDelete.id}`, 'DELETE', undefined, pin);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setToDelete(null);
    onToast('Usuario eliminado');
    void reload();
  }

  return (
    <section className="history-page menu-page">
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRACIÓN <span>·</span> ACCESOS</p><h1>Usuarios</h1><p className="heading-sub">Cada persona entra con su nombre y su propia clave. Así sabes quién cargó cada cosa.</p></div>
        <div className="heading-actions"><button className="modal-primary menu-new-button" onClick={() => { setError(''); setDraft({ name: '', role: 'ENCARGADO', pin: '', active: true }); }}><Plus size={16} /> Nuevo usuario</button></div></div>
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      <p className="pending-box"><ShieldCheck size={16} /><span>Las claves <strong>ADMIN_PIN</strong> y <strong>MANAGER_PIN</strong> configuradas en Render siguen funcionando como «Administrador» y «Encargado». Úsalas para recuperar el acceso si olvidas una clave.</span></p>

      <div className="category-tabs admin-tabs" role="tablist" aria-label="Secciones">
        <button role="tab" aria-selected={tab === 'USERS'} className={tab === 'USERS' ? 'selected' : ''} onClick={() => setTab('USERS')}>Personas ({users.length})</button>
        <button role="tab" aria-selected={tab === 'ACTIVITY'} className={tab === 'ACTIVITY' ? 'selected' : ''} onClick={() => { setTab('ACTIVITY'); void reloadActivity(); }}>Actividad reciente</button>
      </div>

      {tab === 'USERS' && (users.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>NOMBRE</th><th>PERFIL</th><th>ESTADO</th><th>ÚLTIMO INGRESO</th><th /></tr></thead><tbody>
        {users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.roleLabel}</td><td>{user.active ? 'Activo' : 'Desactivado'}</td><td>{user.lastLogin ? dateTime.format(new Date(user.lastLogin)) : 'Nunca'}</td>
          <td className="align-right"><button className="icon-button" aria-label={`Editar ${user.name}`} onClick={() => { setError(''); setDraft({ id: user.id, name: user.name, role: user.role, pin: '', active: user.active }); }}><Pencil size={15} /></button>
            <button className="icon-button danger-button" aria-label={`Eliminar ${user.name}`} onClick={() => { setError(''); setToDelete(user); }}><Trash2 size={15} /></button></td></tr>)}
      </tbody></table></div> : <div className="history-empty"><span className="empty-bag"><UserCog size={25} /></span><strong>Todavía no hay usuarios</strong><span>Crea una persona para cada encargado o cajero, con su propia clave.</span></div>)}

      {tab === 'ACTIVITY' && (activity.length ? <div className="history-table-wrap"><table className="history-table menu-table"><thead><tr><th>CUÁNDO</th><th>QUIÉN</th><th>QUÉ HIZO</th></tr></thead><tbody>
        {activity.map((row) => <tr key={row.id}><td>{dateTime.format(new Date(row.createdAt))}</td><td><strong>{row.user}</strong> <small className="muted">{row.role}</small></td><td>{row.action}</td></tr>)}
      </tbody></table></div> : <p className="muted">Todavía no hay actividad registrada.</p>)}

      {draft && <Modal title={draft.id ? 'Editar usuario' : 'Nuevo usuario'} eyebrow="ACCESOS" icon={<UserCog size={19} />} onClose={() => setDraft(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="field-label" htmlFor="usr-name">Nombre</label>
          <input id="usr-name" className="text-input" maxLength={60} autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej.: María" />
          <span className="field-label">Perfil</span>
          <div className="method-options" role="group" aria-label="Perfil">{(['CAJERO', 'ENCARGADO', 'DUENO'] as Role[]).map((role) => <button type="button" key={role} className={draft.role === role ? 'selected' : ''} aria-pressed={draft.role === role} onClick={() => setDraft({ ...draft, role })}>{role === 'DUENO' ? 'Dueño' : role === 'ENCARGADO' ? 'Encargado' : 'Cajero'}</button>)}</div>
          <p className="muted">{roleHelp[draft.role]}</p>
          <label className="field-label" htmlFor="usr-pin">{draft.id ? 'Nueva clave' : 'Clave'} <span>{draft.id ? 'déjala vacía para no cambiarla' : '4 a 8 números'}</span></label>
          <div className="money-input"><KeyRound size={15} /><input id="usr-pin" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={draft.pin} onChange={(event) => setDraft({ ...draft, pin: event.target.value.replace(/\D/g, '') })} placeholder="••••" /></div>
          {draft.id && <label className="delivery-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Usuario activo (si lo desactivas, no puede entrar)</label>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="modal-primary" type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar usuario'} <CheckCircle2 size={18} /></button>
        </form>
      </Modal>}
      {toDelete && <ConfirmDelete title="Eliminar usuario" message={<>¿Eliminar a <strong>{toDelete.name}</strong>? Ya no podrá entrar con su clave. Su historial de actividad se conserva.</>} error={error} busy={saving} onCancel={() => setToDelete(null)} onConfirm={() => void remove()} />}
    </section>
  );
}
