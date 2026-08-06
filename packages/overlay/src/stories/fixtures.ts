import type {
  FileDiff,
  JobDiffBundle,
  JobHistorySummary,
  TimelineItem,
  TodoItem,
} from "@airship/protocol";
import type { DesignToken } from "@airship/protocol/tokens";
import { setRuntimeTokens } from "../tokens/registry";

/*
 * Data the stories stand things up with.
 *
 * Kept in one module rather than inline per story for a reason that is about
 * honesty rather than tidiness: a design token, a timeline item and a unified
 * patch are all shapes the *server* produces, and a story that invents a
 * plausible-looking one teaches the reader something that may not be true. These
 * are modelled on the real thing — `@airship/protocol`'s types are the contract,
 * and TypeScript enforces the shape here the same way it does in production.
 *
 * `preview.ts` resets the token registry before every story, so anything wanting
 * tokens has to ask for them. That is deliberate: token affordances change what
 * every field in the panel looks like, and a story that inherited them from
 * whichever story ran before it would be a different picture depending on the
 * order you clicked.
 */

/**
 * A callback that records nothing.
 *
 * Every control takes an `onChange`, and a story that only wants to look at one
 * has nothing to do with the value. Eight files had declared their own copy of
 * this line; one export is not tidier so much as it is one fewer thing that can
 * quietly become `() => {}` in one file and `() => undefined` in the next while
 * Biome argues about which it prefers.
 */
export const noop = (): undefined => undefined;

/**
 * The blue a demo design system is built around.
 *
 * Exported because it is the *same fact* as `--pk-brand-primary` below, and
 * before this it was stored twice: nine literal `#0D99FF`s across the colour and
 * gradient stories, plus the token's own value. A story that pins a swatch to
 * one and the badge to the other is a story about a design system that does not
 * match itself — which is a real thing to demonstrate, but not by accident.
 */
export const BRAND = "#0D99FF";

/**
 * A small, plausible token set — the shape a Tailwind v4 `@theme` block or a
 * hand-rolled custom-property scale actually scans to.
 *
 * Deliberately not exhaustive. The point is that *some* properties have tokens
 * and others do not, because a badge appearing on every field would hide the one
 * decision the affordance is asking you to make.
 */
export const TOKENS: DesignToken[] = [
  {
    category: "spacing",
    kind: "css-var",
    name: "--pk-space-xs",
    origin: "runtime",
    values: { "": "8px" },
  },
  {
    category: "spacing",
    kind: "css-var",
    name: "--pk-space-md",
    origin: "runtime",
    values: { "": "16px" },
  },
  {
    category: "spacing",
    kind: "css-var",
    name: "--pk-space-lg",
    origin: "runtime",
    values: { "": "24px" },
  },
  {
    category: "colors",
    kind: "css-var",
    name: "--pk-brand-primary",
    origin: "runtime",
    // `BRAND`, so a story can paint a swatch this colour and have the badge
    // light up because the two agree, not because both were typed correctly.
    values: { "": BRAND },
  },
  {
    category: "colors",
    kind: "css-var",
    name: "--pk-surface-raised",
    origin: "runtime",
    values: { "": "#FFFFFF" },
  },
  {
    // An alias, which is the case `aliasOf` exists for: a design system that
    // defines a primitive scale and re-exports it under app-facing names. Both
    // names are real, and without this the picker would offer two identical
    // entries and the prompt could not say which one the codebase writes.
    aliasOf: "--pk-space-md",
    category: "spacing",
    kind: "css-var",
    name: "--pk-gutter",
    origin: "runtime",
    values: { "": "16px" },
  },
  {
    category: "border-radius",
    kind: "css-var",
    name: "--pk-radius-md",
    origin: "runtime",
    values: { "": "8px" },
  },
  {
    // The long name, for the elision the badge and the bound field both have to
    // do. Real design systems produce these; `shortName` is what copes.
    category: "colors",
    kind: "css-var",
    name: "--pk-semantic-success-background-subtle",
    origin: "runtime",
    values: { "": "rgba(46, 204, 113, 0.12)" },
  },
];

