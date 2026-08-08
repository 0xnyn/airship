/**
 * The pointer that drives the whole loop.
 *
 * A sibling of `.desktop-bg`, not a child: its `left`/`top` are percentages, and
 * they have to resolve against `.hero-visual` — whose box matches the desktop
 * exactly — rather than against the desktop's padding box, which would offset
 * every measured target by the 80px side padding.
 */
export function MockCursor() {
  return (
    <svg
      aria-hidden="true"
      className="mock-cursor"
      fill="none"
      height="14"
      viewBox="0 0 14 14"
      width="14"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 1.4l9.2 5.4-3.8 1-1.9 3.6z"
        fill="currentColor"
        stroke="rgba(0,0,0,0.45)"
        strokeLinejoin="round"
        strokeWidth="0.9"
      />
    </svg>
  );
}
