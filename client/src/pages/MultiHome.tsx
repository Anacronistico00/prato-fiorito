import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CODE_LENGTH, DEFAULT_SETTINGS, MAX_NAME_LENGTH, isValidCode, normalizeCode, normalizeSettings,
  type RoomSettings,
} from '@prato/shared';
import { RoomSettingsForm } from '../components/RoomSettingsForm';
import { useServerStatus } from '../hooks/useServerStatus';
import { JoinError, roomClient } from '../lib/roomClient';
import { usePlayerName } from '../lib/settings';
import { useStored } from '../lib/storage';

export function MultiHome() {
  const navigate = useNavigate();
  const status = useServerStatus();
  const [name, setName] = usePlayerName();
  const [stored, setSettings] = useStored<RoomSettings>('pf.roomSettings', DEFAULT_SETTINGS);
  const settings = normalizeSettings(stored);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length > 0;

  const run = async (kind: 'create' | 'join', fn: () => Promise<string>) => {
    setBusy(kind);
    setError(null);
    try {
      const roomCode = await fn();
      navigate(`/partita/${roomCode}`);
    } catch (e) {
      setError(e instanceof JoinError ? e.message : 'Impossibile raggiungere il server.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page multi">
      <ServerBadge status={status} />

      <section className="card">
        <label className="field wide">
          <span>Il tuo nome</span>
          <input
            value={name}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Come ti chiamano gli amici?"
            onChange={(e) => setName(e.target.value)}
            autoComplete="nickname"
          />
        </label>
      </section>

      <div className="create-join">
        <section className="card">
          <h2>Crea una partita</h2>
          <p className="muted">Ricevi un codice da condividere. Potrai cambiare le impostazioni anche dopo, nella stanza.</p>
          <RoomSettingsForm value={settings} onChange={setSettings} />
          <button
            type="button"
            className="btn primary big"
            disabled={!nameOk || busy != null}
            onClick={() => run('create', () => roomClient.create(name.trim(), settings))}
          >
            {busy === 'create' ? 'Creazione…' : 'Crea partita'}
          </button>
        </section>

        <section className="card">
          <h2>Unisciti</h2>
          <p className="muted">Inserisci il codice che ti ha mandato l'amico.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nameOk && isValidCode(code)) run('join', () => roomClient.join(code, name.trim()));
            }}
          >
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(normalizeCode(e.target.value))}
              placeholder="ABC123"
              maxLength={CODE_LENGTH}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-label="Codice partita"
            />
            <button type="submit" className="btn primary big" disabled={!nameOk || !isValidCode(code) || busy != null}>
              {busy === 'join' ? 'Entro…' : 'Entra'}
            </button>
          </form>
        </section>
      </div>

      {!nameOk && <p className="hint">Scegli un nome per creare o entrare in una partita.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

export function ServerBadge({ status }: { status: ReturnType<typeof useServerStatus> }) {
  const text = {
    checking: 'Controllo server…',
    waking: 'Il server si sta svegliando, può volerci fino a un minuto…',
    online: 'Server online',
    offline: 'Server non raggiungibile',
  }[status];
  return <div className={`server-badge ${status}`}><span className="dot" />{text}</div>;
}
