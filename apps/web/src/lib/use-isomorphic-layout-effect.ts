import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` on the server.
 *
 * React warns that `useLayoutEffect` does nothing during SSR, and it is right —
 * but the warning is noise for an effect that measures the DOM, because there is
 * no DOM to measure until the browser has one. Swapping the import on the server
 * silences the warning without changing what runs where.
 */
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
