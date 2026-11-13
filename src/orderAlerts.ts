import { useCallback, useEffect, useRef, useState } from 'react';
import { adminRequest } from './db';

interface PendingOrder { id: number; code: string; status: string }

const SOUND_KEY = 'caraboa-order-sound';
const POLL_MS = 15_000;
const RING_MS = 5_000;

function readSound(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
}

type AudioCtor = typeof AudioContext;

/** Avisa de los pedidos online nuevos desde cualquier pantalla: sonido repetido, contador y título de la pestaña. */
export function useOrderAlerts(pin: string, onPortalScreen: boolean) {
  const [newOrders, setNewOrders] = useState<PendingOrder[]>([]);
  const [acked, setAcked] = useState<Set<number>>(new Set());
  const [soundOn, setSoundOn] = useState(readSound);
  const [unlocked, setUnlocked] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  const unlock = useCallback(() => {
    try {
      const Ctor: AudioCtor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      audio.current ??= new Ctor();
      void audio.current.resume().then(() => setUnlocked(audio.current?.state === 'running'));
    } catch { /* sin audio disponible */ }
  }, []);

  // El navegador solo deja sonar después de un toque del usuario.
  useEffect(() => {
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [unlock]);

  const beep = useCallback(() => {
    const context = audio.current;
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    [[880, 0], [1175, 0.22], [880, 0.44], [1175, 0.66]].forEach(([frequency, offset]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.22);
    });
  }, []);

  // Consulta los pedidos nuevos cada 15 s y al volver a la pestaña.
  useEffect(() => {
    if (!pin) return undefined;
    let stopped = false;
    async function poll() {
      const result = await adminRequest<PendingOrder[]>('/api/portal/orders?scope=active', 'GET', undefined, pin);
      if (stopped || !result.ok) return;
      setNewOrders(result.value.filter((order) => order.status === 'NUEVO'));
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [pin]);

  const unseen = newOrders.filter((order) => !acked.has(order.id));

  const acknowledge = useCallback(() => {
    setAcked((current) => new Set([...current, ...newOrders.map((order) => order.id)]));
  }, [newOrders]);

  // En la pantalla de pedidos suena una vez y se da por visto; en cualquier otra, suena hasta que lo abran.
  useEffect(() => {
    if (!unseen.length || !soundOn) return undefined;
    if (onPortalScreen) { beep(); acknowledge(); return undefined; }
    beep();
    const timer = window.setInterval(beep, RING_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen.length, soundOn, onPortalScreen, unlocked]);

  useEffect(() => { if (onPortalScreen && unseen.length) acknowledge(); }, [onPortalScreen, unseen.length, acknowledge]);

  // Título de la pestaña parpadeando mientras haya pedidos sin ver.
  useEffect(() => {
    if (!unseen.length) return undefined;
    const original = document.title.replace(/^🔔 \(\d+\) /, '');
    let on = false;
    const timer = window.setInterval(() => { on = !on; document.title = on ? `🔔 (${unseen.length}) Pedido nuevo` : original; }, 1000);
    return () => { window.clearInterval(timer); document.title = original; };
  }, [unseen.length]);

  const toggleSound = useCallback(() => {
    setSoundOn((current) => {
      const next = !current;
      try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
      return next;
    });
  }, []);

  return { newCount: newOrders.length, unseen, unseenCount: unseen.length, soundOn, toggleSound, unlocked, unlock, acknowledge, testSound: () => { unlock(); window.setTimeout(beep, 120); } };
}
