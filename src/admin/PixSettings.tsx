import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { savePix } from '../db';
import { keyTypeLabels, type PixConfig, type PixKeyType } from '../pix';

interface PixSettingsProps {
  pin: string;
  config: PixConfig;
  onSaved: (config: PixConfig) => void;
}

export function PixSettings({ pin, config, onSaved }: PixSettingsProps) {
  const [draft, setDraft] = useState<PixConfig>(config);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // Solo se vuelve a cargar si el servidor trae datos distintos: el refresco automático no debe borrar lo que se está escribiendo.
  const serverKey = JSON.stringify(config);
  useEffect(() => setDraft(config), [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setSaving(true);
    const result = await savePix(draft, pin);
    setSaving(false);
    if (result.ok) {
      onSaved(result.value);
      setMessage({ ok: true, text: 'Guardado. Se aplica en todos los dispositivos.' });
    } else {
      setMessage({ ok: false, text: result.message });
    }
  }

  const withKey = draft.keyType !== 'NONE';
  return (
    <section className="pix-settings">
      <h3>Cobro con Pix</h3>
      <p className="muted">Cuando el cajero elige «Pix / QR», el sistema muestra el QR con el monto exacto y puede enviarlo al cliente por WhatsApp.</p>
      <label className="field-label" htmlFor="pix-type">Tipo de clave Pix</label>
      <select id="pix-type" className="text-input" value={draft.keyType} onChange={(event) => setDraft({ ...draft, keyType: event.target.value as PixKeyType })}>
        {(Object.keys(keyTypeLabels) as PixKeyType[]).map((type) => <option key={type} value={type}>{keyTypeLabels[type]}</option>)}
      </select>
      {withKey && <>
        <label className="field-label" htmlFor="pix-key">Clave Pix</label>
        <input id="pix-key" className="text-input" value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder={draft.keyType === 'CELULAR' ? '48 98810-2993' : draft.keyType === 'EMAIL' ? 'negocio@correo.com' : draft.keyType === 'CPF_CNPJ' ? 'Solo números' : 'Clave aleatoria'} />
        <label className="field-label" htmlFor="pix-name">Nombre del beneficiario <span>máx. 25</span></label>
        <input id="pix-name" className="text-input" maxLength={25} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Caraboa Express" />
        <label className="field-label" htmlFor="pix-city">Ciudad <span>máx. 15</span></label>
        <input id="pix-city" className="text-input" maxLength={15} value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} placeholder="Florianopolis" />
      </>}
      <label className="field-label" htmlFor="pix-link">Enlace de pago <span>opcional</span></label>
      <input id="pix-link" className="text-input" value={draft.link} onChange={(event) => setDraft({ ...draft, link: event.target.value })} placeholder="https://… (Mercado Pago, banco, etc.)" />
      {message && <p className={message.ok ? 'form-ok' : 'form-error'}>{message.ok && <CheckCircle2 size={14} />} {message.text}</p>}
      <button className="modal-primary" onClick={() => void submit()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cobro Pix'}</button>
    </section>
  );
}
