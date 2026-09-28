import type { BoardConfig } from './config';

/** Stato interno di una cella. */
export const Cell = {
  HIDDEN: 0,
  REVEALED: 1,
  FLAGGED: 2,
  QUESTION: 3,
} as const;

/**
 * Codifica "pubblica" di una cella, quella che vede il giocatore (e che viaggia in rete).
 * 0..8 = cella scoperta con N mine adiacenti.
 */
export const View = {
  HIDDEN: -1,
  FLAG: -2,
  QUESTION: -3,
  MINE: 9,
  EXPLODED: 10,
  WRONG_FLAG: 11,
} as const;

export type GameStatus = 'ready' | 'playing' | 'won' | 'lost';

export interface Game {
  width: number;
  height: number;
  mines: number;
  /** 1 se la cella contiene una mina. */
  mine: Uint8Array;
  /** Numero di mine adiacenti. */
  adjacent: Uint8Array;
  /** Valori di `Cell`. */
  state: Uint8Array;
  status: GameStatus;
  /** Le mine vengono piazzate al primo click, così la prima mossa è sempre sicura. */
  minesPlaced: boolean;
  revealed: number;
  flags: number;
  exploded: number;
  /** Vite a disposizione: la partita è persa quando `hits` arriva a `lives`. */
  lives: number;
  /** Mine già fatte esplodere (restano scoperte sul campo). */
  hits: number;
  startedAt: number | null;
  endedAt: number | null;
}

export type Rng = () => number;

export function createGame(cfg: BoardConfig, lives = 1): Game {
  const size = cfg.width * cfg.height;
  return {
    width: cfg.width,
    height: cfg.height,
    mines: cfg.mines,
    mine: new Uint8Array(size),
    adjacent: new Uint8Array(size),
    state: new Uint8Array(size),
    status: 'ready',
    minesPlaced: false,
    revealed: 0,
    flags: 0,
    exploded: -1,
    lives: Math.max(1, lives),
    hits: 0,
    startedAt: null,
    endedAt: null,
  };
}

export function isOver(g: Game): boolean {
  return g.status === 'won' || g.status === 'lost';
}

export function neighbors(g: Game, i: number): number[] {
  const x = i % g.width;
  const y = (i - x) / g.width;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= g.height) continue;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      if (nx < 0 || nx >= g.width) continue;
      out.push(ny * g.width + nx);
    }
  }
  return out;
}

const inBounds = (g: Game, i: number) => Number.isInteger(i) && i >= 0 && i < g.width * g.height;

/**
 * Piazza le mine evitando la cella cliccata e (se c'è spazio) tutte le sue vicine,
 * in modo che il primo click apra sempre un'area.
 */
export function placeMines(g: Game, safe: number, rng: Rng = Math.random): void {
  const total = g.width * g.height;
  const zone = [safe, ...neighbors(g, safe)];
  const excluded = new Set(total - zone.length >= g.mines ? zone : [safe]);

  const candidates: number[] = [];
  for (let i = 0; i < total; i++) if (!excluded.has(i)) candidates.push(i);

  // Fisher–Yates parziale: estrae `mines` celle distinte in modo uniforme.
  const count = Math.min(g.mines, candidates.length);
  for (let k = 0; k < count; k++) {
    const j = k + Math.floor(rng() * (candidates.length - k));
    [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
    g.mine[candidates[k]] = 1;
  }
  g.mines = count;

  for (let i = 0; i < total; i++) {
    let n = 0;
    for (const nb of neighbors(g, i)) n += g.mine[nb];
    g.adjacent[i] = n;
  }
  g.minesPlaced = true;
}

/** Nuova partita con la stessa disposizione di mine di `src` (per la modalità sfida). */
export function cloneLayout(src: Game, lives = 1): Game {
  const g = createGame({ width: src.width, height: src.height, mines: src.mines }, lives);
  g.mine.set(src.mine);
  g.adjacent.set(src.adjacent);
  g.minesPlaced = src.minesPlaced;
  return g;
}

/** Numero di vite rimaste. */
export function livesLeft(g: Game): number {
  return Math.max(0, g.lives - g.hits);
}

/** Una mina scoperta: costa una vita; la partita è persa solo se le vite finiscono. */
function explode(g: Game, i: number) {
  g.state[i] = Cell.REVEALED;
  g.exploded = i;
  g.hits++;
}

function start(g: Game, i: number, now: number, rng: Rng) {
  if (!g.minesPlaced) placeMines(g, i, rng);
  if (g.status === 'ready') {
    g.status = 'playing';
    g.startedAt = now;
  }
}

/** Scopre la cella e, se è uno 0, tutta l'area collegata (le bandierine restano al loro posto). */
function flood(g: Game, from: number): void {
  const stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    const s = g.state[c];
    if (s === Cell.REVEALED || s === Cell.FLAGGED || g.mine[c]) continue;
    g.state[c] = Cell.REVEALED;
    g.revealed++;
    if (g.adjacent[c] === 0) {
      for (const nb of neighbors(g, c)) {
        const ns = g.state[nb];
        if (ns === Cell.HIDDEN || ns === Cell.QUESTION) stack.push(nb);
      }
    }
  }
}

