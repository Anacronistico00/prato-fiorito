import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from '@prato/shared';
import type { Skin } from '../lib/settings';
import { CrossIcon, FlagIcon, HazardIcon } from './Icons';

export interface BoardProps {
  width: number;
  height: number;
  view: number[];
  skin: Skin;
  /** Può scoprire celle (in multiplayer: solo nel proprio turno). */
  canReveal: boolean;
  canFlag: boolean;
  /** Modalità bandierina (touch): il tap mette bandiere invece di scoprire. */
  flagMode?: boolean;
  onReveal(i: number): void;
  onChord(i: number): void;
  onFlag(i: number): void;
  /** Mentre un tasto è premuto (per la faccina "😮"). */
  onPressingChange?(pressing: boolean): void;
  highlight?: { index: number; color: string } | null;
  dimmed?: boolean;
}

type Pressed = { index: number; chord: boolean } | null;
type MouseMode = 'left' | 'right' | 'chord' | 'done';

const LONG_PRESS_MS = 380;
const isNumber = (v: number) => v >= 1 && v <= 8;
const isCovered = (v: number) => v === View.HIDDEN || v === View.QUESTION;

function indexOf(target: EventTarget | null): number | null {
  const el = (target as HTMLElement | null)?.closest?.('[data-i]') as HTMLElement | null;
  return el ? Number(el.dataset.i) : null;
}

