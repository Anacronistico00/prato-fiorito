import { useSyncExternalStore } from 'react';
import type {
  ChatMessage, ClientMessage, ErrorCode, RoomSettings, RoomView, ServerMessage,
} from '@prato/shared';
import { SERVER_WS_URL } from './settings';
import { load, save } from './storage';

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface RoomSnapshot {
  status: ConnStatus;
  session: Session | null;
  room: RoomView | null;
  chat: ChatMessage[];
  error: { code: ErrorCode; message: string } | null;
  /** serverNow ≈ Date.now() + clockOffset */
  clockOffset: number;
}

export class JoinError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

// Session in sessionStorage: ogni scheda è un giocatore diverso (comodo anche per provare in locale).
const SESSION_KEY = 'pf.session';

class RoomClient {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private listeners = new Set<() => void>();
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private pending: { resolve: (code: string) => void; reject: (e: JoinError) => void } | null = null;

  private snap: RoomSnapshot = {
    status: 'idle',
    session: load<Session | null>(SESSION_KEY, null, 'session'),
    room: null,
    chat: [],
    error: null,
    clockOffset: 0,
  };

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<RoomSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ───────────── connessione ─────────────

  private connect() {
    this.wanted = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    this.set({ status: this.retries > 0 ? 'reconnecting' : 'connecting' });
    const ws = new WebSocket(SERVER_WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.set({ status: 'open' });
      const s = this.snap.session;
      if (s) ws.send(JSON.stringify({ t: 'resume', ...s } satisfies ClientMessage));
      const queued = this.queue;
      this.queue = [];
      for (const m of queued) ws.send(JSON.stringify(m));
    };

    ws.onmessage = (ev) => {
      try {
        this.handle(JSON.parse(ev.data as string) as ServerMessage);
      } catch {
        /* messaggio malformato: ignora */
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.wanted) {
        this.set({ status: 'idle' });
        return;
      }
      // Backoff esponenziale: 0.5s, 1s, 2s… max 10s
      const delay = Math.min(10_000, 500 * 2 ** this.retries++);
      this.set({ status: 'reconnecting' });
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  private disconnect() {
    this.wanted = false;
    this.queue = [];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set({ status: 'idle' });
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else {
      this.queue.push(msg);
      this.connect();
    }
  }

  private handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'joined': {
        const session = { code: msg.code, playerId: msg.playerId, token: msg.token };
        save(SESSION_KEY, session, 'session');
        this.set({ session, error: null });
        this.pending?.resolve(msg.code);
        this.pending = null;
        break;
      }
      case 'state':
        this.set({ room: msg.room, clockOffset: msg.room.now - Date.now() });
        break;
      case 'chatHistory':
        this.set({ chat: msg.messages });
        break;
      case 'chat':
        this.set({ chat: [...this.snap.chat, msg.msg].slice(-100) });
        break;
      case 'left':
        break;
      case 'error': {
        const fatal = msg.code === 'ROOM_NOT_FOUND' || msg.code === 'SESSION_INVALID' || msg.code === 'ROOM_FULL';
        if (fatal) {
          this.clearSession();
          this.set({ room: null, chat: [] });
        }
        this.set({ error: { code: msg.code, message: msg.message } });
        if (this.pending && fatal) {
          this.pending.reject(new JoinError(msg.code, msg.message));
          this.pending = null;
        }
        break;
      }
    }
  }

  private clearSession() {
    save(SESSION_KEY, null, 'session');
    this.snap = { ...this.snap, session: null };
  }

  /** Esce dalla stanza corrente (se c'è) prima di entrare in un'altra. */
  private reset() {
    if (this.snap.session && this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'leave' });
    this.clearSession();
    this.set({ room: null, chat: [], error: null });
  }

  private awaitJoin(msg: ClientMessage): Promise<string> {
    this.pending?.reject(new JoinError('INVALID', 'Richiesta annullata'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.send(msg);
    });
  }

  // ───────────── API ─────────────

  create(name: string, settings: RoomSettings) {
    this.reset();
    return this.awaitJoin({ t: 'create', name, settings });
  }

  join(code: string, name: string) {
    this.reset();
    return this.awaitJoin({ t: 'join', code, name });
  }

  /** Rientra nella stanza con la sessione salvata (se corrisponde al codice). Ritorna false se non c'è sessione. */
  resume(code: string): boolean {
    const s = this.snap.session;
    if (!s || s.code !== code) return false;
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.snap.room?.code !== code) this.send({ t: 'resume', ...s });
    } else {
      this.connect(); // onopen invia il resume
    }
    return true;
  }

  leave() {
    if (this.ws?.readyState === WebSocket.OPEN && this.snap.session) this.ws.send(JSON.stringify({ t: 'leave' }));
    this.clearSession();
    this.set({ room: null, chat: [], error: null });
    this.disconnect();
  }

  clearError() {
    this.set({ error: null });
  }

  configure(settings: RoomSettings) { this.send({ t: 'configure', settings }); }
  start() { this.send({ t: 'start' }); }
  endRace() { this.send({ t: 'end' }); }
  reveal(i: number) { this.send({ t: 'reveal', i }); }
  chord(i: number) { this.send({ t: 'chord', i }); }
  flag(i: number) { this.send({ t: 'flag', i }); }
  chat(text: string) { this.send({ t: 'chat', text }); }
}

export const roomClient = new RoomClient();

export function useRoomClient(): RoomSnapshot {
  return useSyncExternalStore(roomClient.subscribe, roomClient.getSnapshot);
}
