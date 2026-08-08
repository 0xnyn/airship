import { useEffect, useState } from "react";
import { FRAME_MS } from "#/content/timeline";

/**
 * `?frame=62` — freeze the hero's loop at one percent of its run.
 *
 * A ~30-track choreography cannot be reviewed by watching it: by the time you
 * notice a value swapped a beat too early, it is gone.
 *
 * Read from `window.location` rather than the route's search schema on purpose:
 * this is a development affordance, and routing it through validated search
 * params would put a debug flag in the app's public contract.
 *
 * @returns the frame to pin at, or `null` to run normally.
 */
export function useFrameScrub(): number | null {
  const [frame, setFrame] = useState<number | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("frame");
    if (raw === null) {
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      // Wrap rather than clamp, so `?frame=105` shows frame 5 — which is what
      // you want when stepping across the seam to check it.
      setFrame(((parsed % 100) + 100) % 100);
    }
  }, []);

  return frame;
}

/**
 * Seek every animation under `root` to a given frame and pause it.
 *
 * Driven through the Web Animations API rather than by overriding
 * `animation-delay` in CSS. The CSS route looks simpler and is wrong: the scrub
 * class can only be applied after the first paint, by which point every track
 * has already started, and changing `animation-delay` on a running animation
 * shifts its timeline relative to a start time that is now in the past. The
 * result is a frame that is confidently displayed and quietly incorrect — the
 * worst possible property for a debugging tool.
 *
 * `currentTime` is absolute and unambiguous, so what you asked for is what you
 * get.
 *
 * @returns a function that resumes everything, for the effect's cleanup.
 */
export function seekTo(root: HTMLElement, frame: number): () => void {
  const time = frame * FRAME_MS;
  const animations = root.getAnimations({ subtree: true });

  for (const animation of animations) {
    // Pause BEFORE seeking. Assigning `currentTime` to a still-running animation
    // sets it, but the animation then advances by however long it takes to reach
    // the `pause()` on the next line — about a frame — and lands ~0.17% late.
    // That is invisible during a hold and completely wrong on a fast beat.
    animation.pause();
    animation.currentTime = time;
  }

  return () => {
    for (const animation of animations) {
      animation.play();
    }
  };
}
