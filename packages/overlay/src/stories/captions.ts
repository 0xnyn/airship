/*
 * Whether stories draw their caption strip.
 *
 * A module singleton with a toolbar toggle in front of it, which is the same
 * shape — and for the same reason — as the token registry `preview.ts` resets
 * between stories: `stage()` is called from inside `render()`, which Storybook
 * hands no context, and threading a context argument through every one of the
 * catalogue's ~150 call sites to carry one boolean would be a worse trade than
 * one piece of module state set by the decorator a moment earlier.
 *
 * It is on by default, and stays on under `make test-browser`. The caption is
 * catalogue chrome that renders on every story, so it should be smoke-tested
 * like everything else; the toggle exists so a reviewer can look at nothing but
 * product UI, and so a future screenshot tier can turn it off with one global
 * rather than a rebuild.
 */

let enabled = true;

export function setCaptionsEnabled(next: boolean): void {
  enabled = next;
}

export function captionsEnabled(): boolean {
  return enabled;
}
