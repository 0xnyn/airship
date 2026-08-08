import type { ReactNode } from "react";

/**
 * The Safari window the app is served into.
 *
 * The URL reads `localhost:3000` — the dev server's port, not airship's. In
 * inline mode the overlay is injected into the app's own page, so the address
 * never changes; that is the claim the whole hero is making, and getting the
 * port wrong here would quietly contradict it.
 */
export function BrowserWindow({ children }: { children: ReactNode }) {
  return (
    <div className="browser-window">
      <div className="browser-chrome">
        <div className="browser-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>

        <div className="safari-pill">
          <NavArrow className="safari-btn safari-back" />
          <NavArrow className="safari-btn safari-fwd" forward />
        </div>

        <div className="safari-url-wrap">
          <div className="safari-pill browser-url">
            localhost:3000
            <ReloadIcon />
          </div>
        </div>

        <div className="safari-pill">
          <ShareIcon />
        </div>
      </div>

      <div className="browser-content">{children}</div>
    </div>
  );
}

function NavArrow({
  className,
  forward,
}: {
  className: string;
  forward?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="9"
      viewBox="0 0 10 10"
      width="9"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={forward ? "M3.8 2L6.8 5L3.8 8" : "M6.2 2L3.2 5L6.2 8"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function ReloadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="safari-reload"
      fill="none"
      height="8"
      viewBox="0 0 10 10"
      width="8"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 5a3 3 0 1 1-.9-2.1M8 1.4v1.9H6.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      className="safari-btn"
      fill="none"
      height="9"
      viewBox="0 0 10 10"
      width="9"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 1v5.4M3.2 2.6L5 .9l1.8 1.7M2 5.6v3h6v-3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.1"
      />
    </svg>
  );
}
