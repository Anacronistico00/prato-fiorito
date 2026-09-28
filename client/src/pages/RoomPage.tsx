import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MAX_CHAT_LENGTH, MAX_NAME_LENGTH, displaySeconds, elapsedMs, normalizeCode,
  type ChatMessage, type RoomView,
} from '@prato/shared';
import { Board } from '../components/Board';
import { GameFrame, type Face } from '../components/GameFrame';
import { Lives } from '../components/Lives';
import { NextRoundControls, RoomSettingsForm, SettingsSummary, modeRules } from '../components/RoomSettingsForm';
import { useNow } from '../hooks/useNow';
import { JoinError, roomClient, useRoomClient } from '../lib/roomClient';
import { usePlayerName, useSkin } from '../lib/settings';
import { RaceArea } from './RaceView';

export function RoomPage() {
  const params = useParams();
  const code = normalizeCode(params.code ?? '');
  const snap = useRoomClient();

  useEffect(() => {
    roomClient.resume(code);
  }, [code]);

  if (!snap.room && snap.error?.code === 'ROOM_NOT_FOUND') {
    return (
      <div className="page narrow">
        <section className="card center">
          <h2>Partita non trovata</h2>
          <p>Il codice <code>{code}</code> non corrisponde a nessuna partita attiva. Magari è finita o il server è stato riavviato.</p>
          <Link className="btn primary" to="/multi" onClick={() => roomClient.clearError()}>Torna al multiplayer</Link>
        </section>
      </div>
    );
  }

  if (!snap.session || snap.session.code !== code) return <JoinForm code={code} />;

  if (!snap.room || snap.room.code !== code) {
    return (
      <div className="page narrow">
        <section className="card center">
          <div className="spinner" aria-hidden />
          <p>{snap.status === 'reconnecting' ? 'Riconnessione al server…' : 'Connessione alla partita…'}</p>
        </section>
      </div>
    );
  }

  return <Room room={snap.room} me={snap.session.playerId} chat={snap.chat} offset={snap.clockOffset} reconnecting={snap.status !== 'open'} />;
}

