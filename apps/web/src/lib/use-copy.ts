import { useCallback, useEffect, useRef, useState } from "react";

const RESET_DELAY_MS = 1500;

/**
 * Copy text to the clipboard and report success for long enough to see it.
 *
 * The timer is held in a ref and cleared on unmount so a component that
 * disappears mid-flash — a code block inside a collapsing FAQ answer, say —
 * cannot set state after it is gone.
 *
 * A rejected write (no permission, insecure origin, no clipboard API at all)
 * leaves `copied` false rather than throwing. There is no useful recovery: the
 * text is on screen and selectable, which is the fallback.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  const copy = useCallback((text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) {
          clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => setCopied(false), RESET_DELAY_MS);
      })
      .catch(() => {
        // Nothing to recover: the text is visible and selectable.
      });
  }, []);

  return { copied, copy };
}
