import { useEffect, useState } from 'react';
import { SERVER_HTTP_URL } from '../lib/settings';

export type ServerStatus = 'checking' | 'waking' | 'online' | 'offline';

/**
 * Sveglia il server (i piani gratuiti di Render lo mettono in pausa dopo 15 min
 * di inattività: il primo avvio può richiedere fino a ~1 minuto).
 */
export function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const slow = setTimeout(() => !cancelled && setStatus('waking'), 2500);
    const abort = setTimeout(() => ctrl.abort(), 90_000);

    fetch(`${SERVER_HTTP_URL}/health`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => !cancelled && setStatus(r.ok ? 'online' : 'offline'))
      .catch(() => !cancelled && setStatus('offline'))
      .finally(() => {
        clearTimeout(slow);
        clearTimeout(abort);
      });

    return () => {
      cancelled = true;
      clearTimeout(slow);
      clearTimeout(abort);
      ctrl.abort();
    };
  }, []);

  return status;
}
