import type { Skin } from '../lib/settings';

export function MineIcon() {
  return (
    <svg viewBox="0 0 16 16" className="icon" aria-hidden>
      <g stroke="#000" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="1.5" x2="8" y2="14.5" />
        <line x1="1.5" y1="8" x2="14.5" y2="8" />
        <line x1="3.4" y1="3.4" x2="12.6" y2="12.6" />
        <line x1="12.6" y1="3.4" x2="3.4" y2="12.6" />
      </g>
      <circle cx="8" cy="8" r="4.6" fill="#000" />
      <rect x="5.6" y="5.6" width="1.8" height="1.8" fill="#fff" />
    </svg>
  );
}

export function FlowerIcon() {
  return (
    <svg viewBox="0 0 32 32" className="icon" aria-hidden>
      <g fill="#fff" stroke="#d19a00" strokeWidth="1.2">
        <circle cx="16" cy="7.5" r="6" />
        <circle cx="24.1" cy="13.4" r="6" />
        <circle cx="21" cy="23" r="6" />
        <circle cx="11" cy="23" r="6" />
        <circle cx="7.9" cy="13.4" r="6" />
      </g>
      <circle cx="16" cy="16" r="5.4" fill="#f5c400" stroke="#b07800" strokeWidth="1.2" />
    </svg>
  );
}

export function FlagIcon() {
  return (
    <svg viewBox="0 0 16 16" className="icon" aria-hidden>
      <polygon points="9,2 9,9 3.5,5.5" fill="#e00" />
      <rect x="8.2" y="2" width="1.6" height="9" fill="#000" />
      <rect x="6" y="11" width="6" height="1.4" fill="#000" />
      <rect x="4" y="12.4" width="10" height="1.8" fill="#000" />
    </svg>
  );
}

export function HazardIcon({ skin }: { skin: Skin }) {
  return skin === 'flower' ? <FlowerIcon /> : <MineIcon />;
}

export function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" className="icon cross" aria-hidden>
      <g stroke="#e00" strokeWidth="1.8" strokeLinecap="round">
        <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" />
        <line x1="13.5" y1="2.5" x2="2.5" y2="13.5" />
      </g>
    </svg>
  );
}