/**
 * Seed the registry for one story.
 *
 * Call it at the top of `render`. `preview.ts` clears the registry first, so
 * this is additive to nothing and cannot leak forward.
 */
export function withTokens(tokens: DesignToken[] = TOKENS): void {
  setRuntimeTokens({ framework: "custom", tokens });
}

/**
 * A unified diff, as `@airship/core` captures one after an edit.
 *
 * Two hunks and a rename-free single file, which is the common case the diff
 * renderer was built for. It carries a context line with a tab, a deletion, an
 * addition and a no-newline marker — between them those cover every branch in
 * `parseUnifiedPatch`.
 */
export const PATCH = `--- a/src/components/hero.tsx
+++ b/src/components/hero.tsx
@@ -12,7 +12,7 @@ export function Hero() {
   return (
     <section className="hero">
       <h1 className="hero-title">Ship it visually</h1>
-      <button className="rounded px-4 py-2 bg-slate-900 text-white">
+      <button className="rounded-lg px-6 py-3 bg-blue-600 text-white">
         Get started
       </button>
     </section>
@@ -38,4 +38,8 @@ export function Hero() {
 .hero-title {
   font-size: 2.5rem;
 }
+
+.hero button:hover {
+  filter: brightness(1.1);
+}
`;

/** A one-line patch, for the empty-ish end of the diff renderer. */
export const SMALL_PATCH = `--- a/src/app.css
+++ b/src/app.css
@@ -1,3 +1,3 @@
 .card {
-  padding: 12px;
+  padding: 16px;
 }
`;

/** The two-hunk patch as a `FileDiff`, which is what `renderDiff` takes. */
export const DIFF: FileDiff = {
  additions: 5,
  deletions: 1,
  file: "src/components/hero.tsx",
  isDeleted: false,
  isNew: false,
  patch: PATCH,
};

/** A one-line change, for the short end of the renderer. */
export const SMALL_DIFF: FileDiff = {
  additions: 1,
  deletions: 1,
  file: "src/app.css",
  isDeleted: false,
  isNew: false,
  patch: SMALL_PATCH,
};

/** A brand-new file — `isNew` changes the header, not the body. */
export const NEW_DIFF: FileDiff = {
  additions: 3,
  deletions: 0,
  file: "src/components/badge.tsx",
  isDeleted: false,
  isNew: true,
  patch: `--- /dev/null
+++ b/src/components/badge.tsx
@@ -0,0 +1,3 @@
+export function Badge({ count }: { count: number }) {
+  return <span className="badge">{count}</span>;
+}
`,
};

export const TODOS: TodoItem[] = [
  { content: "Find where the hero button is defined", status: "completed" },
  { content: "Update the padding and radius", status: "completed" },
  { content: "Check the mobile frame still fits", status: "in_progress" },
  { content: "Run the type check", status: "pending" },
];

/**
 * One agent turn, as the socket delivers it.
 *
 * Every branch the row renderers have: a tool that succeeded, one that is still
 * pending, one that failed, a thinking block, assistant prose with markdown, and
 * a todo list. `startedAt` is ms since job start — relative, so a persisted
 * bundle stays diffable and clock-agnostic, which is also why these are stable
 * numbers rather than anything derived from the clock.
 */
