import { useCallback, useEffect, useRef, useState } from "react";
import { InlineOverlay } from "#/components/hero/airship-mock/inline-overlay";
import { BrowserWindow } from "#/components/hero/browser-window";
import { DesktopBackdrop } from "#/components/hero/desktop-backdrop";
import { MockCursor } from "#/components/hero/mock-cursor";
import { cn } from "#/lib/cn";
import { measureHero } from "#/lib/measure-hero";
import { seekTo, useFrameScrub } from "#/lib/use-frame-scrub";
import { useIsomorphicLayoutEffect } from "#/lib/use-isomorphic-layout-effect";

/**
 * The hero's animated still-life of the editor.
 *
 * `.mock-cursor` is a SIBLING of `.desktop-bg` rather than a child, and that is
 * load-bearing: its `left`/`top` are percentages, and they must resolve against
 * `.hero-visual` rather than against the desktop's padding box — which would
 * offset every measured target by 80px.
 *
 * The whole thing is `aria-hidden`: it is an illustration of the product, and
 * narrating a fake cursor moving across a fake inspector is noise. Everything it
 * demonstrates is stated in prose in the sections below it.
 */
export function HeroStage() {
  const [paused, setPaused] = useState(false);
  const togglePaused = useCallback(() => setPaused((p) => !p), []);
  const scrubFrame = useFrameScrub();
  const stageRef = useRef<HTMLDivElement>(null);

  /*
   * The whole measuring layer: one effect, run before paint and again on every
   * resize, rAF-debounced so a drag emits one measurement per frame rather than
   * one per resize event.
   *
   * StrictMode's double-mount is fine — everything it writes is a custom
   * property derived from the current layout, so the second run recomputes the
   * same values.
   */
  useIsomorphicLayoutEffect(() => {
    const hero = stageRef.current;
    if (!hero) {
      return;
    }

    let frame = 0;
    const apply = () => measureHero(hero);
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /*
   * Development only: `?frame=N` pins the loop. Runs in its own effect, after
   * the measuring one, so the cursor's targets are measured before its track is
   * seeked — otherwise a pinned frame would show the pointer at its fallback
   * position rather than at the element it is supposed to be on.
   */
  useEffect(() => {
    const hero = stageRef.current;
    if (!hero || scrubFrame === null) {
      return;
    }
    return seekTo(hero, scrubFrame);
  }, [scrubFrame]);

  return (
    <div className={cn("hero-visual", paused && "is-paused")} ref={stageRef}>
      <div aria-hidden="true">
        <DesktopBackdrop>
          <BrowserWindow>
            <InlineOverlay />
          </BrowserWindow>
        </DesktopBackdrop>

        <MockCursor />
      </div>

      {/*
        Not aria-hidden: an infinite animation must be stoppable, and a control
        the keyboard cannot reach does not count as stoppable.
      */}
      <button
        aria-label={
          paused ? "Play the demo animation" : "Pause the demo animation"
        }
        className="animation-pause-btn"
        onClick={togglePaused}
        type="button"
      >
        {paused ? <PlayIcon /> : <PauseIcon />}
      </button>
    </div>
  );
}

function PauseIcon() {
  return (
    <svg
      aria-hidden="true"
      height="13"
      viewBox="0 0 14 14"
      width="13"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="currentColor" height="10" rx="1" width="3.4" x="3" y="2" />
      <rect fill="currentColor" height="10" rx="1" width="3.4" x="7.6" y="2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      height="13"
      viewBox="0 0 14 14"
      width="13"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4 2.4l7.2 4.6L4 11.6z" fill="currentColor" />
    </svg>
  );
}
