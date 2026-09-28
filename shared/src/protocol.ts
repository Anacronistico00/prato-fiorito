import type { BoardConfig } from './config';
import type { GameStatus } from './engine';

export const MAX_PLAYERS = 8;
export const CODE_LENGTH = 6;
/** Alfabeto dei codici partita: niente caratteri ambigui (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Secondi a disposizione per ogni turno (0 = illimitato). */
export const TURN_OPTIONS = [0, 10, 20, 30, 60] as const;
export const MAX_NAME_LENGTH = 20;
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
  /** Celle scoperte nella partita corrente. */
  revealed: number;
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
  turnSeconds: number;
  config: BoardConfig;
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
  | { t: 'create'; name: string; config: BoardConfig; turnSeconds: number }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; playerId: string; token: string }
  | { t: 'leave' }
  | { t: 'configure'; config: BoardConfig; turnSeconds: number }
  | { t: 'start' }
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
