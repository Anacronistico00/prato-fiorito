import { useState } from 'react';
import { displaySeconds, rankPlayers, type PublicPlayer, type RoomView } from '@prato/shared';
import { Board } from '../components/Board';
import { GameFrame, type Face } from '../components/GameFrame';
import { Lives } from '../components/Lives';
import { MiniBoard } from '../components/MiniBoard';
import { roomClient } from '../lib/roomClient';
import type { Skin } from '../lib/settings';

const livesLeft = (p: PublicPlayer) => (p.board ? Math.max(0, p.board.lives - p.board.hits) : 0);

function statusLabel(p: PublicPlayer, ended = false): string {
  if (!p.board) return 'spettatore';
  if (p.board.status === 'won') return '🌼 campo pulito';
  if (p.board.status === 'lost') return '💀 eliminato';
  if (ended) return 'ancora in gara';
  return p.connected ? 'in gioco' : 'offline';
}

/** Modalità sfida: il tuo campo grande, sotto i campi degli altri in tempo reale. */
export function RaceArea({ room, me, now, skin }: {
  room: RoomView; me: string; now: number; skin: Skin;
}) {
  const [pressing, setPressing] = useState(false);
  const [flagMode, setFlagMode] = useState(false);

  const mine = room.players.find((p) => p.id === me);
  const b = mine?.board ?? null;
  const racing = room.phase === 'playing' && b?.status === 'playing';
  const ranking = rankPlayers(room.players.filter((p) => p.board));
  const position = mine ? ranking.findIndex((p) => p.id === me) + 1 : 0;
  const others = room.players.filter((p) => p.id !== me && p.board);

  const face: Face = b?.status === 'won' ? 'cool' : b?.status === 'lost' ? 'dead' : pressing ? 'wow' : 'smile';

  return (
    <div className="race">
      <div className="game-area">
        {b ? (
          <>
            <div className="my-stats">
              <Lives total={b.lives} left={livesLeft(mine!)} />
              <span className="score"><strong>{mine!.score}</strong> punti</span>
              {ranking.length > 1 && <span className="muted">{position}° su {ranking.length}</span>}
            </div>
            <GameFrame
              minesLeft={b.mines - b.flags - b.hits}
              seconds={displaySeconds(b.startedAt, b.endedAt, now)}
              face={face}
            >
              <Board
                width={b.width}
                height={b.height}
                view={b.view}
                skin={skin}
                canReveal={racing}
                canFlag={racing}
                flagMode={flagMode}
                onReveal={(i) => roomClient.reveal(i)}
                onChord={(i) => roomClient.chord(i)}
                onFlag={(i) => roomClient.flag(i)}
                onPressingChange={setPressing}
                dimmed={!racing && room.phase === 'playing'}
              />
            </GameFrame>
            {racing && (
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
            {room.phase === 'playing' && b.status !== 'playing' && (
              <p className="banner info">
                {b.status === 'won' ? '🌼 Hai ripulito il campo! Aspetta che finiscano gli altri.' : '💀 Sei stato eliminato: guarda come va a finire.'}
              </p>
            )}
          </>
        ) : (
          <p className="banner info">Sei entrato a sfida iniziata: guardi questo round e giochi dal prossimo.</p>
        )}

        {room.phase === 'ended' && (
          <div className="result won" role="status">
            <strong>🏆 {ranking[0]?.name ?? '—'} vince la sfida!</strong>
            <table className="ranking">
              <thead>
                <tr><th>#</th><th>Giocatore</th><th>Punti</th><th>Vite</th><th>Esito</th></tr>
              </thead>
              <tbody>
                {ranking.map((p, k) => (
                  <tr key={p.id} className={p.id === me ? 'me' : ''}>
                    <td>{k + 1}</td>
                    <td><span className="swatch" style={{ background: p.color }} /> {p.name}</td>
                    <td>{p.score}</td>
                    <td>{p.board ? `${livesLeft(p)}/${p.board.lives}` : '—'}</td>
                    <td>
                      {p.board?.status === 'won' && p.board.startedAt && p.board.endedAt
                        ? `pulito in ${displaySeconds(p.board.startedAt, p.board.endedAt)} s`
                        : statusLabel(p, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {others.length > 0 && (
        <section className="opponents">
          <h3>Avversari</h3>
          <div className="opponents-grid">
            {others.map((p) => (
              <div key={p.id} className={`opponent card ${p.board!.status}${p.connected ? '' : ' offline'}`}>
                <div className="opp-head">
                  <span className="swatch" style={{ background: p.color }} />
                  <strong className="name">{p.name}</strong>
                  <span className="opp-score">{p.score} pt</span>
                </div>
                <div className="opp-sub">
                  <Lives total={p.board!.lives} left={livesLeft(p)} size="sm" />
                  <span className="muted small">{statusLabel(p, room.phase === 'ended')}</span>
                </div>
                <MiniBoard board={p.board!} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
