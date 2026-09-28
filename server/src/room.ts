import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  MAX_CHAT_LENGTH, MAX_PLAYERS, PLAYER_COLORS,
  chord, createGame, isOver, reveal, toView, toggleMark,
  type BoardConfig, type ChatMessage, type ErrorCode, type Game, type LastAction,
  type RoomPhase, type RoomView, type ServerMessage,
} from '@prato/shared';

/** Quanto resta in lista un giocatore disconnesso prima di essere rimosso. */
const PLAYER_GRACE_MS = 5 * 60_000;
const CHAT_HISTORY = 50;

export class RoomError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
  }
}

export interface Player {
  id: string;
  token: string;
  name: string;
  color: string;
  connected: boolean;
  revealed: number;
  socket: WebSocket | null;
  removeTimer: NodeJS.Timeout | null;
}

export interface RoomHooks {
  /** Chiamato quando nessun giocatore è più connesso (o la stanza è vuota). */
  onIdleChange(room: Room, idle: boolean): void;
  onEmpty(room: Room): void;
}

export class Room {
  players: Player[] = [];
  phase: RoomPhase = 'lobby';
  hostId = '';
  game: Game;
  turnPlayerId: string | null = null;
  turnEndsAt: number | null = null;
  lastAction: LastAction | null = null;
  round = 0;
  private turnTimer: NodeJS.Timeout | null = null;
  private chat: ChatMessage[] = [];
  private chatSeq = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    public config: BoardConfig,
    public turnSeconds: number,
    private hooks: RoomHooks,
  ) {
    this.game = createGame(config);
  }

  // ───────────────────────── giocatori ─────────────────────────

  addPlayer(rawName: string, socket: WebSocket): Player {
    if (this.players.length >= MAX_PLAYERS) {
      throw new RoomError('ROOM_FULL', `La partita è piena (massimo ${MAX_PLAYERS} giocatori).`);
    }
    const used = new Set(this.players.map((p) => p.color));
    const player: Player = {
      id: randomUUID(),
      token: randomBytes(24).toString('base64url'),
      name: this.uniqueName(rawName),
      color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0],
      connected: true,
      revealed: 0,
      socket,
      removeTimer: null,
    };
    this.players.push(player);
    if (!this.hostId || !this.get(this.hostId)?.connected) this.hostId = player.id;
    if (this.phase === 'playing' && !this.turnPlayerId) this.setTurn(player.id);
    this.hooks.onIdleChange(this, false);
    this.systemMessage(`${player.name} è entrato nella partita`);
    return player;
  }

  resume(playerId: string, token: string, socket: WebSocket): Player {
    const player = this.get(playerId);
    if (!player || player.token !== token) {
      throw new RoomError('SESSION_INVALID', 'Sessione non più valida, rientra con il codice.');
    }
    const old = player.socket;
    player.socket = socket;
    if (old && old !== socket && old.readyState === WebSocket.OPEN) {
      old.close(4000, 'Sessione aperta altrove');
    }
    if (player.removeTimer) clearTimeout(player.removeTimer);
    player.removeTimer = null;
    if (!player.connected) {
      player.connected = true;
      this.systemMessage(`${player.name} si è riconnesso`);
    }
    if (!this.get(this.hostId)?.connected) this.hostId = player.id;
    if (this.phase === 'playing' && !this.turnPlayerId) this.setTurn(player.id);
    this.hooks.onIdleChange(this, false);
    return player;
  }

  /** Il socket si è chiuso: il giocatore resta in lista per un po', così può rientrare. */
  disconnect(player: Player, socket: WebSocket): void {
    if (player.socket !== socket || this.disposed) return;
    player.socket = null;
    player.connected = false;
    this.systemMessage(`${player.name} si è disconnesso`);
    this.transferHostIfNeeded();
    if (this.turnPlayerId === player.id) this.advanceTurn(this.indexOf(player.id));
    player.removeTimer = setTimeout(() => this.remove(player.id, false), PLAYER_GRACE_MS);
    if (!this.players.some((p) => p.connected)) this.hooks.onIdleChange(this, true);
    this.broadcastState();
  }

  /** Uscita volontaria (o scadenza del periodo di grazia). */
  remove(playerId: string, voluntary = true): void {
    const idx = this.indexOf(playerId);
    if (idx < 0) return;
    const [player] = this.players.splice(idx, 1);
    if (player.removeTimer) clearTimeout(player.removeTimer);
    if (voluntary) this.systemMessage(`${player.name} ha lasciato la partita`);

    if (this.players.length === 0) {
      this.hooks.onEmpty(this);
      return;
    }
    this.transferHostIfNeeded();
    if (this.turnPlayerId === player.id) this.advanceTurn(idx - 1);
    if (!this.players.some((p) => p.connected)) this.hooks.onIdleChange(this, true);
    this.broadcastState();
  }

  // ───────────────────────── impostazioni e avvio ─────────────────────────

  configure(playerId: string, config: BoardConfig, turnSeconds: number): void {
    this.requireHost(playerId);
    if (this.phase === 'playing') throw new RoomError('BAD_PHASE', 'Non puoi cambiare impostazioni durante la partita.');
    this.config = config;
    this.turnSeconds = turnSeconds;
    if (this.phase === 'lobby') this.game = createGame(config);
    this.broadcastState();
  }

  start(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase === 'playing') throw new RoomError('BAD_PHASE', 'La partita è già in corso.');
    this.game = createGame(this.config);
    this.phase = 'playing';
    this.round++;
    this.lastAction = null;
    for (const p of this.players) p.revealed = 0;
    // A ogni round inizia un giocatore diverso.
    this.advanceTurn(((this.round - 1) % this.players.length) - 1);
    this.systemMessage(`Round ${this.round} iniziato!`);
    this.broadcastState();
  }

  // ───────────────────────── mosse ─────────────────────────

  reveal(playerId: string, index: number, kind: 'reveal' | 'chord'): void {
    this.requirePlaying();
    if (this.turnPlayerId !== playerId) throw new RoomError('NOT_YOUR_TURN', 'Non è il tuo turno.');
    const player = this.get(playerId)!;
    const before = this.game.revealed;
    const changed = kind === 'reveal' ? reveal(this.game, index) : chord(this.game, index);
    // Una mossa che non cambia nulla (es. click su cella già scoperta) non consuma il turno.
    if (!changed) return;

    player.revealed += this.game.revealed - before;
    this.lastAction = { type: kind, playerId, index };

    if (isOver(this.game)) this.endGame(player);
    else this.advanceTurn(this.indexOf(playerId));
    this.broadcastState();
  }

  /** Le bandierine sono condivise: chiunque può metterle in qualsiasi momento, senza consumare il turno. */
  flag(playerId: string, index: number): void {
    this.requirePlaying();
    if (!this.get(playerId)) throw new RoomError('NOT_IN_ROOM', 'Non sei in questa partita.');
    if (toggleMark(this.game, index, false)) this.broadcastState();
  }

  chatFrom(playerId: string, rawText: string): void {
    const player = this.get(playerId);
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!player || !text) return;
    this.pushChat({ playerId, name: player.name, color: player.color, text });
  }

  private endGame(by: Player) {
    this.phase = 'ended';
    this.clearTurnTimer();
    this.turnPlayerId = null;
    this.turnEndsAt = null;
    if (this.game.status === 'won') {
      this.systemMessage('🌼 Campo ripulito: vittoria di squadra!');
    } else {
      this.systemMessage(`💥 ${by.name} ha trovato una mina. Partita persa!`);
    }
  }

  // ───────────────────────── turni ─────────────────────────

  /** Passa il turno al primo giocatore connesso dopo la posizione `afterIndex` (circolare). */
  private advanceTurn(afterIndex: number) {
    const n = this.players.length;
    let next: Player | null = null;
    for (let k = 1; k <= n; k++) {
      const p = this.players[(((afterIndex + k) % n) + n) % n];
      if (p.connected) {
        next = p;
        break;
      }
    }
    this.setTurn(next?.id ?? null);
  }

  private setTurn(playerId: string | null) {
    this.clearTurnTimer();
    this.turnPlayerId = this.phase === 'playing' ? playerId : null;
    this.turnEndsAt = null;
    if (!this.turnPlayerId || this.turnSeconds <= 0) return;

    const current = this.turnPlayerId;
    this.turnEndsAt = Date.now() + this.turnSeconds * 1000;
    this.turnTimer = setTimeout(() => {
      if (this.turnPlayerId !== current || this.phase !== 'playing') return;
      const p = this.get(current);
      this.lastAction = { type: 'timeout', playerId: current };
      if (p) this.systemMessage(`⏱️ Tempo scaduto per ${p.name}`);
      this.advanceTurn(this.indexOf(current));
      this.broadcastState();
    }, this.turnSeconds * 1000);
  }

  private clearTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  // ───────────────────────── utilità ─────────────────────────

  get(playerId: string): Player | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  private indexOf(playerId: string): number {
    return this.players.findIndex((p) => p.id === playerId);
  }

  private requireHost(playerId: string) {
    if (this.hostId !== playerId) throw new RoomError('NOT_HOST', 'Solo l\'host può farlo.');
  }

  private requirePlaying() {
    if (this.phase !== 'playing') throw new RoomError('BAD_PHASE', 'Nessuna partita in corso.');
  }

  private transferHostIfNeeded() {
    if (this.get(this.hostId)?.connected) return;
    const next = this.players.find((p) => p.connected);
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.systemMessage(`${next.name} ora è l'host`);
    }
  }

  private uniqueName(raw: string): string {
    const base = raw.replace(/\s+/g, ' ').trim().slice(0, 20) || 'Giocatore';
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let k = 2; ; k++) {
      const candidate = `${base.slice(0, 17)} ${k}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private systemMessage(text: string) {
    this.pushChat({ playerId: null, name: 'Partita', color: '#666', text, system: true });
  }

  private pushChat(m: Omit<ChatMessage, 'id' | 'ts'>) {
    const msg: ChatMessage = { ...m, id: ++this.chatSeq, ts: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.broadcast({ t: 'chat', msg });
  }

  chatHistory(): ChatMessage[] {
    return [...this.chat];
  }

  view(): RoomView {
    const g = this.game;
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, color: p.color, connected: p.connected, revealed: p.revealed,
      })),
      turnPlayerId: this.turnPlayerId,
      turnEndsAt: this.turnEndsAt,
      turnSeconds: this.turnSeconds,
      config: this.config,
      board: {
        width: g.width,
        height: g.height,
        mines: g.mines,
        status: g.status,
        view: toView(g),
        flags: g.flags,
        startedAt: g.startedAt,
        endedAt: g.endedAt,
      },
      lastAction: this.lastAction,
      round: this.round,
      now: Date.now(),
    };
  }

  send(player: Player, msg: ServerMessage) {
    if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p.socket?.readyState === WebSocket.OPEN) p.socket.send(data);
    }
  }

  broadcastState() {
    if (!this.disposed) this.broadcast({ t: 'state', room: this.view() });
  }

  dispose() {
    this.disposed = true;
    this.clearTurnTimer();
    for (const p of this.players) if (p.removeTimer) clearTimeout(p.removeTimer);
  }
}
