export interface BoardConfig {
  width: number;
  height: number;
  mines: number;
}

export type DifficultyKey = 'beginner' | 'intermediate' | 'expert' | 'custom';

export const DIFFICULTIES: Record<Exclude<DifficultyKey, 'custom'>, BoardConfig & { label: string }> = {
  beginner: { label: 'Principiante', width: 9, height: 9, mines: 10 },
  intermediate: { label: 'Intermedio', width: 16, height: 16, mines: 40 },
  expert: { label: 'Esperto', width: 30, height: 16, mines: 99 },
};

export const LIMITS = {
  minWidth: 5,
  maxWidth: 40,
  minHeight: 5,
  maxHeight: 30,
  minMines: 1,
} as const;

/** Massimo di mine per una griglia: lascia sempre spazio a una prima apertura 3x3. */
export function maxMines(width: number, height: number): number {
  return Math.max(LIMITS.minMines, width * height - 9);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toInt = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/** Normalizza una configurazione arbitraria (anche input non fidato) in una valida. */
export function clampConfig(input: Partial<BoardConfig> | null | undefined): BoardConfig {
  const width = clamp(toInt(input?.width, 9), LIMITS.minWidth, LIMITS.maxWidth);
  const height = clamp(toInt(input?.height, 9), LIMITS.minHeight, LIMITS.maxHeight);
  const mines = clamp(toInt(input?.mines, 10), LIMITS.minMines, maxMines(width, height));
  return { width, height, mines };
}

export function difficultyOf(cfg: BoardConfig): DifficultyKey {
  for (const [key, d] of Object.entries(DIFFICULTIES)) {
    if (d.width === cfg.width && d.height === cfg.height && d.mines === cfg.mines) {
      return key as DifficultyKey;
    }
  }
  return 'custom';
}

export function configLabel(cfg: BoardConfig): string {
  const key = difficultyOf(cfg);
  const size = `${cfg.width}×${cfg.height}, ${cfg.mines} mine`;
  return key === 'custom' ? `Personalizzato (${size})` : `${DIFFICULTIES[key].label} (${size})`;
}