function JoinForm({ code }: { code: string }) {
  const navigate = useNavigate();
  const [name, setName] = usePlayerName();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(roomClient.getSnapshot().error?.message ?? null);

  return (
    <div className="page narrow">
      <section className="card">
        <h2>Entra nella partita <code>{code}</code></h2>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setError(null);
            try {
              await roomClient.join(code, name.trim());
            } catch (err) {
              if (err instanceof JoinError && err.code === 'ROOM_NOT_FOUND') return; // gestito dalla pagina
              setError(err instanceof Error ? err.message : 'Errore di connessione');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field wide">
            <span>Il tuo nome</span>
            <input value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <button type="submit" className="btn primary big" disabled={!name.trim() || busy}>
            {busy ? 'Entro…' : 'Entra'}
          </button>
          <button type="button" className="link" onClick={() => navigate('/multi')}>Annulla</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

interface RoomProps {
  room: RoomView;
  me: string;
  chat: ChatMessage[];
  offset: number;
  reconnecting: boolean;
}

function Room({ room, me, chat, offset, reconnecting }: RoomProps) {
  const navigate = useNavigate();
  const [skin] = useSkin();
  const [pressing, setPressing] = useState(false);
  const [flagMode, setFlagMode] = useState(false);

  const b = room.board;
  const isHost = room.hostId === me;
  const myTurn = room.phase === 'playing' && room.turnPlayerId === me;
  const over = b.status === 'won' || b.status === 'lost';
  const byId = new Map(room.players.map((p) => [p.id, p]));
  const turnPlayer = room.turnPlayerId ? byId.get(room.turnPlayerId) : undefined;

  const race = room.settings.mode === 'race';
  const ticking = room.phase === 'playing' && (race || b.status === 'playing' || room.turnEndsAt != null);
  const now = useNow(ticking) + offset;
  const seconds = displaySeconds(b.startedAt, b.endedAt, now);
  const turnLeft = room.turnEndsAt ? Math.min(room.settings.turnSeconds * 1000, Math.max(0, room.turnEndsAt - now)) : null;

  // Titolo della scheda: avvisa quando tocca a te anche se sei su un'altra scheda.
  useEffect(() => {
    document.title = myTurn ? '🌼 Tocca a te! · Prato Fiorito' : `Partita ${room.code} · Prato Fiorito`;
    if (myTurn) navigator.vibrate?.(60);
    return () => {
      document.title = 'Prato Fiorito';
    };
  }, [myTurn, room.code]);

  const face: Face = b.status === 'won' ? 'cool' : b.status === 'lost' ? 'dead' : pressing ? 'wow' : 'smile';
  const last = room.lastAction;
  const highlight = last?.index != null ? { index: last.index, color: byId.get(last.playerId)?.color ?? '#000' } : null;

  const leave = () => {
    roomClient.leave();
    navigate('/multi');
  };

  return (
    <div className="page room">
      {reconnecting && <div className="banner warn">Connessione persa, riconnessione in corso…</div>}

      <RoomHeader code={room.code} onLeave={leave} />

      <div className="room-layout">
        <div className="room-main">
          <StatusBar room={room} me={me} turnPlayerName={turnPlayer?.name} turnLeft={turnLeft} byId={byId} />

          {room.phase === 'lobby' ? (
            <Lobby room={room} isHost={isHost} />
          ) : race ? (
            <RaceArea room={room} me={me} now={now} skin={skin} />
          ) : (
            <div className="game-area">
              <GameFrame
                minesLeft={b.mines - b.flags - b.hits}
                seconds={seconds}
                face={face}
                onFace={isHost && room.phase === 'ended' ? () => roomClient.start() : undefined}
                faceTitle={isHost && room.phase === 'ended' ? 'Nuova partita' : undefined}
              >
                <Board
                  width={b.width}
                  height={b.height}
                  view={b.view}
                  skin={skin}
                  canReveal={myTurn && !over}
                  canFlag={room.phase === 'playing' && !over}
                  flagMode={flagMode}
                  onReveal={(i) => roomClient.reveal(i)}
                  onChord={(i) => roomClient.chord(i)}
                  onFlag={(i) => roomClient.flag(i)}
                  onPressingChange={setPressing}
                  highlight={highlight}
                  dimmed={!myTurn && !over}
                />
              </GameFrame>

              {room.phase === 'playing' && (
                <div className="below-board">
                  <button
                    type="button"
                    className={`btn mode-toggle${flagMode ? ' on' : ''}`}
                    onClick={() => setFlagMode((f) => !f)}
                    aria-pressed={flagMode}
                  >
                    {flagMode ? '🚩 Modalità bandierina' : '⛏️ Modalità scava'}
                  </button>
                </div>
              )}

              {room.phase === 'ended' && <EndPanel room={room} byId={byId} flowers={skin === 'flower'} />}
            </div>
          )}

          {/* Fuori dai rami coop/sfida: resta montato anche se l'host cambia modalità. */}
          {room.phase === 'ended' && (
            <div className="card end-controls">
              {isHost ? (
                <NextRoundControls settings={room.settings} onStart={() => roomClient.start()} onChange={(s) => roomClient.configure(s)} />
              ) : (
                <span className="muted">In attesa che l'host avvii una nuova partita…</span>
              )}
            </div>
          )}
        </div>

        <aside className="room-side">
          <Players room={room} me={me} />
          <Chat chat={chat} me={me} />
        </aside>
      </div>
    </div>
  );
}

function RoomHeader({ code, onLeave }: { code: string; onLeave(): void }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? code : `${location.origin}/partita/${code}`;
    try {
      if (what === 'link' && navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Prato Fiorito', text: `Gioca con me a Prato Fiorito! Codice: ${code}`, url: text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* condivisione annullata o clipboard non disponibile */
    }
  };

  return (
    <div className="card room-header">
      <div>
        <span className="muted small">Codice partita</span>
        <div className="room-code" aria-label={`Codice ${code.split('').join(' ')}`}>{code}</div>
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={() => copy('code')}>{copied === 'code' ? 'Copiato ✓' : 'Copia codice'}</button>
        <button type="button" className="btn" onClick={() => copy('link')}>{copied === 'link' ? 'Copiato ✓' : 'Invita'}</button>
        <button type="button" className="btn danger" onClick={onLeave}>Esci</button>
      </div>
    </div>
  );
}

function StatusBar({ room, me, turnPlayerName, turnLeft, byId }: {
  room: RoomView; me: string; turnPlayerName?: string; turnLeft: number | null; byId: Map<string, RoomView['players'][number]>;
}) {
  if (room.phase === 'lobby') {
    const host = byId.get(room.hostId);
    return (
      <div className="status-bar">
        {room.hostId === me ? 'Sei l\'host: scegli le impostazioni e avvia quando siete pronti.' : `In attesa che ${host?.name ?? 'l\'host'} avvii la partita…`}
      </div>
    );
  }
  if (room.phase === 'ended') return null;

  if (room.settings.mode === 'race') {
    const inGame = room.players.filter((p) => p.board?.status === 'playing').length;
    return (
      <div className="status-bar turn">
        <span><strong>⚔️ Sfida in corso</strong> · stesse mine per tutti, ognuno sul suo campo</span>
        <span className="muted small">{inGame} ancora in gioco</span>
        {room.hostId === me && (
          <button
            type="button"
            className="btn small"
            onClick={() => confirm('Terminare la sfida adesso? Vince chi ha più punti in questo momento.') && roomClient.endRace()}
          >
            Termina sfida
          </button>
        )}
      </div>
    );
  }

  const myTurn = room.turnPlayerId === me;
  const color = room.turnPlayerId ? byId.get(room.turnPlayerId)?.color : undefined;
  const { lives, turnSeconds } = room.settings;
  return (
    <div className={`status-bar turn${myTurn ? ' mine' : ''}`} style={{ '--pc': color } as React.CSSProperties}>
      <span>
        {myTurn ? <strong>Tocca a te! Scopri una cella.</strong> : turnPlayerName ? <>Turno di <strong>{turnPlayerName}</strong></> : 'In attesa di giocatori…'}
      </span>
      <span className="team-lives">
        <span className="muted small">Vite squadra</span>
        <Lives total={lives} left={Math.max(0, lives - room.board.hits)} size="sm" />
      </span>
      {turnLeft != null && turnSeconds > 0 && (
        <div className="turn-timer" aria-label={`${Math.ceil(turnLeft / 1000)} secondi rimasti`}>
          <div className="bar" style={{ width: `${(turnLeft / (turnSeconds * 1000)) * 100}%` }} />
          <span>{Math.ceil(turnLeft / 1000)}s</span>
        </div>
      )}
    </div>
  );
}

function Lobby({ room, isHost }: { room: RoomView; isHost: boolean }) {
  const connected = room.players.filter((p) => p.connected).length;
  return (
    <section className="card lobby">
      <h2>Impostazioni</h2>
      {isHost ? (
        <>
          <RoomSettingsForm value={room.settings} onChange={(s) => roomClient.configure(s)} />
          <button type="button" className="btn primary big" onClick={() => roomClient.start()}>
            Inizia partita ({connected} giocator{connected === 1 ? 'e' : 'i'})
          </button>
        </>
      ) : (
        <SettingsSummary settings={room.settings} />
      )}
      <div className="rules-mini">
        <strong>Come si gioca: {room.settings.mode === 'race' ? 'sfida' : 'cooperativa'}</strong>
        <p>{modeRules(room.settings)}</p>
      </div>
    </section>
  );
}

function EndPanel({ room, byId, flowers }: { room: RoomView; byId: Map<string, RoomView['players'][number]>; flowers: boolean }) {
  const won = room.board.status === 'won';
  const culprit = !won && room.lastAction ? byId.get(room.lastAction.playerId) : undefined;
  const secs = Math.floor(elapsedMs(room.board.startedAt, room.board.endedAt) / 1000);

  return (
    <div className={`result ${won ? 'won' : 'lost'}`} role="status">
      <strong>{won ? `🌼 Vittoria di squadra in ${secs} s!` : `💥 ${culprit?.name ?? 'Qualcuno'} ha ${flowers ? 'calpestato l\'ultimo fiore' : 'trovato l\'ultima mina'}!`}</strong>
      <ol className="scoreboard">
        {[...room.players].sort((a, b) => b.score - a.score).map((p) => (
          <li key={p.id}><span className="swatch" style={{ background: p.color }} />{p.name} — {p.score} punti</li>
        ))}
      </ol>
    </div>
  );
}

function Players({ room, me }: { room: RoomView; me: string }) {
  return (
    <section className="card players">
      <h3>Giocatori ({room.players.length})</h3>
      <ul>
        {room.players.map((p) => (
          <li key={p.id} className={`${p.connected ? '' : 'offline'}${room.turnPlayerId === p.id ? ' active' : ''}`}>
            <span className="swatch" style={{ background: p.color }} />
            <span className="name">
              {p.name}
              {p.id === me && <em> (tu)</em>}
            </span>
            {p.id === room.hostId && <span title="Host">👑</span>}
            {room.turnPlayerId === p.id && <span className="turn-dot" title="Di turno">▶</span>}
            {!p.connected && <span className="muted small">offline</span>}
            {p.board && <Lives total={p.board.lives} left={Math.max(0, p.board.lives - p.board.hits)} size="sm" />}
            {room.phase !== 'lobby' && <span className="muted small" title="Punti">{p.score}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Chat({ chat, me }: { chat: ChatMessage[]; me: string }) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  return (
    <section className="card chat">
      <h3>Chat</h3>
      <div className="chat-list" ref={listRef} aria-live="polite">
        {chat.length === 0 && <p className="muted small">Nessun messaggio.</p>}
        {chat.map((m) => (
          <div key={m.id} className={`msg${m.system ? ' system' : ''}${m.playerId === me ? ' own' : ''}`}>
            {!m.system && <strong style={{ color: m.color }}>{m.name}: </strong>}
            <span>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          roomClient.chat(text);
          setText('');
        }}
      >
        <input value={text} maxLength={MAX_CHAT_LENGTH} onChange={(e) => setText(e.target.value)} placeholder="Scrivi…" aria-label="Messaggio" />
        <button type="submit" className="btn" disabled={!text.trim()}>Invia</button>
      </form>
    </section>
  );
}
