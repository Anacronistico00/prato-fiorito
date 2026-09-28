import { clampConfig, type BoardConfig } from './config';
import type { GameStatus } from './engine';

export const MAX_PLAYERS = 8;
export const CODE_LENGTH = 6;
/** Alfabeto dei codici partita: niente caratteri ambigui (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Secondi a disposizione per ogni turno (0 = illimitato). */
export const TURN_OPTIONS = [0, 10, 20, 30, 60] as const;
export const MAX_NAME_LENGTH = 20;
export const MAX_LIVES = 5;

/**
 * coop: un solo campo condiviso, a turni; le vite sono della squadra.
 * race: ogni giocatore ha il suo campo (stesse mine per tutti), si gioca in contemporanea.
 */
export type GameMode = 'coop' | 'race';

export interface RoomSettings {
  config: BoardConfig;
  /** Solo coop: secondi per turno (0 = illimitato). */
  turnSeconds: number;
  mode: GameMode;
  /** coop: vite della squadra · race: vite di ciascun giocatore. 1..MAX_LIVES */
  lives: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  config: { width: 9, height: 9, mines: 10 },
  turnSeconds: 20,
  mode: 'coop',
  lives: 1,
};

/** Normalizza impostazioni arrivate dalla rete (input non fidato). */
export function normalizeSettings(input: unknown): RoomSettings {
  const o = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const lives = Number(o.lives);
  return {
    config: clampConfig(typeof o.config === 'object' && o.config !== null ? o.config : null),
    turnSeconds: (TURN_OPTIONS as readonly number[]).includes(o.turnSeconds as number) ? (o.turnSeconds as number) : 0,
    mode: o.mode === 'race' ? 'race' : 'coop',
    lives: Number.isInteger(lives) ? Math.min(MAX_LIVES, Math.max(1, lives)) : 1,
  };
}
export const MAX_CHAT_LENGTH = 200;

export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231',
  '#911eb4', '#0fa3a3', '#d6336c', '#8a6d00',
] as const;

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  /** Punti nella partita corrente (= celle scoperte). */
  score: number;
  /** Solo in sfida: il campo di questo giocatore (null se spettatore o fuori sfida). */
  board: BoardView | null;
}

export interface LastAction {
  type: 'reveal' | 'chord' | 'timeout';
  playerId: string;
  index?: number;
}

export interface BoardView {
  width: number;
  height: number;
  mines: number;
  status: GameStatus;
  view: number[];
  flags: number;
  lives: number;
  hits: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  hostId: string;
  players: PublicPlayer[];
  turnPlayerId: string | null;
  turnEndsAt: number | null;
  settings: RoomSettings;
  /** Campo condiviso (coop). In sfida è solo un'anteprima vuota. */
  board: BoardView;
  lastAction: LastAction | null;
  round: number;
  /** Orologio del server, per sincronizzare timer e countdown. */
  now: number;
}

export interface ChatMessage {
  id: number;
  playerId: string | null;
  name: string;
  color: string;
  text: string;
  ts: number;
  system?: boolean;
}

export type ClientMessage =
  | { t: 'create'; name: string; settings: RoomSettings }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; playerId: string; token: string }
  | { t: 'leave' }
  | { t: 'configure'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'end' }
  | { t: 'reveal'; i: number }
  | { t: 'chord'; i: number }
  | { t: 'flag'; i: number }
  | { t: 'chat'; text: string };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SESSION_INVALID'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'BAD_PHASE'
  | 'INVALID'
  | 'RATE_LIMIT';

export type ServerMessage =
  | { t: 'joined'; code: string; playerId: string; token: string }
  | { t: 'state'; room: RoomView }
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'chatHistory'; messages: ChatMessage[] }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'left' };

/**
 * Classifica della sfida: punti, poi chi ha ripulito il campo (prima chi ha finito prima),
 * poi meno mine prese.
 */
export function rankPlayers(players: PublicPlayer[]): PublicPlayer[] {
  const key = (p: PublicPlayer) => ({
    won: p.board?.status === 'won' ? 1 : 0,
    end: p.board?.status === 'won' ? p.board.endedAt ?? Infinity : Infinity,
    hits: p.board?.hits ?? 0,
  });
  return [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ka = key(a), kb = key(b);
    if (kb.won !== ka.won) return kb.won - ka.won;
    if (ka.end !== kb.end) return ka.end - kb.end;
    return ka.hits - kb.hits;
  });
}
