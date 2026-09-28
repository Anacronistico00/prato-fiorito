import { useEffect, useRef } from 'react';
import { View, type BoardView } from '@prato/shared';

const NUM_COLORS = ['', '#0000ff', '#008000', '#ff0000', '#000080', '#800000', '#008080', '#000000', '#808080'];

/** Anteprima in miniatura (canvas) del campo di un avversario, aggiornata in tempo reale. */
export function MiniBoard({ board, maxWidth = 240 }: { board: BoardView; maxWidth?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cell = Math.max(3, Math.min(14, Math.floor(maxWidth / board.width)));

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = board.width * cell;
    const h = board.height * cell;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.floor(cell * 0.75)}px Verdana, sans-serif`;

    board.view.forEach((v, i) => {
      const x = (i % board.width) * cell;
      const y = Math.floor(i / board.width) * cell;
      const covered = v === View.HIDDEN || v === View.QUESTION || v === View.FLAG;
      if (covered) {
        ctx.fillStyle = '#9d9d9d';
        ctx.fillRect(x, y, cell, cell);
        if (cell >= 6) {
          ctx.fillStyle = '#e4e4e4';
          ctx.fillRect(x, y, cell - 1, 1);
          ctx.fillRect(x, y, 1, cell - 1);
        }
        if (v === View.FLAG) {
          ctx.fillStyle = '#e00';
          const m = Math.max(1, Math.floor(cell / 4));
          ctx.fillRect(x + m, y + m, cell - 2 * m, cell - 2 * m);
        }
      } else {
        ctx.fillStyle = v === View.EXPLODED ? '#ff2020' : v === View.WRONG_FLAG ? '#ffb3b3' : '#d6d6d6';
        ctx.fillRect(x, y, cell, cell);
        if (v === View.MINE || v === View.EXPLODED) {
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.3, 0, Math.PI * 2);
          ctx.fill();
        } else if (v >= 1 && v <= 8 && cell >= 9) {
          ctx.fillStyle = NUM_COLORS[v];
          ctx.fillText(String(v), x + cell / 2, y + cell / 2 + 0.5);
        } else if (v >= 1 && v <= 8) {
          ctx.fillStyle = NUM_COLORS[v];
          ctx.globalAlpha = 0.45;
          ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
          ctx.globalAlpha = 1;
        }
      }
      if (cell >= 6) {
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.fillRect(x + cell - 1, y, 1, cell);
        ctx.fillRect(x, y + cell - 1, cell, 1);
      }
    });
  }, [board, cell]);

  return <canvas ref={ref} className="mini-board" aria-hidden />;
}
