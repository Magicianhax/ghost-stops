// components/gummy/ghost.tsx — the Money Gummy mascot + icon set, ported from
// the design's ui.jsx. Ghost fill/cheek colors adapt to the active theme via
// CSS vars set in terminal.css.

export function Ghost({ size = 40, float = false, blink = false, className = "", style }: { size?: number; float?: boolean; blink?: boolean; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={`${float ? "ghost-float " : ""}ghost-mascot ${className}`} width={size} height={size} viewBox="0 0 100 100" style={style} aria-hidden>
      <path className="gh-body" d="M18 52 a32 32 0 0 1 64 0 L82 86 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 c-5 7 -11 7 -16 0 c-5 -7 -11 -7 -16 0 Z" />
      <ellipse className="gh-eye" cx="40" cy="50" rx="5.5" ry={blink ? 1.4 : 7} />
      <ellipse className="gh-eye" cx="60" cy="50" rx="5.5" ry={blink ? 1.4 : 7} />
      <circle className="gh-cheek" cx="31" cy="62" r="4.2" opacity="0.85" />
      <circle className="gh-cheek" cx="69" cy="62" r="4.2" opacity="0.85" />
    </svg>
  );
}

const P: Record<string, string> = {
  copy: "M9 9V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v8a1.5 1.5 0 0 1-1.5 1.5H15 M4 10.5A1.5 1.5 0 0 1 5.5 9h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 13.5 20h-8A1.5 1.5 0 0 1 4 18.5z",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  bolt: "M13 3L5 13h6l-1 8 8-10h-6z",
  history: "M12 8v4l3 2M4 12a8 8 0 1 0 2.3-5.6M4 4v3h3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevron: "M9 6l6 6-6 6",
  gauge: "M12 13l4-4M5.5 18a8 8 0 1 1 13 0z",
  wallet: "M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 12h2M3 8V7a2 2 0 0 1 2-2h10",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  pulse: "M3 12h4l2-7 4 14 2-7h4",
  gear: "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z M19.1 13.3a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-2.5 1.1v.2a2 2 0 1 1-4 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1A2 2 0 1 1 4.5 16l.1-.1a1.5 1.5 0 0 0-1.1-2.5H3.3a2 2 0 1 1 0-4h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1A2 2 0 1 1 7.2 3.7l.1.1a1.5 1.5 0 0 0 1.7.3H9a1.5 1.5 0 0 0 1-1.4V2.6a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 1 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4 1h.2a2 2 0 1 1 0 4h-.1a1.5 1.5 0 0 0-1.4 1z",
};

export function Icon({ name, size = 18, sw = 2.4, className = "", style }: { name: string; size?: number; sw?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      <path d={P[name] || ""} />
    </svg>
  );
}
