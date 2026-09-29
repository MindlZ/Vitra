/**
 * The Ko-fi cup. At rest it's lucide's Coffee; when its button (a `group`)
 * is hovered or focused, the cup fills and the steam rises. The motion and
 * colours live in index.css (.vitra-coffee), keyed off the parent group.
 */
export default function CoffeeIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`vitra-coffee ${className}`}
    >
      {/* A touch finer than the cup, so the wisps read as steam, not blobs. */}
      <g className="vitra-coffee__steam" strokeWidth="1.6">
        <path d="M6 6c-.9-.8.9-1.7 0-2.5s.9-1.7 0-2.5" />
        <path d="M10 6c-.9-.8.9-1.7 0-2.5s.9-1.7 0-2.5" />
        <path d="M14 6c-.9-.8.9-1.7 0-2.5s.9-1.7 0-2.5" />
      </g>
      <path className="vitra-coffee__fill" stroke="none" d="M5 11h10v6a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 5 17z" />
      <path
        className="vitra-coffee__cup"
        d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"
      />
    </svg>
  )
}
