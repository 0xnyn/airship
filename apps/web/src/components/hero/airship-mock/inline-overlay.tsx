import { BottomBar } from "#/components/hero/airship-mock/bottom-bar";
import { DesignDock } from "#/components/hero/airship-mock/design-dock";
import { MockPage } from "#/components/hero/airship-mock/mock-page";
import { PickerOverlay } from "#/components/hero/airship-mock/picker-overlay";

/**
 * Airship in inline mode: the overlay injected straight into the running app.
 *
 * `.ap-mock` is authored at a fixed 1200×636 and shrunk with a single
 * `transform: scale()`, so every number in hero-overlay.css is the real editor's
 * number rather than a pre-divided one. It is also the scope the `--ap-*` editor
 * palette is generated into, and — because it carries a transform — the
 * containing block the docks position against.
 *
 * Order matters: the page paints first, the picker's chrome layer sits above it,
 * and the docks sit above that. In the real overlay the same stack is enforced
 * with z-index for the same reason — a selection outline drawn under a panel is
 * a selection you cannot see.
 *
 * One dock, with the agent in front. The real editor runs two — chat left,
 * inspector right — and folding them together is a deliberate simplification for
 * the hero; see the note in design-dock.tsx. What is NOT negotiable is that the
 * agent is the tab you land on: an earlier draft showed only the inspector and,
 * without meaning to, argued that airship is a visual CSS editor that happens to
 * write files.
 */
export function InlineOverlay() {
  return (
    <div className="ap-mock">
      <MockPage />
      <PickerOverlay />
      <DesignDock />
      <BottomBar />
    </div>
  );
}