export const TIMELINE: TimelineItem[] = [
  {
    estimatedTokens: 340,
    id: "t0",
    kind: "thinking",
    startedAt: 120,
    text: "The hero button is probably a Tailwind-styled element. I should find the component first rather than guessing at the class names.",
  },
  {
    args: { path: "src", pattern: "hero" },
    endedAt: 940,
    id: "t1",
    kind: "tool",
    name: "Grep",
    phase: "ok",
    result: { text: "3 files · 11 matches" },
    startedAt: 400,
    title: "Grep(hero)",
  },
  {
    args: { file_path: "src/components/hero.tsx" },
    endedAt: 1310,
    id: "t2",
    kind: "tool",
    name: "Read",
    phase: "ok",
    result: {
      detail:
        '  10 | export function Hero() {\n  11 |   return (\n  12 |     <section className="hero">\n  13 |       <h1 className="hero-title">Ship it visually</h1>\n  14 |       <button className="rounded px-4 py-2 bg-slate-900 text-white">',
      droppedLines: 196,
      text: "Read 214 lines",
      truncated: true,
    },
    startedAt: 950,
    title: "Read(src/components/hero.tsx)",
  },
  {
    args: { file_path: "src/components/hero.tsx" },
    endedAt: 1980,
    id: "t3",
    kind: "tool",
    name: "Edit",
    phase: "ok",
    result: { text: "+5 −1" },
    startedAt: 1320,
    title: "Edit(src/components/hero.tsx)",
  },
  { id: "t4", kind: "todos", startedAt: 2000, todos: TODOS },
  {
    args: { command: "pnpm typecheck" },
    endedAt: 5400,
    id: "t5",
    kind: "tool",
    name: "Bash",
    phase: "error",
    result: {
      detail:
        "src/components/hero.tsx:14:9 - error TS2322: Type 'string' is not assignable to type 'number'.\n\n14         <Badge count=\"3\" />\n           ~~~~~",
      text: "exit 2 · 1 error",
    },
    startedAt: 2010,
    title: "Bash(pnpm typecheck)",
  },
  {
    args: { file_path: "src/components/hero.tsx" },
    id: "t6",
    kind: "tool",
    name: "Edit",
    // Still running: no `endedAt`, no `result`. The row has to say so without
    // implying a result it does not have.
    phase: "pending",
    startedAt: 5410,
    title: "Edit(src/components/hero.tsx)",
  },
  {
    id: "t7",
    kind: "text",
    startedAt: 5500,
    streaming: true,
    text: "I've updated the hero button to use a **larger radius** and the blue-600 background. One type error came back from `pnpm typecheck` — `count` wants a number, so I'm fixing that now.",
  },
];

// ---------------------------------------------------------------------------
// Finished jobs
// ---------------------------------------------------------------------------

/**
 * What the agent hands back when an edit lands.
 *
 * `JobDiffBundle` is a `JobHistorySummary` plus the heavy fields, and the split
 * matters: the server's `toSummary()` strips `timeline` before a bundle rides in
 * a history listing, so the two shapes are genuinely different objects in
 * production rather than one object read two ways.
 */
export const BUNDLE: JobDiffBundle = {
  additions: 6,
  agent: "claude",
  completedAt: 1_733_000_012_400,
  createdAt: 1_733_000_000_000,
  deletions: 2,
  diffs: [DIFF, SMALL_DIFF],
  filesChanged: 2,
  followUps: [
    "Make the same change to the secondary button",
    "Add a focus ring that matches the new radius",
    "Check the mobile frame at 393px",
  ],
  jobId: "job-1",
  prompt: "Make the hero button rounder and use the brand blue",
  promptPreview: "Make the hero button rounder and use the brand blue",
  status: "done",
  summary:
    "Updated the hero button to a **larger radius** and the `blue-600` background.\n\n- Padding is now `px-6 py-3`\n- Added a `:hover` brightness lift\n\nThe secondary button is untouched — say the word and I'll match it.",
  target: {
    displayName: "Hero",
    source: { file: "src/components/hero.tsx", line: 14 },
    tagName: "button",
  },
  timeline: TIMELINE,
  usage: { costUsd: 0.0412, inputTokens: 18_400, outputTokens: 1260 },
};

/**
 * The same job, with tokens reported and no price.
 *
 * Codex does this, and so does Claude under subscription auth. The meta line
 * used to be gated on the dollar figure, so this shape silently dropped the file
 * and ±line counts along with the cost — a bundle that had done real work
 * reporting nothing about it.
 */
export const BUNDLE_NO_COST: JobDiffBundle = {
  ...BUNDLE,
  agent: "codex",
  jobId: "job-2",
  usage: { inputTokens: 18_400, outputTokens: 1260 },
};

/** A failed job, which puts the error class on the bubble. */
export const BUNDLE_FAILED: JobDiffBundle = {
  ...BUNDLE,
  additions: 0,
  deletions: 0,
  diffs: [],
  error:
    "The dev server returned 500 while re-rendering src/components/hero.tsx. No changes were written.",
  filesChanged: 0,
  followUps: undefined,
  jobId: "job-3",
  status: "failed",
  summary: undefined,
  usage: undefined,
};

