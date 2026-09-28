import { useStored } from './storage';

export type Skin = 'mine' | 'flower';

/** Impostazioni di visualizzazione condivise tra single e multiplayer. */
export function useSkin() {
  // "Prato fiorito" originale (Windows italiano) mostrava fiori al posto delle mine.
  return useStored<Skin>('pf.skin', 'flower');
}

export function usePlayerName() {
  return useStored<string>('pf.name', '');
}

function serverBase(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env.replace(/\/+$/, '');
  return `${location.protocol}//${location.hostname}:8080`;
}

export const SERVER_HTTP_URL = serverBase();
export const SERVER_WS_URL = SERVER_HTTP_URL.replace(/^http/, 'ws');
