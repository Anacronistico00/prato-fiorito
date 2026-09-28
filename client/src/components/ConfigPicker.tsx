import { useEffect, useState } from 'react';
import {
  DIFFICULTIES, LIMITS, clampConfig, difficultyOf, maxMines,
  type BoardConfig, type DifficultyKey,
} from '@prato/shared';

interface Props {
  value: BoardConfig;
  onChange(cfg: BoardConfig): void;
  disabled?: boolean;
}

const PRESETS = Object.entries(DIFFICULTIES) as [Exclude<DifficultyKey, 'custom'>, (typeof DIFFICULTIES)['beginner']][];

/** Scelta della difficoltà: tre livelli classici + personalizzato. */
export function ConfigPicker({ value, onChange, disabled }: Props) {
  const [custom, setCustom] = useState(difficultyOf(value) === 'custom');
  const active: DifficultyKey = custom ? 'custom' : difficultyOf(value);

  useEffect(() => {
    if (difficultyOf(value) === 'custom') setCustom(true);
  }, [value]);

  return (
    <div className="config-picker">
      <div className="segmented" role="radiogroup" aria-label="Difficoltà">
        {PRESETS.map(([key, d]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active === key}
            className={active === key ? 'active' : ''}
            disabled={disabled}
            onClick={() => {
              setCustom(false);
              onChange({ width: d.width, height: d.height, mines: d.mines });
            }}
          >
            <strong>{d.label}</strong>
            <small>{d.width}×{d.height} · {d.mines}</small>
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={active === 'custom'}
          className={active === 'custom' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setCustom(true)}
        >
          <strong>Personalizzato</strong>
          <small>scegli tu</small>
        </button>
      </div>
      {active === 'custom' && <CustomFields value={value} onChange={onChange} disabled={disabled} />}
    </div>
  );
}

function CustomFields({ value, onChange, disabled }: Props) {
  // Stato locale in stringa: si può scrivere liberamente, il valore si normalizza al blur.
  const [draft, setDraft] = useState({ width: String(value.width), height: String(value.height), mines: String(value.mines) });

  useEffect(() => {
    setDraft({ width: String(value.width), height: String(value.height), mines: String(value.mines) });
  }, [value.width, value.height, value.mines]);

  const commit = (next = draft) => {
    const cfg = clampConfig({ width: Number(next.width), height: Number(next.height), mines: Number(next.mines) });
    setDraft({ width: String(cfg.width), height: String(cfg.height), mines: String(cfg.mines) });
    if (cfg.width !== value.width || cfg.height !== value.height || cfg.mines !== value.mines) onChange(cfg);
  };

  const w = Number(draft.width) || value.width;
  const h = Number(draft.height) || value.height;

  const field = (key: keyof typeof draft, label: string, min: number, max: number) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft[key]}
        disabled={disabled}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        onBlur={() => commit()}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <small>{min}–{max}</small>
    </label>
  );

  return (
    <div className="custom-fields">
      {field('width', 'Larghezza', LIMITS.minWidth, LIMITS.maxWidth)}
      {field('height', 'Altezza', LIMITS.minHeight, LIMITS.maxHeight)}
      {field('mines', 'Mine', LIMITS.minMines, maxMines(Math.min(w, LIMITS.maxWidth), Math.min(h, LIMITS.maxHeight)))}
    </div>
  );
}
