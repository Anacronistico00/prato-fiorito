/** Cuori pieni per le vite rimaste, vuoti per quelle perse. */
export function Lives({ total, left, size = 'md' }: { total: number; left: number; size?: 'sm' | 'md' }) {
  return (
    <span className={`lives ${size}`} role="img" aria-label={`${left} vite su ${total}`} title={`${left}/${total} vite`}>
      {Array.from({ length: total }, (_, k) => (
        <span key={k} className={k < left ? 'heart on' : 'heart off'}>{k < left ? '❤' : '♡'}</span>
      ))}
    </span>
  );
}
