import agentOutput from "#/content/agent-output.json";
import { oneOf } from "#/content/resolve";

/*
 * What airship actually hands the agent when you hit send.
 *
 * This is a transcription of the real payload shape, not a mock-up of one:
 * `packages/core/src/prompt.ts` renders the selection identity, the resolved
 * source location, the pending inspector deltas and the frame context, and the
 * `get_element_context` tool lets the agent re-read the selection mid-turn.
 * Showing the real thing is more convincing than any amount of prose about
 * "rich context", and it is the section a sceptical reader checks first.
 *
 * It also spells out what the hero animates: a value nudged by hand travels to
 * the agent as INTENT — `border-radius 6px → 9999px` — alongside a sentence, and
 * the agent decides how to write both into your project's idiom.
 *
 * Modelled as tokens rather than a template string so the syntax colouring is
 * data, not a regex pass over prose at render time. In agent-output.json a line
 * is an array of `{ kind, text }`, and an empty array is a blank line.
 */

/** Every colour the block can paint. Each maps to one class in shell.css. */
export const OUTPUT_TOKEN_KINDS = [
  "dim",
  "heading",
  "hint",
  "new",
  "old",
  "plain",
  "prop",
] as const;

export type OutputTokenKind = (typeof OUTPUT_TOKEN_KINDS)[number];

export interface OutputToken {
  id: string;
  kind: OutputTokenKind;
  text: string;
}

/** One rendered line. An empty token list is a blank line. */
export interface OutputLine {
  id: string;
  tokens: readonly OutputToken[];
}

/*
 * Keys, assigned once at module load rather than from the render loop's index.
 *
 * Position genuinely IS identity here — this is a frozen constant that is never
 * reordered, filtered or appended to — but baking that in at the data layer says
 * so explicitly, and means the renderer never has to reason about it. It also
 * matters that blank lines repeat, so the text alone would not be unique.
 *
 * `kind` is validated rather than trusted: JSON widens it to `string`, and an
 * unrecognised value would render a span with a class nobody styled — invisible
 * in review, and wrong on the one block that is meant to prove the page is not
 * making things up.
 */
export const AGENT_OUTPUT: readonly OutputLine[] = agentOutput.lines.map(
  (tokens, lineIndex) => ({
    id: `line-${lineIndex}`,
    tokens: tokens.map((token, tokenIndex) => ({
      id: `line-${lineIndex}-token-${tokenIndex}`,
      kind: oneOf(
        OUTPUT_TOKEN_KINDS,
        token.kind,
        `token kind on line ${lineIndex}`
      ),
      text: token.text,
    })),
  })
);

export const AGENT_OUTPUT_SECTION = {
  /** The label in the block's chrome bar. */
  chromeLabel: agentOutput.chromeLabel,
  desc: agentOutput.desc,
  heading: agentOutput.heading,
};
