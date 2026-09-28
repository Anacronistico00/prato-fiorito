import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DIFFICULTIES, chord, clampConfig, displaySeconds, createGame, difficultyOf, elapsedMs, reveal, toView, toggleMark,
  type BoardConfig, type Game,
} from '@prato/shared';
import { Board } from '../components/Board';
import { ConfigPicker } from '../components/ConfigPicker';
import { GameFrame, type Face } from '../components/GameFrame';
import { useNow } from '../hooks/useNow';
import { useSkin } from '../lib/settings';
import { useStored } from '../lib/storage';

type Records = Partial<Record<'beginner' | 'intermediate' | 'expert', number>>;

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(2).replace('.', ',')} s`;

export function SinglePlayer() {
  const [storedConfig, setConfig] = useStored<BoardConfig>('pf.config', DIFFICULTIES.beginner);
  const config = useMemo(() => clampConfig(storedConfig), [storedConfig]);
  const [questionMarks, setQuestionMarks] = useStored('pf.questionMarks', true);
  const [skin, setSkin] = useSkin();
  const [flagMode, setFlagMode] = useState(false);
  const [records, setRecords] = useStored<Records>('pf.records', {});
  const [newRecord, setNewRecord] = useState(false);
  const [pressing, setPressing] = useState(false);

  const gameRef = useRef<Game>(createGame(config));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const newGame = useCallback(() => {
    gameRef.current = createGame(config);
    setNewRecord(false);
    setFlagMode(false);
    setVersion((v) => v + 1);
  }, [config]);

  // Cambio difficoltà → nuova partita
  useEffect(newGame, [newGame]);

  const g = gameRef.current;
  // `version` cambia a ogni mossa: il gioco è mutabile, quindi la vista va ricalcolata.
  const view = useMemo(() => toView(g), [g, version]);
  const now = useNow(g.status === 'playing');
  const ms = elapsedMs(g.startedAt, g.endedAt, now);

  const afterMove = () => {
    const game = gameRef.current;
    if (game.status === 'won') {
      const key = difficultyOf(config);
      const time = elapsedMs(game.startedAt, game.endedAt);
      if (key !== 'custom' && (records[key] == null || time < records[key]!)) {
        setRecords({ ...records, [key]: time });
        setNewRecord(true);
      }
    }
    bump();
  };

  const onReveal = (i: number) => reveal(gameRef.current, i) && afterMove();
  const onChord = (i: number) => chord(gameRef.current, i) && afterMove();
  const onFlag = (i: number) => toggleMark(gameRef.current, i, questionMarks) && bump();

  // Scorciatoie: F2 / N = nuova partita, F = modalità bandierina
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'F2' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newGame();
      } else if (e.key.toLowerCase() === 'f') {
        setFlagMode((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newGame]);

  const over = g.status === 'won' || g.status === 'lost';
  const face: Face = g.status === 'won' ? 'cool' : g.status === 'lost' ? 'dead' : pressing ? 'wow' : 'smile';

  return (
    <div className="page single">
      <section className="card toolbar">
        <ConfigPicker value={config} onChange={setConfig} />
        <div className="toggles">
          <label className="switch">
            <input type="checkbox" checked={skin === 'flower'} onChange={(e) => setSkin(e.target.checked ? 'flower' : 'mine')} />
            <span>Fiori al posto delle mine</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={questionMarks} onChange={(e) => setQuestionMarks(e.target.checked)} />
            <span>Punti interrogativi (?)</span>
          </label>
        </div>
      </section>

      <div className="game-area">
        <GameFrame
          minesLeft={g.mines - g.flags}
          seconds={displaySeconds(g.startedAt, g.endedAt, now)}
          face={face}
          onFace={newGame}
          faceTitle="Nuova partita (F2)"
        >
          <Board
            width={g.width}
            height={g.height}
            view={view}
            skin={skin}
            canReveal={!over}
            canFlag={!over}
            flagMode={flagMode}
            onReveal={onReveal}
            onChord={onChord}
            onFlag={onFlag}
            onPressingChange={setPressing}
          />
        </GameFrame>

        <div className="below-board">
          <button
            type="button"
            className={`btn mode-toggle${flagMode ? ' on' : ''}`}
            onClick={() => setFlagMode((f) => !f)}
            aria-pressed={flagMode}
            title="Modalità bandierina (F)"
          >
            {flagMode ? '🚩 Modalità bandierina' : '⛏️ Modalità scava'}
          </button>
          <button type="button" className="btn" onClick={newGame}>Nuova partita</button>
        </div>

        {over && (
          <div className={`result ${g.status}`} role="status">
            {g.status === 'won' ? (
              <>
                <strong>{skin === 'flower' ? '🌼' : '🎉'} Hai vinto in {fmtTime(ms)}!</strong>
                {newRecord && <span className="badge">Nuovo record!</span>}
              </>
            ) : (
              <strong>💥 {skin === 'flower' ? 'Hai calpestato un fiore!' : 'Boom! Hai trovato una mina.'}</strong>
            )}
            <button type="button" className="btn primary" onClick={newGame}>Rigioca</button>
          </div>
        )}
      </div>

      <section className="card records">
        <h2>Migliori tempi</h2>
        <table>
          <tbody>
            {(Object.keys(DIFFICULTIES) as (keyof typeof DIFFICULTIES)[]).map((k) => (
              <tr key={k} className={difficultyOf(config) === k ? 'current' : ''}>
                <th>{DIFFICULTIES[k].label}</th>
                <td>{records[k] != null ? fmtTime(records[k]!) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(records).length > 0 && (
          <button type="button" className="link" onClick={() => confirm('Azzerare tutti i record?') && setRecords({})}>
            Azzera record
          </button>
        )}
      </section>
    </div>
  );
}
