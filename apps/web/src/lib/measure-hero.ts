import { centerOf, type Rect, toPercent } from "#/lib/hero-measure";
import { MOCK_WIDTH } from "#/lib/hero-scale";

function rectOf(root: ParentNode, selector: string): Rect | null {
  const el = root.querySelector(selector);
  if (!el) {
    return null;
  }
  const r = el.getBoundingClientRect();
  return { height: r.height, left: r.left, top: r.top, width: r.width };
}

/**
 * Measure the hero and write everything the CSS animation needs back onto it.
 *
 * Called on mount and again on every (debounced) resize.
 *
 * @param hero The `.hero-visual` element to write custom properties onto.
 */
export function measureHero(hero: HTMLElement): void {
  /*
   * Writing a custom property that a live `@keyframes` reads makes Chrome tear
   * the animation down and start it again from zero. The cursor's whole path is
   * expressed in these, so an unguarded `setProperty` on every resize event
   * restarted the pointer's track while the other seventy carried on,
   * permanently out of step.
   *
   * Hence: round to a stable precision, and skip the write when nothing moved.
   * A resize that does not change the hero's geometry then costs nothing at all
   * — which is the common case on a wide viewport, where the band is full-bleed
   * but the window inside it is pinned to its max-width and does not move.
   */
  let changed = false;
  const setVar = (name: string, value: string) => {
    if (hero.style.getPropertyValue(name) === value) {
      return;
    }
    hero.style.setProperty(name, value);
    changed = true;
  };

  // The shared clock, read before anything is written, so it can be restored if
  // a genuine change does force a restart.
  const clock = readClock(hero);

  // 1. Mock scale — how far 1200 author pixels must shrink to fit the window.
  const content = rectOf(hero, ".browser-content");
  if (!(content && content.width > 0)) {
    return;
  }
  const scale = content.width / MOCK_WIDTH;
  setVar("--ap-mock-scale", String(scale));

  const stage = hero.getBoundingClientRect();
  const container: Rect = {
    height: stage.height,
    left: stage.left,
    top: stage.top,
    width: stage.width,
  };

  // 2. Cursor targets: the centre of a real element each time, as a percentage
  //    of the stage so it survives a resize between one measurement and the
  //    next.
  //
  //    These are the four places the pointer actually goes in the story — the
  //    button it picks, the composer it types into, the send button, and the
  //    two controls in the panel. Everything else on the desktop is scenery and
  //    is never clicked.
  const targets: [string, string][] = [
    ["sel", "#ap-cta"],
    ["prompt", ".ap-input"],
    ["send", ".ap-send"],
    ["tab", ".ap-tab-edit"],
    ["radius", ".ap-field-radius"],
  ];

  for (const [name, selector] of targets) {
    const rect = rectOf(hero, selector);
    if (!rect) {
      continue;
    }
    const { x, y } = toPercent(centerOf(rect), container);
    setVar(`--${name}-x`, x);
    setVar(`--${name}-y`, y);
  }

  // 3. The picker's box, in `.ap-mock` AUTHOR space — it is drawn inside the
  //    scaled container, so it has to be sized in the same units its siblings
  //    use, not in the screen pixels the rect came back in.
  const mock = rectOf(hero, ".ap-mock");
  const cta = rectOf(hero, "#ap-cta");
  if (mock && cta) {
    setVar("--pick-x", px((cta.left - mock.left) / scale));
    setVar("--pick-y", px((cta.top - mock.top) / scale));
    setVar("--pick-w", px(cta.width / scale));
    setVar("--pick-h", px(cta.height / scale));
  }

  if (changed) {
    restoreClock(hero, clock);
  }
}

/** `12.3456` → `"12.35px"`. Two decimals is below one device pixel at any DPR. */
function px(value: number): string {
  return `${value.toFixed(2)}px`;
}

interface Clock {
  paused: boolean;
  time: CSSNumberish | null;
}

/** Where the shared `--ap-loop` clock currently is, and whether it is running. */
function readClock(hero: HTMLElement): Clock | null {
  const reference = hero.querySelector(".mock-cursor")?.getAnimations()[0];
  if (!reference) {
    return null;
  }
  return {
    paused: reference.playState === "paused",
    time: reference.currentTime,
  };
}

/**
 * Put every track back on the shared clock after a genuine geometry change.
 *
 * Deferred a frame because Chrome recreates the affected animations during the
 * next style recalculation — restoring synchronously would set the time on the
 * objects that are about to be discarded.
 */
function restoreClock(hero: HTMLElement, clock: Clock | null): void {
  if (!clock) {
    return;
  }
  requestAnimationFrame(() => {
    for (const animation of hero.getAnimations({ subtree: true })) {
      if (clock.paused) {
        animation.pause();
      }
      animation.currentTime = clock.time;
    }
  });
}