export function Board(props: BoardProps) {
  const { width, height, view, skin, canReveal, highlight, dimmed } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(28);
  const [pressed, setPressed] = useState<Pressed>(null);

  // Le callback cambiano a ogni render: le leggiamo da un ref per non ri-registrare i listener.
  const live = useRef(props);
  live.current = props;

  // ───────── dimensione celle adattiva ─────────
  useLayoutEffect(() => {
    // Misuriamo un contenitore a larghezza piena (non la cornice, che si adatta alla griglia).
    const el = (wrapRef.current?.closest('.game-area') ?? wrapRef.current?.parentElement) as HTMLElement | null;
    if (!el) return;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const compute = () => {
      const avail = el.clientWidth - 40;
      const size = Math.floor(avail / width);
      setCell(Math.max(coarse ? 26 : 18, Math.min(34, size)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  const press = useCallback((index: number | null, chordLike: boolean) => {
    setPressed(index == null ? null : { index, chord: chordLike });
  }, []);

  /** Azione "principale" su una cella (click sinistro / tap). */
  const primary = useCallback((i: number, asFlag: boolean) => {
    const p = live.current;
    const v = p.view[i];
    if (isNumber(v)) {
      if (p.canReveal) p.onChord(i);
    } else if (asFlag) {
      if (p.canFlag && (isCovered(v) || v === View.FLAG)) p.onFlag(i);
    } else if (isCovered(v)) {
      if (p.canReveal) p.onReveal(i);
    }
  }, []);

  // ───────── mouse (con chording sinistro+destro e tasto centrale) ─────────
  const mouse = useRef<{ mode: MouseMode; index: number | null } | null>(null);

  const endPress = useCallback(() => {
    mouse.current = null;
    setPressed(null);
    live.current.onPressingChange?.(false);
  }, []);

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      const st = mouse.current;
      if (!st) return;
      const i = st.index;
      if (st.mode === 'chord') {
        if (i != null && live.current.canReveal && isNumber(live.current.view[i])) live.current.onChord(i);
        st.mode = 'done';
      } else if (st.mode === 'left' && e.button === 0 && i != null) {
        primary(i, !!live.current.flagMode);
      }
      if (e.buttons === 0) endPress();
      else setPressed(null);
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [primary, endPress]);

  const onMouseDown = (e: React.MouseEvent) => {
    const i = indexOf(e.target);
    const p = live.current;
    let mode: MouseMode;
    if (e.button === 1) {
      e.preventDefault();
      mode = 'chord';
    } else if (e.button === 2) {
      if (e.buttons & 1) mode = 'chord';
      else {
        mode = 'right';
        if (i != null && p.canFlag) p.onFlag(i);
      }
    } else if (e.button === 0) {
      mode = e.buttons & 2 ? 'chord' : 'left';
    } else return;

    mouse.current = { mode, index: i };
    if (mode === 'right' || !p.canReveal) return;
    press(i, mode === 'chord' || (i != null && isNumber(p.view[i])));
    p.onPressingChange?.(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const st = mouse.current;
    if (!st || st.mode === 'right' || st.mode === 'done') return;
    const i = indexOf(e.target);
    if (i === st.index) return;
    st.index = i;
    if (live.current.canReveal) press(i, st.mode === 'chord' || (i != null && isNumber(live.current.view[i])));
  };

  const onMouseLeave = () => {
    if (mouse.current) {
      mouse.current.index = null;
      setPressed(null);
    }
  };

  // ───────── touch: tap = azione, pressione lunga = bandierina ─────────
  const touch = useRef<{ i: number; x: number; y: number; fired: boolean; moved: boolean; timer: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (touch.current) clearTimeout(touch.current.timer);
    if (e.touches.length > 1) {
      touch.current = null;
      setPressed(null);
      return;
    }
    const i = indexOf(e.target);
    if (i == null) return;
    const t = e.touches[0];
    const st = { i, x: t.clientX, y: t.clientY, fired: false, moved: false, timer: 0 };
    st.timer = window.setTimeout(() => {
      if (st.moved) return;
      st.fired = true;
      setPressed(null);
      // In modalità bandierina la pressione lunga fa l'opposto: scopre.
      primary(i, !live.current.flagMode);
      navigator.vibrate?.(25);
    }, LONG_PRESS_MS);
    touch.current = st;
    if (live.current.canReveal && !live.current.flagMode) press(i, isNumber(live.current.view[i]));
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const st = touch.current;
    if (!st) return;
    const t = e.touches[0];
    if (Math.hypot(t.clientX - st.x, t.clientY - st.y) > 10) {
      st.moved = true;
      clearTimeout(st.timer);
      setPressed(null);
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const st = touch.current;
    touch.current = null;
    setPressed(null);
    if (!st) return;
    clearTimeout(st.timer);
    if (st.moved) return;
    e.preventDefault(); // niente eventi mouse "emulati" dopo il tap
    if (!st.fired) primary(st.i, !!live.current.flagMode);
  };

  const onTouchCancel = () => {
    if (touch.current) clearTimeout(touch.current.timer);
    touch.current = null;
    setPressed(null);
  };

  // ───────── celle "premute" (visuale) ─────────
  const pressedSet = new Set<number>();
  if (pressed) {
    const { index, chord } = pressed;
    if (chord) {
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) pressedSet.add(ny * width + nx);
        }
    } else {
      pressedSet.add(index);
    }
  }

  return (
    <div className="board-scroll">
      <div
        ref={wrapRef}
        className={`board sunken${dimmed ? ' dimmed' : ''}${canReveal ? '' : ' no-reveal'}`}
        style={{ '--cell': `${cell}px`, gridTemplateColumns: `repeat(${width}, var(--cell))` } as React.CSSProperties}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        role="grid"
        aria-label={`Campo ${width} per ${height}`}
      >
        {view.map((v, i) => (
          <CellView
            key={i}
            i={i}
            v={v}
            skin={skin}
            pressed={pressedSet.has(i) && isCovered(v)}
            highlight={highlight?.index === i ? highlight.color : undefined}
          />
        ))}
      </div>
    </div>
  );
}

const CellView = memo(function CellView({
  i, v, skin, pressed, highlight,
}: { i: number; v: number; skin: Skin; pressed: boolean; highlight?: string }) {
  let cls = 'cell';
  let content: React.ReactNode = null;

  if (v === View.HIDDEN) cls += pressed ? ' open' : ' covered';
  else if (v === View.QUESTION) {
    cls += pressed ? ' open' : ' covered';
    content = <span className="q">?</span>;
  } else if (v === View.FLAG) {
    cls += ' covered';
    content = <FlagIcon />;
  } else if (v >= 0 && v <= 8) {
    cls += ` open n${v}`;
    if (v > 0) content = v;
  } else if (v === View.MINE) {
    cls += ' open';
    content = <HazardIcon skin={skin} />;
  } else if (v === View.EXPLODED) {
    cls += ' open exploded';
    content = <HazardIcon skin={skin} />;
  } else if (v === View.WRONG_FLAG) {
    cls += ' open';
    content = (
      <>
        <HazardIcon skin={skin} />
        <CrossIcon />
      </>
    );
  }

  return (
    <div
      className={cls}
      data-i={i}
      style={highlight ? ({ '--hl': highlight } as React.CSSProperties) : undefined}
      data-hl={highlight ? '' : undefined}
    >
      {content}
    </div>
  );
});
