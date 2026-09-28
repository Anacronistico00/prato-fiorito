import { useState } from 'react';
import { MAX_LIVES, TURN_OPTIONS, configLabel, type GameMode, type RoomSettings } from '@prato/shared';
import { ConfigPicker } from './ConfigPicker';

export const turnLabel = (s: number) => (s === 0 ? 'Illimitato' : `${s} s`);

const MODES: { key: GameMode; label: string; hint: string }[] = [
  { key: 'coop', label: '🤝 Cooperativa', hint: 'Un campo condiviso, a turni' },
  { key: 'race', label: '⚔️ Sfida', hint: 'Un campo a testa, stesse mine, tutti insieme' },
];

/** Impostazioni della stanza scelte dall'host: modalità, campo, vite, tempo per turno. */
export function RoomSettingsForm({ value, onChange }: { value: RoomSettings; onChange(s: RoomSettings): void }) {
  const set = (patch: Partial<RoomSettings>) => onChange({ ...value, ...patch });
  const race = value.mode === 'race';

  return (
    <div className="settings-form">
      <div className="segmented modes" role="radiogroup" aria-label="Modalità">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={value.mode === m.key}
            className={value.mode === m.key ? 'active' : ''}
            onClick={() => set({ mode: m.key })}
          >
            <strong>{m.label}</strong>
            <small>{m.hint}</small>
          </button>
        ))}
      </div>

      <ConfigPicker value={value.config} onChange={(config) => set({ config })} />

      <div className="settings-row">
        <div className="field">
          <span>{race ? 'Vite per giocatore' : 'Vite della squadra'}</span>
          <div className="lives-picker" role="radiogroup" aria-label="Vite">
            {Array.from({ length: MAX_LIVES }, (_, k) => k + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value.lives === n}
                aria-label={`${n} vite`}
                className={value.lives >= n ? 'on' : ''}
                onClick={() => set({ lives: n })}
              >
                ❤
              </button>
            ))}
          </div>
        </div>

        {!race && (
          <label className="field">
            <span>Tempo per turno</span>
            <select value={value.turnSeconds} onChange={(e) => set({ turnSeconds: Number(e.target.value) })}>
              {TURN_OPTIONS.map((s) => <option key={s} value={s}>{turnLabel(s)}</option>)}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

export function SettingsSummary({ settings }: { settings: RoomSettings }) {
  const race = settings.mode === 'race';
  return (
    <ul className="plain">
      <li>Modalità: <strong>{race ? '⚔️ Sfida' : '🤝 Cooperativa'}</strong></li>
      <li>Campo: <strong>{configLabel(settings.config)}</strong></li>
      <li>{race ? 'Vite per giocatore' : 'Vite della squadra'}: <strong>{'❤'.repeat(settings.lives)}</strong></li>
      {!race && <li>Tempo per turno: <strong>{turnLabel(settings.turnSeconds)}</strong></li>}
    </ul>
  );
}

export function modeRules(settings: RoomSettings): string {
  return settings.mode === 'race'
    ? `Ognuno ha il suo campo, con le stesse mine per tutti, e si gioca in contemporanea. L'apertura iniziale è uguale per tutti e non dà punti. Ogni cella scoperta vale 1 punto. Hai ${settings.lives} ${settings.lives === 1 ? 'vita' : 'vite'}: a zero sei eliminato e tieni i punti fatti. Vince chi ha più punti; a parità, chi ha ripulito il campo prima.`
    : `Il campo è uno solo. A turno ognuno scopre una cella (o fa un "chord" su un numero); le bandierine sono libere per tutti. Ogni mina costa una vita alla squadra (ne avete ${settings.lives}): a zero perdete tutti. Le celle del primo click si dividono in parti uguali, poi ogni cella scoperta vale 1 punto a chi l'ha aperta.`;
}

/** Fine partita, lato host: nuovo round subito oppure cambia impostazioni prima. */
export function NextRoundControls({ settings, onStart, onChange }: {
  settings: RoomSettings;
  onStart(): void;
  onChange(s: RoomSettings): void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="stack next-round">
      <button type="button" className="btn primary" onClick={onStart}>Nuova partita</button>
      <button type="button" className="link" onClick={() => setEditing((e) => !e)}>
        {editing ? 'Chiudi impostazioni' : 'Cambia impostazioni'}
      </button>
      {editing && <RoomSettingsForm value={settings} onChange={onChange} />}
    </div>
  );
}