function lose(g: Game, now: number) {
  g.status = 'lost';
  g.endedAt = now;
}

function checkWin(g: Game, now: number) {
  if (g.revealed !== g.width * g.height - g.mines) return;
  g.status = 'won';
  g.endedAt = now;
  // Come nell'originale: a vittoria tutte le mine vengono segnate.
  // Le mine già esplose restano visibili come tali.
  for (let i = 0; i < g.mine.length; i++) {
    if (g.mine[i] && g.state[i] !== Cell.REVEALED) g.state[i] = Cell.FLAGGED;
  }
  g.flags = g.mines - g.hits;
}

/** Click sinistro su una cella coperta. Ritorna true se lo stato è cambiato. */
export function reveal(g: Game, i: number, now = Date.now(), rng: Rng = Math.random): boolean {
  if (isOver(g) || !inBounds(g, i)) return false;
  const s = g.state[i];
  if (s === Cell.REVEALED || s === Cell.FLAGGED) return false;

  start(g, i, now, rng);

  if (g.mine[i]) {
    explode(g, i);
    if (g.hits >= g.lives) lose(g, now);
    return true;
  }
  flood(g, i);
  checkWin(g, now);
  return true;
}

/**
 * "Chording": click su un numero già scoperto che ha attorno tante bandierine quante
 * il numero stesso → scopre tutte le altre vicine. Se le bandierine sono sbagliate si perde.
 */
export function chord(g: Game, i: number, now = Date.now()): boolean {
  if (g.status !== 'playing' || !inBounds(g, i)) return false;
  if (g.state[i] !== Cell.REVEALED || g.adjacent[i] === 0 || g.mine[i]) return false;

  const nbs = neighbors(g, i);
  // Le mine già esplose valgono come bandierine: sono mine note.
  const flagged = nbs.filter((n) => g.state[n] === Cell.FLAGGED || (g.state[n] === Cell.REVEALED && g.mine[n])).length;
  if (flagged !== g.adjacent[i]) return false;

  let changed = false;
  for (const n of nbs) {
    const s = g.state[n];
    if (s !== Cell.HIDDEN && s !== Cell.QUESTION) continue;
    changed = true;
    if (g.mine[n]) explode(g, n);
    else flood(g, n);
  }
  if (!changed) return false;
  if (g.hits >= g.lives) lose(g, now);
  else checkWin(g, now);
  return true;
}

/** Click destro: coperta → bandierina → punto interrogativo (se abilitato) → coperta. */
export function toggleMark(g: Game, i: number, questionMarks = true): boolean {
  if (isOver(g) || !inBounds(g, i)) return false;
  switch (g.state[i]) {
    case Cell.HIDDEN:
      g.state[i] = Cell.FLAGGED;
      g.flags++;
      return true;
    case Cell.FLAGGED:
      g.state[i] = questionMarks ? Cell.QUESTION : Cell.HIDDEN;
      g.flags--;
      return true;
    case Cell.QUESTION:
      g.state[i] = Cell.HIDDEN;
      return true;
    default:
      return false;
  }
}

/**
 * Vista pubblica della griglia: non rivela mai le mine finché la partita non è persa.
 * Con `revealMines = false` anche una partita persa non mostra le mine nascoste
 * (serve in sfida: tutti hanno la stessa disposizione finché la gara è in corso).
 */
export function toView(g: Game, revealMines = true): number[] {
  const out = new Array<number>(g.state.length);
  const lost = g.status === 'lost' && revealMines;
  for (let i = 0; i < g.state.length; i++) {
    const s = g.state[i];
    const m = g.mine[i] === 1;
    if (s === Cell.REVEALED) {
      out[i] = m ? View.EXPLODED : g.adjacent[i];
    } else if (lost && m && s !== Cell.FLAGGED) {
      out[i] = View.MINE;
    } else if (lost && !m && s === Cell.FLAGGED) {
      out[i] = View.WRONG_FLAG;
    } else if (s === Cell.FLAGGED) {
      out[i] = View.FLAG;
    } else if (s === Cell.QUESTION) {
      out[i] = View.QUESTION;
    } else {
      out[i] = View.HIDDEN;
    }
  }
  return out;
}

export function elapsedMs(startedAt: number | null, endedAt: number | null, now = Date.now()): number {
  if (startedAt == null) return 0;
  return Math.max(0, (endedAt ?? now) - startedAt);
}

/** Secondi mostrati sul display, come nell'originale: 1 al primo click, massimo 999. */
export function displaySeconds(startedAt: number | null, endedAt: number | null, now = Date.now()): number {
  if (startedAt == null) return 0;
  return Math.min(999, Math.floor(elapsedMs(startedAt, endedAt, now) / 1000) + 1);
}
