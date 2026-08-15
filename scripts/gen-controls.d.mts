/**
 * Types for the two renderers `gen-controls.mjs` exports.
 *
 * Hand-written and deliberately structural. The script is plain JavaScript
 * because every generator in this repo is — it runs from a Makefile target and
 * a CI step, neither of which builds anything first — but
 * `packages/overlay/src/keys/controls-doc.test.ts` imports the same two
 * functions so that the drift gate and the writer cannot diverge, and that test
 * is TypeScript.
 *
 * The parameter shapes are the fields the renderers actually read, not the full
 * `CommandSpec` and `GestureSpec` — importing those from `packages/overlay`
 * would point a repo-root script at a workspace package's internals for no gain,
 * and the real definitions are checked where they live.
 */

interface RenderedCommand {
  readonly display?: string;
  readonly doc: string;
  readonly essential?: boolean;
  readonly group: string;
  readonly keys: readonly string[];
  readonly mode: string;
  readonly primary?: readonly string[];
  readonly surface: string;
  readonly title: string;
  readonly where?: string;
}

interface RenderedGesture {
  readonly doc: string;
  readonly essential?: boolean;
  readonly input: string;
  /** The Windows/Linux spelling, when it differs from `input`. */
  readonly inputPc?: string;
  readonly mode: string;
  readonly surface: string;
  readonly title: string;
}

interface RenderInput {
  readonly commands: readonly RenderedCommand[];
  readonly displayChord: (chord: string, platform: "mac" | "pc") => string;
  readonly gestures: readonly RenderedGesture[];
  readonly groups: readonly string[];
  readonly notes: readonly string[];
}

/** The whole of `CONTROLS.md`. */
export function renderControls(input: RenderInput): string;

/** The short table between the markers in `README.md`. */
export function renderEssentials(
  input: Omit<RenderInput, "groups" | "notes">
): string;
