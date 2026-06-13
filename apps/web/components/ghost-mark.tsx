// components/ghost-mark.tsx — the brand mark. A geometric, hard-edged ghost:
// chamfered shoulders (echoing Chakra Petch's cut corners), vertical sides, a
// triangular zigzag hem, square eyes punched through (evenodd). Replaces the
// 👻 emoji everywhere — an icon, not a glyph.

export function GhostMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
      fill="currentColor"
      fillRule="evenodd"
    >
      <path d="M4 8 L8 4 L16 4 L20 8 L20 20 L18 23 L16 20 L14 23 L12 20 L10 23 L8 20 L6 23 L4 20 Z M9 11 L11 11 L11 14 L9 14 Z M13 11 L15 11 L15 14 L13 14 Z" />
    </svg>
  );
}
