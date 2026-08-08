import { useCallback } from "react";
import { cn } from "#/lib/cn";
import { useCopy } from "#/lib/use-copy";

/**
 * The hero's secondary action: bare mono text you can click to copy.
 *
 * Deliberately not a button-shaped thing. The page has exactly one primary
 * action, and giving this one a border or a fill would make the hero look like
 * it is asking twice.
 */
export function InstallCopy({ command }: { command: string }) {
  const { copied, copy } = useCopy();
  const onClick = useCallback(() => copy(command), [copy, command]);

  return (
    <button
      aria-label={copied ? "Command copied" : `Copy ${command}`}
      className="hero-install"
      onClick={onClick}
      type="button"
    >
      <code className="hero-install-cmd">{command}</code>
      <span className="hero-install-icon">
        <span
          className={cn("copy-icon", copied ? "copy-icon-out" : "copy-icon-in")}
        >
          <CopyGlyph />
        </span>
        <span
          className={cn("copy-icon", copied ? "copy-icon-in" : "copy-icon-out")}
        >
          <CheckGlyph />
        </span>
      </span>
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

function CopyGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="13"
      viewBox="0 0 16 16"
      width="13"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        height="9"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.2"
        width="9"
        x="5.6"
        y="5.6"
      />
      <path
        d="M10.4 3.4a1.8 1.8 0 0 0-1.8-1.8H3.4a1.8 1.8 0 0 0-1.8 1.8v5.2a1.8 1.8 0 0 0 1.8 1.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="13"
      viewBox="0 0 16 16"
      width="13"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3.2 8.4l3.1 3.1 6.5-6.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