/**
 * A failure with nothing to say about itself.
 *
 * `bundle.error || "Edit failed."` — an empty string is falsy, so this reaches
 * the fallback. Worth its own fixture because an agent that dies without a
 * message is the case a `??` would have got wrong.
 */
export const BUNDLE_FAILED_SILENT: JobDiffBundle = {
  ...BUNDLE_FAILED,
  error: "",
  jobId: "job-4",
};

/** Five files from one edit — the case every diff being folded shut exists for. */
export const BUNDLE_MANY: JobDiffBundle = {
  ...BUNDLE,
  additions: 24,
  deletions: 11,
  diffs: [
    DIFF,
    SMALL_DIFF,
    NEW_DIFF,
    { ...SMALL_DIFF, file: "src/components/nav.tsx" },
    { ...SMALL_DIFF, file: "src/styles/tokens.css" },
  ],
  filesChanged: 5,
  jobId: "job-5",
};

/**
 * A history listing, as the threads drawer receives one.
 *
 * Three independent conversations, one of which was refined twice — `job-b2`
 * and `job-b3` chain through `parentJobId`, which is what `groupThreads` folds
 * into a single three-edit thread. Without a chain in the fixture the grouping
 * is untestable and the story is a flat list pretending to be a tree.
 *
 * The timestamps are fixed offsets from `HISTORY_NOW` rather than from the
 * clock, so the four `relativeTime` bands are pinned rather than sampled.
 */
export const HISTORY_NOW = 1_733_000_600_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const HISTORY: JobHistorySummary[] = [
  {
    additions: 6,
    agent: "claude",
    completedAt: HISTORY_NOW - 30_000,
    createdAt: HISTORY_NOW - 42_000,
    deletions: 2,
    filesChanged: 2,
    jobId: "job-a",
    promptPreview: "Make the hero button rounder and use the brand blue",
    status: "done",
    target: {
      displayName: "Hero",
      source: { file: "src/components/hero.tsx", line: 14 },
      tagName: "button",
    },
  },
  {
    additions: 3,
    agent: "claude",
    completedAt: HISTORY_NOW - 5 * MINUTE,
    createdAt: HISTORY_NOW - 5 * MINUTE - 20_000,
    deletions: 1,
    filesChanged: 1,
    jobId: "job-b1",
    promptPreview: "Tighten the card grid to three columns",
    status: "done",
    target: {
      displayName: "CardGrid",
      source: { file: "src/components/card-grid.tsx", line: 8 },
      tagName: "div",
    },
  },
  {
    additions: 2,
    agent: "claude",
    completedAt: HISTORY_NOW - 4 * MINUTE,
    createdAt: HISTORY_NOW - 4 * MINUTE - 15_000,
    deletions: 2,
    filesChanged: 1,
    jobId: "job-b2",
    parentJobId: "job-b1",
    promptPreview: "Actually make the gap smaller too",
    status: "done",
    target: {
      displayName: "CardGrid",
      source: { file: "src/components/card-grid.tsx", line: 8 },
      tagName: "div",
    },
  },
  {
    additions: 1,
    agent: "claude",
    createdAt: HISTORY_NOW - 3 * HOUR,
    deletions: 0,
    filesChanged: 1,
    jobId: "job-b3",
    parentJobId: "job-b2",
    promptPreview: "And drop the shadow",
    status: "running",
    target: {
      displayName: "CardGrid",
      source: { file: "src/components/card-grid.tsx", line: 8 },
      tagName: "div",
    },
  },
  {
    additions: 0,
    agent: "codex",
    completedAt: HISTORY_NOW - 6 * DAY,
    createdAt: HISTORY_NOW - 6 * DAY - 90_000,
    deletions: 0,
    error: "Could not resolve src/components/footer.tsx",
    filesChanged: 0,
    jobId: "job-c",
    promptPreview: "Centre the footer links",
    status: "failed",
    target: { displayName: null, source: null, tagName: "footer" },
  },
];
