import { useCallback } from "react";
import { cn } from "#/lib/cn";
import { useCopy } from "#/lib/use-copy";

/**
 * Copy-to-clipboard, with the copied state announced rather than only drawn.
 *
 * Both icons are rendered at once and cross-faded — swapping them would change
 * the button's content box mid-transition and make it twitch. The `aria-live`
 * region is what a screen reader gets, since a tick appearing is not an event
 * anything else would announce.
 */
export function CopyButton({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy();
  const onClick = useCallback(() => copy(value), [copy, value]);

  return (
    <button
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className="copy-btn"
      onClick={onClick}
      type="button"
    >
      <span
        className={cn("copy-icon", copied ? "copy-icon-out" : "copy-icon-in")}
      >
        <CopyIcon />
      </span>
      <span
        className={cn("copy-icon", copied ? "copy-icon-in" : "copy-icon-out")}
      >
        <CheckIcon />
      </span>
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

function CopyIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
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

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      viewBox="0 0 16 16"
      width="14"
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
