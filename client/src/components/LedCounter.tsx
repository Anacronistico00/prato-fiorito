/** Display a 7 segmenti a 3 cifre, come quello del campo minato originale. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
};

// Poligoni di ogni segmento su un viewBox 13×23
const SHAPES: Record<string, string> = {
  a: '2,1 11,1 9,3 4,3',
  b: '11.5,1.5 11.5,10.5 10.5,11.5 9.5,10.5 9.5,3.5',
  c: '11.5,12.5 11.5,21.5 9.5,19.5 9.5,12.5 10.5,11.5',
  d: '2,22 11,22 9,20 4,20',
  e: '1.5,12.5 1.5,21.5 3.5,19.5 3.5,12.5 2.5,11.5',
  f: '1.5,1.5 1.5,10.5 2.5,11.5 3.5,10.5 3.5,3.5',
  g: '2.5,11.5 4,10.5 9,10.5 10.5,11.5 9,12.5 4,12.5',
};

function format(value: number): string {
  const v = Math.max(-99, Math.min(999, Math.trunc(value)));
  if (v < 0) return '-' + String(-v).padStart(2, '0');
  return String(v).padStart(3, '0');
}

export function LedCounter({ value, label }: { value: number; label: string }) {
  const text = format(value);
  return (
    <div className="led" role="img" aria-label={`${label}: ${value}`}>
      {[...text].map((ch, k) => (
        <svg key={k} viewBox="0 0 13 23" className="led-digit">
          {Object.entries(SHAPES).map(([seg, pts]) => (
            <polygon key={seg} points={pts} className={SEGMENTS[ch]?.includes(seg) ? 'on' : 'off'} />
          ))}
        </svg>
      ))}
    </div>
  );
}
