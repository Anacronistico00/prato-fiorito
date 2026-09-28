import { describe, expect, it } from 'vitest';
import { clampConfig, maxMines } from './config';
import {
  Cell, View, chord, createGame, neighbors, placeMines, reveal, toggleMark, toView, type Game,
} from './engine';

function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Griglia con mine in posizioni note (mine piazzate, partita "ready"). */
function fixed(width: number, height: number, mines: number[]): Game {
  const g = createGame({ width, height, mines: mines.length });
  for (const m of mines) g.mine[m] = 1;
  for (let i = 0; i < width * height; i++) {
    g.adjacent[i] = neighbors(g, i).reduce((s, n) => s + g.mine[n], 0);
  }
  g.minesPlaced = true;
  return g;
}

describe('config', () => {
  it('normalizza input non validi', () => {
    expect(clampConfig({ width: 1000, height: -3, mines: 1e9 })).toEqual({
      width: 40, height: 5, mines: maxMines(40, 5),
    });
    expect(clampConfig({ width: NaN as unknown as number })).toEqual({ width: 9, height: 9, mines: 10 });
  });
});

describe('prima mossa', () => {
  it('è sempre sicura e apre un\'area (1000 partite esperto)', () => {
    const rng = seeded(42);
    for (let k = 0; k < 1000; k++) {
      const g = createGame({ width: 30, height: 16, mines: 99 });
      const first = Math.floor(rng() * 480);
      reveal(g, first, 0, rng);
      expect(g.status).toBe('playing');
      expect(g.adjacent[first]).toBe(0);
      expect(g.revealed).toBeGreaterThan(1);
      expect(g.mine.reduce((a, b) => a + b, 0)).toBe(99);
    }
  });

  it('con griglia quasi piena protegge almeno la cella cliccata', () => {
    const g = createGame({ width: 5, height: 5, mines: 24 });
    placeMines(g, 12, seeded(1));
    expect(g.mine[12]).toBe(0);
    expect(g.mine.reduce((a, b) => a + b, 0)).toBe(24);
  });
});

describe('reveal', () => {
  it('flood fill si ferma ai numeri e non tocca le bandierine', () => {
    // 5x5, mina nell'angolo in basso a destra
    const g = fixed(5, 5, [24]);
    toggleMark(g, 0);
    reveal(g, 12, 0);
    expect(g.state[0]).toBe(Cell.FLAGGED);
    expect(g.state[24]).toBe(Cell.HIDDEN);
    expect(g.state[18]).toBe(Cell.REVEALED); // il "1" accanto alla mina
    expect(g.revealed).toBe(23);
    expect(g.status).toBe('playing');
  });

  it('vittoria quando restano solo mine, con bandierine automatiche', () => {
    const g = fixed(5, 5, [24]);
    reveal(g, 0, 100);
    expect(toggleMark(g, 24)).toBe(false); // a partita vinta non si marca più
    expect(g.status).toBe('won');
    const v = toView(g);
    expect(v[24]).toBe(View.FLAG);
    expect(g.flags).toBe(1);
  });

  it('mina = sconfitta, vista con mine, esplosa e bandiere sbagliate', () => {
    const g = fixed(3, 3, [0, 8]);
    reveal(g, 4, 0);
    toggleMark(g, 8);   // corretta
    toggleMark(g, 2);   // sbagliata
    reveal(g, 0, 50);
    expect(g.status).toBe('lost');
    const v = toView(g);
    expect(v[0]).toBe(View.EXPLODED);
    expect(v[8]).toBe(View.FLAG);
    expect(v[2]).toBe(View.WRONG_FLAG);
    expect(v[4]).toBe(2);
    // a partita finita non si muove più nulla
    expect(reveal(g, 1)).toBe(false);
    expect(toggleMark(g, 1)).toBe(false);
  });

  it('non rivela celle con bandiera, sì con punto interrogativo', () => {
    const g = fixed(3, 3, [0]);
    toggleMark(g, 8);
    expect(reveal(g, 8)).toBe(false);
    toggleMark(g, 8); // → ?
    expect(g.state[8]).toBe(Cell.QUESTION);
    expect(g.flags).toBe(0);
    expect(reveal(g, 8)).toBe(true);
  });

  it('la vista non espone le mine durante la partita', () => {
    const g = createGame({ width: 9, height: 9, mines: 10 });
    reveal(g, 40, 0, seeded(7));
    const v = toView(g);
    expect(v.some((x) => x === View.MINE || x === View.EXPLODED)).toBe(false);
  });
});

describe('toggleMark', () => {
  it('cicla bandiera/?/coperta e senza punti interrogativi solo bandiera', () => {
    const g = fixed(3, 3, [0]);
    toggleMark(g, 0); expect(g.state[0]).toBe(Cell.FLAGGED);
    toggleMark(g, 0); expect(g.state[0]).toBe(Cell.QUESTION);
    toggleMark(g, 0); expect(g.state[0]).toBe(Cell.HIDDEN);
    toggleMark(g, 0, false); toggleMark(g, 0, false);
    expect(g.state[0]).toBe(Cell.HIDDEN);
    expect(g.flags).toBe(0);
  });
});

describe('chord', () => {
  it('scopre le vicine se le bandierine coincidono con il numero', () => {
    // riga 0: M . . ; mine a 0 e 6 in una 3x3
    const g = fixed(3, 3, [0, 6]);
    reveal(g, 4, 0); // centro = 2
    expect(chord(g, 4)).toBe(false); // nessuna bandierina
    toggleMark(g, 0);
    expect(chord(g, 4)).toBe(false); // 1 su 2
    toggleMark(g, 6);
    expect(chord(g, 4)).toBe(true);
    expect(g.status).toBe('won');
  });

  it('con bandierina sbagliata fa esplodere', () => {
    const g = fixed(3, 3, [0]);
    reveal(g, 4, 0); // centro = 1
    toggleMark(g, 1);
    expect(chord(g, 4, 10)).toBe(true);
    expect(g.status).toBe('lost');
    expect(g.exploded).toBe(0);
  });
});
