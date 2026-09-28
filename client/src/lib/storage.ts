import { useCallback, useState } from 'react';

/** localStorage può lanciare (navigazione privata, cookie bloccati): mai fidarsi. */
export function load<T>(key: string, fallback: T, store: 'local' | 'session' = 'local'): T {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown, store: 'local' | 'session' = 'local'): void {
  try {
    const s = store === 'local' ? localStorage : sessionStorage;
    if (value === undefined || value === null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
  } catch {
    /* ignora */
  }
}

/** useState persistito in localStorage. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        save(key, next);
        return next;
      });
    },
    [key],
  );
  return [value, set];
}
