import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  MAX_CHAT_LENGTH, MAX_PLAYERS, PLAYER_COLORS,
  chord, cloneLayout, createGame, isOver, livesLeft, placeMines, rankPlayers, reveal, toView, toggleMark,
  type BoardView, type ChatMessage, type ErrorCode, type Game, type LastAction,
  type RoomPhase, type RoomSettings, type RoomView, type ServerMessage,
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
  score: number;
  /** Solo sfida: il campo personale e le celle già aperte all'avvio (non danno punti). */
  game: Game | null;
  baseline: number;
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
    public settings: RoomSettings,
    private hooks: RoomHooks,
  ) {
    this.game = createGame(settings.config, settings.lives);
  }

  private get isRace() {
    return this.settings.mode === 'race';
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
      score: 0,
      game: null,
      baseline: 0,
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
    this.checkRaceEnd();
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
    this.checkRaceEnd();
    if (!this.players.some((p) => p.connected)) this.hooks.onIdleChange(this, true);
    this.broadcastState();
  }

  // ───────────────────────── impostazioni e avvio ─────────────────────────

  configure(playerId: string, settings: RoomSettings): void {
    this.requireHost(playerId);
    if (this.phase === 'playing') throw new RoomError('BAD_PHASE', 'Non puoi cambiare impostazioni durante la partita.');
    this.settings = settings;
    if (this.phase === 'lobby') this.game = createGame(settings.config, settings.lives);
    this.broadcastState();
  }

  start(playerId: string): void {
    this.requireHost(playerId);
    if (this.phase === 'playing') throw new RoomError('BAD_PHASE', 'La partita è già in corso.');
    const { config, lives } = this.settings;
    this.phase = 'playing';
    this.round++;
    this.lastAction = null;
    for (const p of this.players) {
      p.score = 0;
      p.game = null;
      p.baseline = 0;
    }

    if (this.isRace) {
      // Stessa disposizione per tutti, con la stessa apertura iniziale già scoperta:
      // nessuno parte avvantaggiato e l'apertura non assegna punti.
      this.game = createGame(config, lives);
      const opening = Math.floor(Math.random() * config.width * config.height);
      placeMines(this.game, opening);
      const now = Date.now();
      for (const p of this.players) {
        p.game = cloneLayout(this.game, lives);
        reveal(p.game, opening, now);
        p.baseline = p.game.revealed;
      }
      this.setTurn(null);
      this.systemMessage(`Round ${this.round}: sfida iniziata! Stesse mine per tutti, ${lives} ${lives === 1 ? 'vita' : 'vite'} a testa.`);
    } else {
      this.game = createGame(config, lives);
      // A ogni round inizia un giocatore diverso.
      this.advanceTurn(((this.round - 1) % this.players.length) - 1);
      this.systemMessage(`Round ${this.round} iniziato! Vite della squadra: ${lives}.`);
    }
    this.broadcastState();
  }

  // ───────────────────────── mosse ─────────────────────────

  reveal(playerId: string, index: number, kind: 'reveal' | 'chord'): void {
    this.requirePlaying();
    if (this.isRace) return this.raceReveal(playerId, index, kind);
    if (this.turnPlayerId !== playerId) throw new RoomError('NOT_YOUR_TURN', 'Non è il tuo turno.');
    const player = this.get(playerId)!;
    const g = this.game;
    const first = !g.minesPlaced;
    const before = g.revealed;
    const hitsBefore = g.hits;
    const changed = kind === 'reveal' ? reveal(g, index) : chord(g, index);
    // Una mossa che non cambia nulla (es. click su cella già scoperta) non consuma il turno.
    if (!changed) return;

    this.award(player, g.revealed - before, first);
    this.lastAction = { type: kind, playerId, index };

    if (isOver(g)) this.endGame(player);
    else {
      if (g.hits > hitsBefore) {
        const left = livesLeft(g);
        this.systemMessage(`💥 ${player.name} ha trovato una mina! ${left === 1 ? 'Resta 1 vita' : `Restano ${left} vite`} alla squadra.`);
      }
      this.advanceTurn(this.indexOf(playerId));
    }
    this.broadcastState();
  }

  /**
   * Punti del campo condiviso. Il primo click apre spesso un'area enorme per pura fortuna:
   * quelle celle si dividono in parti uguali tra i giocatori connessi (l'eventuale resto a chi ha cliccato).
   */
  private award(player: Player, cells: number, first: boolean) {
    if (!first) {
      player.score += cells;
      return;
    }
    const sharing = this.players.filter((p) => p.connected);
    const share = Math.floor(cells / sharing.length);
    for (const p of sharing) p.score += share;
    player.score += cells - share * sharing.length;
    if (sharing.length > 1) this.systemMessage(`Prima apertura: ${cells} celle divise tra tutti (${share} a testa).`);
  }

  private raceReveal(playerId: string, index: number, kind: 'reveal' | 'chord') {
    const player = this.get(playerId);
    const g = player?.game;
    if (!player || !g) throw new RoomError('BAD_PHASE', 'Stai guardando: entrerai nella prossima sfida.');
    const hitsBefore = g.hits;
    const changed = kind === 'reveal' ? reveal(g, index) : chord(g, index);
    if (!changed) return;
    player.score = g.revealed - player.baseline;

    if (g.status === 'won') {
      this.systemMessage(`🌼 ${player.name} ha ripulito il campo!`);
    } else if (g.status === 'lost') {
      this.systemMessage(`💀 ${player.name} è stato eliminato con ${player.score} punti`);
    } else if (g.hits > hitsBefore) {
      const left = livesLeft(g);
      this.systemMessage(`💥 ${player.name} ha preso una mina (${left === 1 ? '1 vita rimasta' : `${left} vite rimaste`})`);
    }
    this.checkRaceEnd();
    this.broadcastState();
  }

  /** Le bandierine non consumano il turno. In coop sono condivise, in sfida ognuno ha le sue. */
  flag(playerId: string, index: number): void {
    this.requirePlaying();
    const player = this.get(playerId);
    if (!player) throw new RoomError('NOT_IN_ROOM', 'Non sei in questa partita.');
    const g = this.isRace ? player.game : this.game;
    if (g && toggleMark(g, index, false)) this.broadcastState();
  }

  chatFrom(playerId: string, rawText: string): void {
    const player = this.get(playerId);
    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
    if (!player || !text) return;
    this.pushChat({ playerId, name: player.name, color: player.color, text });
  }

  /** La sfida finisce quando nessuno sta più giocando (campo pulito, eliminato o disconnesso). */
  /**
   * La sfida finisce quando:
   * - qualcuno ripulisce il campo (con le stesse mine ha già il massimo dei punti: nessuno può superarlo);
   * - nessuno sta più giocando (eliminati o disconnessi);
   * - resta un solo giocatore in gara ed è già primo: continuare non cambierebbe il vincitore.
   */
  private checkRaceEnd() {
    if (!this.isRace || this.phase !== 'playing') return;
    const racers = this.players.filter((p) => p.game && p.connected && !isOver(p.game));
    if (this.players.some((p) => p.game?.status === 'won') || racers.length === 0) return this.finishRace();
    if (racers.length === 1) {
      const [first, second] = rankPlayers(this.view().players.filter((p) => p.board));
      if (second && first.id === racers[0].id && first.score > second.score) this.finishRace();
    }
  }

  /** Fine sfida anticipata, decisa dall'host (es. qualcuno è rimasto fermo). */
  endRace(playerId: string): void {
    this.requireHost(playerId);
    if (!this.isRace || this.phase !== 'playing') throw new RoomError('BAD_PHASE', 'Nessuna sfida in corso.');
    this.systemMessage('L\'host ha terminato la sfida.');
    this.finishRace();
    this.broadcastState();
  }

  private finishRace() {
    this.phase = 'ended';
    const now = Date.now();
    // Chi era ancora in gara si ferma qui (il suo timer non deve continuare a correre).
    for (const p of this.players) if (p.game && !isOver(p.game)) p.game.endedAt = now;
    const [winner] = rankPlayers(this.view().players.filter((p) => p.board));
    this.systemMessage(winner ? `🏆 ${winner.name} vince la sfida con ${winner.score} ${winner.score === 1 ? "punto" : "punti"}!` : 'Sfida terminata.');
  }

  private endGame(by: Player) {
    this.phase = 'ended';
    this.clearTurnTimer();
    this.turnPlayerId = null;
    this.turnEndsAt = null;
    if (this.game.status === 'won') {
      this.systemMessage('🌼 Campo ripulito: vittoria di squadra!');
    } else {
      this.systemMessage(`💥 ${by.name} ha trovato l'ultima mina: vite finite, partita persa!`);
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
    this.turnPlayerId = this.phase === 'playing' && !this.isRace ? playerId : null;
    this.turnEndsAt = null;
    const { turnSeconds } = this.settings;
    if (!this.turnPlayerId || turnSeconds <= 0) return;

    const current = this.turnPlayerId;
    this.turnEndsAt = Date.now() + turnSeconds * 1000;
    this.turnTimer = setTimeout(() => {
      if (this.turnPlayerId !== current || this.phase !== 'playing') return;
      const p = this.get(current);
      this.lastAction = { type: 'timeout', playerId: current };
      if (p) this.systemMessage(`⏱️ Tempo scaduto per ${p.name}`);
      this.advanceTurn(this.indexOf(current));
      this.broadcastState();
    }, turnSeconds * 1000);
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
    // In sfida le mine restano nascoste su tutti i campi finché la gara non è finita.
    const revealMines = this.phase === 'ended';
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        connected: p.connected,
        score: p.score,
        board: p.game ? boardView(p.game, revealMines) : null,
      })),
      turnPlayerId: this.turnPlayerId,
      turnEndsAt: this.turnEndsAt,
      settings: this.settings,
      board: boardView(this.game, !this.isRace),
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

function boardView(g: Game, revealMines: boolean): BoardView {
  return {
    width: g.width,
    height: g.height,
    mines: g.mines,
    status: g.status,
    view: toView(g, revealMines),
    flags: g.flags,
    lives: g.lives,
    hits: g.hits,
    startedAt: g.startedAt,
    endedAt: g.endedAt,
  };
}
