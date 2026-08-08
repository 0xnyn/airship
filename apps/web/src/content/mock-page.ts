import mock from "#/content/mock-page.json";
import { oneOf } from "#/content/resolve";

/*
 * Everything the hero's editor mock says.
 *
 * The app inside the browser window is this site, in miniature — which is not a
 * joke about recursion but the literally true thing: `make run` points the CLI at
 * apps/web, so the app being edited in the hero is the app you are reading. That
 * saves inventing a product to demo against, and it means the payoff beat edits a
 * button that actually exists a few hundred pixels above it.
 *
 * Deliberately short strings. At the mock's render scale a full sentence
 * collapses into a grey smear, so each line is written to still read as words.
 */

export const MOCK_PAGE = mock.page;

/**
 * What the picker reports, and what the inspector's SOURCE chip shows. Kept
 * beside the page it describes so renaming the CTA cannot leave the badge
 * quoting a class that no longer exists.
 */
export const MOCK_SELECTION = mock.selection;

/**
 * The prompt.
 *
 * Short on purpose, and short for a reason beyond the render scale: the two
 * halves of this demo are split by MECHANISM. Colour is the thing that is
 * awkward to say as a number — "warmer" is a judgement, and judgement is what
 * you hand to an agent. The corner radius is a number, and a number is what you
 * scrub in the inspector.
 *
 * That division is not a staging trick; it is how the tool is actually used.
 */
export const MOCK_PROMPT: string = mock.prompt;

/**
 * The agent's turn, in the order the overlay streams it.
 *
 * Three calls, because that is what one honest colour change takes: read the
 * file, find the other places the class is used, then edit. A demo that shows a
 * lone Edit is quietly claiming the agent never has to look around first.
 */
export const MOCK_TOOL_CALLS = mock.toolCalls;

/** Every kind of line the diff card can draw. One class each in hero-overlay.css. */
export const DIFF_LINE_KINDS = ["add", "ctx", "del"] as const;

export type DiffLineKind = (typeof DIFF_LINE_KINDS)[number];

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/** The diff card that lands before the colour appears on the page. */
export const MOCK_DIFF: {
  file: string;
  lines: readonly DiffLine[];
  stat: string;
} = {
  file: mock.diff.file,
  lines: mock.diff.lines.map((line, index) => ({
    kind: oneOf(DIFF_LINE_KINDS, line.kind, `diff line kind at index ${index}`),
    text: line.text,
  })),
  stat: mock.diff.stat,
};

/** The two status lines the turn moves through. */
export const MOCK_STATUS = mock.status;

/*
 * There used to be a MOCK_TERMINAL_LINES here: the install command's startup
 * banner, for a CLI window that opened the loop and minimised into the
 * dock. The beat is gone — it spent nearly three seconds establishing that the
 * tool is launched from a shell, which the install command sitting directly
 * above the animation already says, in real copy the visitor can select.
 */
