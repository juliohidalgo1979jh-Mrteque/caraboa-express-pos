import { useCallback, useEffect, useRef, useState } from 'react';
import { comandasHtml, printHtml } from './print';
import type { Comanda } from './types';

interface StationConfig {
  enabled: boolean;
  afterId: number;
  since: string;
}

const STATION_STORAGE_KEY = 'tequenos-club-kitchen-station';
const POLL_MS = 4000;

function readConfig(): StationConfig {
  try {
    const stored = localStorage.getItem(STATION_STORAGE_KEY);
    if (stored) return JSON.parse(stored) as StationConfig;
  } catch {
    // Sin almacenamiento: la estación empieza pausada.
  }
  return { enabled: false, afterId: 0, since: '' };
}

function storeConfig(config: StationConfig) {
  try {
    localStorage.setItem(STATION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Sin almacenamiento: habrá que volver a activarla al recargar.
  }
}

export const sampleComanda: Comanda = {
  id: 0, orderCode: 'A-000', point: 'Prueba', time: new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date()),
  paymentMethod: 'Efectivo', total: 0, printedAt: null,
  items: [{ name: 'Pizza Calabresa 25 cm', quantity: 2, unitPrice: 0, subtotal: 0 }, { name: 'Hamburguesa especial', quantity: 1, unitPrice: 0, subtotal: 0 }],
};

/**
 * Estación de comandas: mientras está activa, pide al servidor los pedidos nuevos de todos los puntos
 * y los imprime. Corre a nivel de la app para seguir imprimiendo aunque se use otra pantalla.
 */
export function useKitchenStation(isOnline: boolean, onPrinted: (comandas: Comanda[]) => void) {
  const [config, setConfig] = useState<StationConfig>(readConfig);
  const [recent, setRecent] = useState<Comanda[]>([]);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const onPrintedRef = useRef(onPrinted);
  onPrintedRef.current = onPrinted;

  const update = (next: StationConfig) => {
    storeConfig(next);
    setConfig(next);
  };

  const refreshRecent = useCallback(async () => {
    try {
      const response = await fetch('/api/comandas/recent?limit=30');
      if (response.ok) setRecent(await response.json());
    } catch {
      // Se reintenta en el próximo ciclo.
    }
  }, []);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch('/api/comandas/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ afterId: config.afterId }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const comandas: Comanda[] = await response.json();
      setError('');
      if (comandas.length) {
        await printHtml(comandasHtml(comandas));
        onPrintedRef.current(comandas);
        void refreshRecent();
      }
    } catch {
      setError('Sin conexión con el servidor: los pedidos se imprimirán al reconectar.');
    } finally {
      busy.current = false;
    }
  }, [config.afterId, refreshRecent]);

  useEffect(() => {
    if (!config.enabled || !isOnline) return;
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [config.enabled, isOnline, poll]);

  async function enable() {
    try {
      const response = await fetch('/api/comandas/last-id');
      if (!response.ok) throw new Error(String(response.status));
      const { lastId } = (await response.json()) as { lastId: number };
      // Solo se imprimen los pedidos que lleguen desde ahora, no los anteriores.
      update({ enabled: true, afterId: lastId, since: new Date().toISOString() });
      setError('');
      void refreshRecent();
    } catch {
      setError('Se necesita conexión para activar la estación de comandas.');
    }
  }

  return {
    enabled: config.enabled,
    since: config.since,
    recent,
    error,
    enable,
    disable: () => update({ ...config, enabled: false }),
    refreshRecent,
    reprint: (comanda: Comanda) => printHtml(comandasHtml([comanda])),
    testPrint: () => printHtml(comandasHtml([{ ...sampleComanda }])),
  };
}

export type KitchenStation = ReturnType<typeof useKitchenStation>;
