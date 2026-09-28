import type { ReactNode } from 'react';
import { LedCounter } from './LedCounter';

export type Face = 'smile' | 'wow' | 'cool' | 'dead';

const FACES: Record<Face, string> = { smile: '🙂', wow: '😮', cool: '😎', dead: '😵' };

interface Props {
  minesLeft: number;
  seconds: number;
  face: Face;
  onFace?(): void;
  faceTitle?: string;
  children: ReactNode;
}

/** Cornice "classica": contatore mine, faccina, timer e la griglia. */
export function GameFrame({ minesLeft, seconds, face, onFace, faceTitle, children }: Props) {
  return (
    <div className="frame raised">
      <div className="frame-header sunken">
        <LedCounter value={minesLeft} label="Mine rimanenti" />
        <button
          type="button"
          className="face raised"
          onClick={onFace}
          disabled={!onFace}
          title={faceTitle}
          aria-label={faceTitle ?? 'Stato partita'}
        >
          <span>{FACES[face]}</span>
        </button>
        <LedCounter value={seconds} label="Secondi" />
      </div>
      {children}
    </div>
  );
}
