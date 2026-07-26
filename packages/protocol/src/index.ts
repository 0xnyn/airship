/**
 * @airship/protocol — the shared contract between the daemon (`@airship/server` +
 * `@airship/core`) and the browser overlay (`@airship/overlay`).
 *
 * Everything here is isomorphic: zod schemas are used by the server for runtime
 * validation; the overlay imports the inferred *types* only (via `import type`)
 * so zod is never pulled into the browser bundle.
 */
import { z } from "zod";
import type { TokenScanResult } from "./tokens";

/**
 * Token *types* re-exported for convenience. The category table, the value
 * normalizer and everything else executable lives in `@airship/protocol/tokens`
 * and must be imported from there directly — importing a value through this
 * module would drag zod into the browser bundle, which is the one thing the
 * split entry point exists to prevent.
 */
export type {
  CssFramework,
  DesignToken,
  TokenCategory,
  TokenKind,
  TokenOrigin,
  TokenRegistry,
  TokenScanResult,
} from "./tokens";

// ---------------------------------------------------------------------------
// Agent backend + reasoning effort
// ---------------------------------------------------------------------------

/** Which coding agent drives an edit. */
export const AGENT_KINDS = ["claude", "codex", "opencode"] as const;
export const AgentKindSchema = z.enum(AGENT_KINDS);
export type AgentKind = z.infer<typeof AgentKindSchema>;

/**
 * Reasoning effort, as the *union* of what the backends accept rather than the
 * intersection: Claude has no `minimal` and Codex has no `max`, and
 * intersecting would silently break existing `--effort max` invocations. Each
 * provider clamps the one level it lacks (see `toClaudeEffort`/`toCodexEffort`).
 * OpenCode exposes no reasoning-effort control at all and ignores the setting.
 */
export const EFFORT_LEVELS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const EffortSchema = z.enum(EFFORT_LEVELS);
export type Effort = z.infer<typeof EffortSchema>;

// ---------------------------------------------------------------------------
// Element + source location
// ---------------------------------------------------------------------------

export const SourceLocationSchema = z.object({
  column: z.number().int().optional(),
  /** A few lines of surrounding code, resolved server-side for the agent. */
  context: z.string().optional(),
  file: z.string(),
  line: z.number().int().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const ElementContextSchema = z.object({
  classes: z.array(z.string()).default([]),
  /** Framework component display name, when resolvable. */
  displayName: z.string().nullable().default(null),
  /** CSS-ish selector hint for the picked node. */
  selector: z.string().optional(),
  tagName: z.string(),
  textPreview: z.string().default(""),
});
export type ElementContext = z.infer<typeof ElementContextSchema>;

// ---------------------------------------------------------------------------
// Visual change set — the direct-manipulation edits accumulated in the design
// inspector. On "Apply" the overlay ships these deltas (not a code patch); the
// agent translates them into idiomatic source edits for the project's styling
// system. This is the key difference from a deterministic Tailwind writeback.
// ---------------------------------------------------------------------------

/**
 * Interaction states the inspector can force, so a user can inspect and edit
 * styles that only apply on hover/focus/etc.
 *
 * A superset of the three states most editors expose. `:focus-visible` and
 * `:disabled` are here because real design systems style them and there is no
 * cost to discovering a rule we can already parse — the picker only offers the
 * states some matched rule actually declares.
 */
export const PSEUDO_STATES = [
  ":hover",
  ":focus",
  ":focus-visible",
  ":focus-within",
  ":active",
  ":disabled",
] as const;
export const PseudoStateSchema = z.enum(PSEUDO_STATES);
export type PseudoState = z.infer<typeof PseudoStateSchema>;

/**
 * The project's own name for a value, resolved by the overlay before the change
 * is sent. This is what turns "padding-top: 16px" into "padding-top: --pk-space-4",
 * and it is the difference between the agent guessing at the design system and
 * being handed it.
 */
export const TokenRefSchema = z.object({
  /** The token's value, when it is only a near match — so the agent can judge. */
  actual: z.string().optional(),
  /** True when the token's value equals the new value exactly. */
  exact: z.boolean(),
  /** Where the token is defined, when it was found by the server-side scan. */
  file: z.string().optional(),
  kind: z.enum(["css-var", "utility-class"]),
  /** `--pk-space-4` or `.p-4`. */
  name: z.string(),
  /**
   * How we know. `reference` means the element names the token outright — a
   * utility class it carries, a `var()` in its own style attribute, or a token
   * the user just picked. `value` means only that the computed value happens to
   * equal the token's, which is circumstantial: a hardcoded `16px` is
   * indistinguishable from `var(--pk-space-md)` once the browser has resolved
   * it.
   *
   * The inspector needs the difference because "detach" is only meaningful
   * against a real reference. Offering it for a value match asked the user to
   * unlink something they had never linked.
   */
  via: z.enum(["reference", "value"]).optional(),
});
export type TokenRef = z.infer<typeof TokenRefSchema>;

export const StyleChangeSchema = z.object({
  /** The value before the tweak (computed or inline). */
  from: z.string(),
  /**
   * The user explicitly detached this property from its token, so the agent must
   * write a literal value rather than reaching for the scale. Without this an
   * "unlink" is indistinguishable from "no token matched", and the agent would
   * helpfully re-apply the token the user just rejected.
   */
  hardcode: z.boolean().optional(),
  /** CSS property name, kebab-case (e.g. "padding-top", "background-color"). */
  property: z.string(),
  /** The value the user tweaked it to. */
  to: z.string(),
  /** The project token matching `to`, when one does. */
  token: TokenRefSchema.optional(),
});
export type StyleChange = z.infer<typeof StyleChangeSchema>;

export const VisualEditTargetSchema = z.object({
  changes: z.array(StyleChangeSchema).min(1),
  element: ElementContextSchema,
  /**
   * The selector these changes should be written to — a class the element
   * carries, when the user widened the scope past this one instance. Absent
   * means "this element", which is the default and was the only behaviour
   * before scope targeting existed.
   */
  scope: z.string().optional(),
  source: SourceLocationSchema.nullable().default(null),
  /** The interaction state being edited. Absent means the default state. */
  state: PseudoStateSchema.optional(),
});
export type VisualEditTarget = z.infer<typeof VisualEditTargetSchema>;

// ---------------------------------------------------------------------------
// Structural move — a direct-manipulation *reposition* in the DOM tree (drag to
// reorder among siblings or reparent into another container). Unlike a style
// delta this carries no CSS: it tells the agent to relocate the element's JSX to
// a new parent/position, preserving its props and children.
// ---------------------------------------------------------------------------

export const MoveEditSchema = z.object({
  /** The sibling the element now renders immediately before. `null` ⇒ it was
   * appended as the new parent's last child. */
  before: ElementContextSchema.nullable().default(null),
  beforeSource: SourceLocationSchema.nullable().default(null),
  /** The element being repositioned (context + source captured pre-move). */
  element: ElementContextSchema,
  /** The container the element now lives in (null when unresolved). */
  newParent: ElementContextSchema.nullable().default(null),
  newParentSource: SourceLocationSchema.nullable().default(null),
  source: SourceLocationSchema.nullable().default(null),
  /** 0-based element-child index within the new parent, for disambiguation. */
  toIndex: z.number().int().nonnegative().optional(),
});
export type MoveEdit = z.infer<typeof MoveEditSchema>;

// ---------------------------------------------------------------------------
// Structural add/remove — deleting an element or duplicating it in place. Like
// a move this carries no CSS: it tells the agent to remove or clone the JSX. The
// overlay has already applied the change optimistically, so the agent is
// catching the source up to a DOM the user is already looking at.
// ---------------------------------------------------------------------------

export const STRUCTURAL_OPS = ["delete", "duplicate"] as const;
export const StructuralOpSchema = z.enum(STRUCTURAL_OPS);
export type StructuralOp = z.infer<typeof StructuralOpSchema>;

export const StructuralEditSchema = z.object({
  element: ElementContextSchema,
  op: StructuralOpSchema,
  source: SourceLocationSchema.nullable().default(null),
});
export type StructuralEdit = z.infer<typeof StructuralEditSchema>;

// ---------------------------------------------------------------------------
// HTML attributes — `alt`, `loading`, `autoplay`, `poster` and friends.
//
// Deliberately *not* folded into `visualChanges`. These are attributes on the
// element, not declarations in a stylesheet, and the agent edits them in a
// different place in the JSX. Describing `alt="…"` as a style change would make
// the prompt ask for something that does not exist.
// ---------------------------------------------------------------------------

export const AttrChangeSchema = z.object({
  /** Attribute name as authored (`alt`, `loading`, `playsinline`). */
  attribute: z.string(),
  /** Absent ⇒ the attribute was not present before. */
  from: z.string().nullable().default(null),
  /** `null` ⇒ remove the attribute (a boolean attribute switched off). */
  to: z.string().nullable(),
});
export type AttrChange = z.infer<typeof AttrChangeSchema>;

export const AttrEditTargetSchema = z.object({
  changes: z.array(AttrChangeSchema).min(1),
  element: ElementContextSchema,
  source: SourceLocationSchema.nullable().default(null),
});
export type AttrEditTarget = z.infer<typeof AttrEditTargetSchema>;

// ---------------------------------------------------------------------------
// Text content — an in-place edit of a leaf text node. Deliberately the whole
// `textContent` rather than a diff: the agent needs to find the string in the
// source, and "the old text" is the only reliable way to locate it when the same
// component renders in several places.
// ---------------------------------------------------------------------------

export const TextEditSchema = z.object({
  element: ElementContextSchema,
  from: z.string(),
  source: SourceLocationSchema.nullable().default(null),
  to: z.string(),
});
export type TextEditTarget = z.infer<typeof TextEditSchema>;

// ---------------------------------------------------------------------------
// Image attachments (sent inline to Claude via the SDK's native image input)
// ---------------------------------------------------------------------------

export const ImageInputSchema = z.object({
  /** Raw base64 (no `data:` prefix). */
  dataBase64: z.string(),
  mediaType: z.string(),
  /** Filename hint (display only). */
  name: z.string().optional(),
});
export type ImageInput = z.infer<typeof ImageInputSchema>;

// ---------------------------------------------------------------------------
// Review comments — the user's feedback on an edit the agent already made.
//
// Deliberately carries the snippet alongside the line range. Line numbers refer
// to the file as the edit left it and drift the moment anything else touches it,
// so the text is what lets the agent re-find the code — the same reasoning
// `TextEditSchema` above relies on.
// ---------------------------------------------------------------------------

export const CommentSchema = z.object({
  /** What the user actually said. */
  body: z.string(),
  /** Repo-relative path, as it appears in the diff. */
  file: z.string(),
  /** 1-based inclusive range in the post-edit file, when pinned to lines. */
  fromLine: z.number().int().optional(),
  /** The job whose edit this comments on — lets the turn resume that session. */
  jobId: z.string().optional(),
  /** The lines the comment points at, so the agent can re-locate by content. */
  snippet: z.string().default(""),
  toLine: z.number().int().optional(),
});
export type ReviewComment = z.infer<typeof CommentSchema>;

// ---------------------------------------------------------------------------
// Editors we know how to open a file in.
// ---------------------------------------------------------------------------

export const EDITORS = ["vscode", "cursor", "windsurf", "zed"] as const;
export const EditorSchema = z.enum(EDITORS);
export type Editor = z.infer<typeof EditorSchema>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const JOB_STATUSES = ["running", "done", "failed", "cancelled"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const CreateJobRequestSchema = z
  .object({
    /** Which backend to run this turn on. Absent means the daemon's launch
     * default (`--agent`), which is what a client that predates the picker sends. */
    agent: AgentKindSchema.optional(),
    /** Direct-manipulation HTML attribute edits (`alt`, `loading`, `autoplay`). */
    attrChanges: z.array(AttrEditTargetSchema).optional(),
    /** Review feedback on the previous edit's diff. Like the delta arrays,
     * these make `prompt` optional — a comments-only turn is a valid turn. */
    comments: z.array(CommentSchema).optional(),
    element: ElementContextSchema.optional(),
    /** Fork instead of continue — "try a different approach". */
    fork: z.boolean().optional(),
    images: z.array(ImageInputSchema).optional(),
    /** Direct-manipulation structural moves (drag-to-reposition in the tree).
     * Like `visualChanges`, these make `prompt` optional. */
    moveChanges: z.array(MoveEditSchema).optional(),
    /** Resume a previous job's agent session (multi-turn refinement). */
    parentJobId: z.string().optional(),
    /** Free-text instruction. May be empty for a pure visual (deltas-only) edit,
     * or an optional "note" that rides along with `visualChanges`. */
    prompt: z.string().default(""),
    source: SourceLocationSchema.nullable().optional(),
    /** Direct-manipulation deletes and duplicates. */
    structuralChanges: z.array(StructuralEditSchema).optional(),
    /** In-place text edits. */
    textChanges: z.array(TextEditSchema).optional(),
    /** Direct-manipulation style deltas from the design inspector. When present,
     * `prompt` is optional and treated as an accompanying note. */
    visualChanges: z.array(VisualEditTargetSchema).optional(),
  })
  .refine(
    (r) =>
      r.prompt.trim().length > 0 ||
      (r.visualChanges?.length ?? 0) > 0 ||
      (r.moveChanges?.length ?? 0) > 0 ||
      (r.structuralChanges?.length ?? 0) > 0 ||
      (r.textChanges?.length ?? 0) > 0 ||
      (r.attrChanges?.length ?? 0) > 0 ||
      (r.comments?.length ?? 0) > 0,
    {
      message:
        "either prompt, visualChanges, moveChanges, structuralChanges, textChanges, attrChanges, or comments is required",
    }
  );
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;

// ---------------------------------------------------------------------------
// Diffs (captured via Agent SDK hooks, rendered by the overlay)
// ---------------------------------------------------------------------------

export const FileDiffSchema = z.object({
  additions: z.number().int(),
  after: z.string().nullable().optional(),
  before: z.string().nullable().optional(),
  deletions: z.number().int(),
  file: z.string(),
  isDeleted: z.boolean(),
  isNew: z.boolean(),
  patch: z.string(),
});
export type FileDiff = z.infer<typeof FileDiffSchema>;

// ---------------------------------------------------------------------------
// Structured output (the Agent SDK returns this typed object per edit)
// ---------------------------------------------------------------------------

export const EditStructuredOutputSchema = z.object({
  filesChanged: z.array(z.string()),
  followUps: z.array(z.string()),
  summary: z.string(),
});
export type EditStructuredOutput = z.infer<typeof EditStructuredOutputSchema>;

/** JSON Schema handed to the SDK `outputFormat` option (kept literal to avoid a
 * zod→JSON-schema conversion dependency). Mirrors {@link EditStructuredOutputSchema}. */
export const EDIT_OUTPUT_JSON_SCHEMA = {
  additionalProperties: false,
  properties: {
    filesChanged: {
      description: "Repo-relative paths of files that were edited.",
      items: { type: "string" },
      type: "array",
    },
    followUps: {
      description:
        "Up to 3 suggested follow-up edits the user might want next.",
      items: { type: "string" },
      type: "array",
    },
    summary: {
      description: "One concise sentence describing what was changed.",
      type: "string",
    },
  },
  required: ["summary", "filesChanged", "followUps"],
  type: "object",
} as const;

// ---------------------------------------------------------------------------
// Todos (surfaced from Claude's TodoWrite tool for multi-step edits)
// ---------------------------------------------------------------------------

export const TodoItemSchema = z.object({
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

// ---------------------------------------------------------------------------
// Agent activity timeline — the ordered log of what the agent did during a job.
// Live it arrives as deltas over the socket; finished it is persisted verbatim
// into `JobDiffBundle.timeline`, so reopening a thread replays the identical
// sequence rather than an approximation of it.
//
// Deliberately plain interfaces, not zod: the overlay imports these as types
// only, which is what keeps zod out of the injected browser bundle. Server →
// client payloads are never re-validated, so there is nothing to validate with.
// ---------------------------------------------------------------------------

export type ToolPhase = "pending" | "ok" | "error";

/** The one-line `⎿` text under a tool, plus its optional expanded body. Produced
 * by `@airship/core` and already size-capped — a `Read` returns a whole file and
 * a build returns hundreds of KB, none of which should cross the wire or land in
 * `~/.airship/history`. */
export interface ToolResultSummary {
  /** Expanded detail (tail of stdout, grep hits, the patch). Pre-truncated. */
  detail?: string;
  /** Lines dropped by truncation, for the "… +N lines" affordance. */
  droppedLines?: number;
  /** "Read 214 lines" · "+12 −4" · "exit 1". Capped to ~120 chars. */
  text: string;
  /** True when `detail` was clipped. */
  truncated?: boolean;
}

interface TimelineItemBase {
  /** Stable key. For tools this is the SDK `tool_use.id` — the join key with the
   * `tool_result` block carried by the *following* user message. Synthetic for
   * text/thinking blocks, which have no SDK id. */
  id: string;
  /** ms since job start. Relative, so bundles stay diffable and clock-agnostic. */
  startedAt: number;
}

export interface TimelineToolItem extends TimelineItemBase {
  /** Whitelisted, stringified, capped subset of the tool input. Never the raw
   * input — `Write.content` and `MultiEdit.edits` are unbounded. */
  args: Record<string, string>;
  endedAt?: number;
  kind: "tool";
  /** Raw SDK tool name: "Read" | "Bash" | "MultiEdit" | "mcp__airship__…". */
  name: string;
  /** SDK `parent_tool_use_id`, set for subagent-nested calls. Reserved. */
  parentToolUseId?: string | null;
  phase: ToolPhase;
  /** Absent while `phase === "pending"`. */
  result?: ToolResultSummary;
  /** Mono header text: `Read(src/app.ts)`, `Bash(pnpm build)`. */
  title: string;
}

export interface TimelineThinkingItem extends TimelineItemBase {
  estimatedTokens?: number;
  kind: "thinking";
  streaming?: boolean;
  /** May be "" during the redacted-thinking phase, where the API streams only
   * token estimates — render `estimatedTokens` instead of an empty box. */
  text: string;
}

export interface TimelineTextItem extends TimelineItemBase {
  kind: "text";
  streaming?: boolean;
  /** Assistant prose, markdown. Rendered in sans — not part of the tool grammar. */
  text: string;
}

export interface TimelineTodosItem extends TimelineItemBase {
  kind: "todos";
  /** `id` is the TodoWrite `tool_use.id`, so a re-write patches in place rather
   * than appending a second list. */
  todos: TodoItem[];
}

export type TimelineItem =
  | TimelineToolItem
  | TimelineThinkingItem
  | TimelineTextItem
  | TimelineTodosItem;

/**
 * A partial update to an already-appended item, addressed by `id`. The fields
 * are a flat union across kinds; a consumer applies only what it understands.
 *
 * `textDelta` and `text` are both present on purpose: streaming appends via
 * `textDelta`, and the final block commit sends `text` as an absolute replace.
 * The deltas arrive *before* the assistant message that repeats the same prose,
 * so an append-only model would double it.
 */
export interface TimelineItemPatch {
  endedAt?: number;
  estimatedTokens?: number;
  phase?: ToolPhase;
  result?: ToolResultSummary;
  streaming?: boolean;
  /** Replace `text` wholesale. Always wins over accumulated deltas. */
  text?: string;
  /** Append to `text` (streaming). */
  textDelta?: string;
  todos?: TodoItem[];
}

// ---------------------------------------------------------------------------
// Usage / cost
// ---------------------------------------------------------------------------

export const UsageSchema = z.object({
  costUsd: z.number().optional(),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

// ---------------------------------------------------------------------------
// History bundles
// ---------------------------------------------------------------------------

export interface JobTargetSummary {
  displayName: string | null;
  source: SourceLocation | null;
  tagName: string;
}

export interface JobHistorySummary {
  additions: number;
  /** Which backend produced this job. Absent on bundles written before the
   * Codex backend existed, which are all Claude by construction — so readers
   * should treat `undefined` as `"claude"`. Load-bearing: `sessionId` means a
   * `~/.claude` session for one agent and a `~/.codex` thread for the other, so
   * resume must not cross backends. */
  agent?: AgentKind;
  /** File-checkpoint id (first user-message uuid) for SDK `rewindFiles`. */
  checkpointId?: string;
  completedAt?: number;
  createdAt: number;
  deletions: number;
  error?: string;
  filesChanged: number;
  jobId: string;
  parentJobId?: string;
  promptPreview: string;
  /** Agent session id — a Claude session or a Codex thread, per `agent`. Used
   * to resume/fork the underlying SDK session. */
  sessionId?: string;
  status: JobStatus;
  target: JobTargetSummary;
}

export interface JobDiffBundle extends JobHistorySummary {
  diffs: FileDiff[];
  followUps?: string[];
  prompt: string;
  summary?: string;
  /** The full activity log, in order. Optional: bundles written before the
   * timeline existed replay as an empty sequence and render as they always did.
   * Stripped by `toSummary()` in the server's history module — it is the one
   * heavy field on the bundle and must never ride along in a history listing. */
  timeline?: TimelineItem[];
  usage?: Usage;
}

export interface JobSnapshot {
  createdAt: number;
  error?: string;
  jobId: string;
  prompt?: string;
  status: JobStatus;
  step?: string;
}

// ---------------------------------------------------------------------------
// WebSocket protocol: server → client
// ---------------------------------------------------------------------------

export type ServerEvent =
  /** `defaultAgent` is the daemon's `--agent` setting, so the composer's picker
   * can render the right backend on first paint instead of guessing. */
  | { type: "hello"; jobs: JobSnapshot[]; defaultAgent: AgentKind }
  | { type: "job:created"; job: JobSnapshot }
  /** Coarse one-line status ("Reading foo.tsx"). Self-overwriting by design —
   * it drives the turn's live status pill, not the transcript body. */
  | { type: "job:step"; jobId: string; step: string }
  /** @deprecated Superseded by `job:timeline` text items, which persist and
   * replay. Still broadcast so an older overlay keeps streaming prose. */
  | { type: "job:text"; jobId: string; delta: string }
  /** @deprecated Superseded by `job:timeline` todos items. */
  | { type: "job:todos"; jobId: string; todos: TodoItem[] }
  /** A new item was appended to the job's activity timeline. */
  | { type: "job:timeline"; jobId: string; item: TimelineItem }
  /** An already-appended timeline item changed (result arrived, prose streamed).
   * A patch for an unknown id is ignorable — that is the mid-job-reconnect case,
   * repaired wholesale by the `job:done` bundle. */
  | {
      type: "job:timeline:patch";
      jobId: string;
      id: string;
      patch: TimelineItemPatch;
    }
  | {
      type: "job:status";
      jobId: string;
      status: JobStatus;
      error?: string;
    }
  | { type: "job:done"; jobId: string; bundle: JobDiffBundle }
  | { type: "history"; entries: JobHistorySummary[] }
  | { type: "thread"; rootJobId: string; entries: JobDiffBundle[] }
  /** The project's design tokens, scanned from the files on disk. Answers a
   * `tokens` request; also pushed unprompted once the first scan completes. */
  | { type: "tokens:result"; scan: TokenScanResult }
  /** The assembled instruction for a `prompt` request — the exact string the
   * adapter would receive. Sent to the asking socket only: a broadcast would let
   * one tab's composer overwrite another's preview. */
  | { type: "prompt:result"; text: string }
  | { type: "undo:result"; jobId: string; ok: boolean; error?: string }
  | {
      type: "commit:result";
      ok: boolean;
      sha?: string;
      pushed?: boolean;
      error?: string;
    }
  | {
      type: "open:result";
      ok: boolean;
      file: string;
      editor?: string;
      error?: string;
    }
  /** `stage` names where a multi-step PR flow stopped, so the toast can say
   * "no origin remote" rather than "failed". */
  | {
      type: "pr:result";
      ok: boolean;
      url?: string;
      stage?: "branch" | "commit" | "create" | "preflight" | "push";
      error?: string;
    }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// WebSocket protocol: client → server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ request: CreateJobRequestSchema, type: z.literal("edit") }),
  z.object({ jobId: z.string(), type: z.literal("cancel") }),
  z.object({ jobId: z.string(), type: z.literal("undo") }),
  z.object({ type: z.literal("history") }),
  z.object({ rootJobId: z.string(), type: z.literal("thread") }),
  /** Scan the project's CSS for design tokens. Read-only, so the server answers
   * it off the edit chain. `refresh` busts the mtime cache after a token file
   * changes under the daemon. */
  z.object({
    refresh: z.boolean().optional(),
    type: z.literal("tokens"),
  }),
  /**
   * Render the prompt this request would produce, without running it. Read-only,
   * so the server answers it off the edit chain like `tokens`.
   *
   * It runs the same source backfill and token scan a real turn does, which is
   * why this is a round trip at all: the file/line context and the design-scale
   * legend are only knowable server-side, so a client-side re-derivation would
   * show the user a string the agent never receives.
   */
  z.object({ request: CreateJobRequestSchema, type: z.literal("prompt") }),
  z.object({
    jobId: z.string(),
    message: z.string().optional(),
    push: z.boolean().optional(),
    type: z.literal("commit"),
  }),
  /** Open a file in the user's editor. `file` is repo-relative and is resolved
   * against the daemon's cwd — and validated to stay inside it. */
  z.object({
    column: z.number().int().optional(),
    editor: EditorSchema.optional(),
    file: z.string(),
    line: z.number().int().optional(),
    type: z.literal("open"),
  }),
  z.object({
    branch: z.string().optional(),
    jobId: z.string(),
    title: z.string().optional(),
    type: z.literal("pr"),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * How the overlay bundle should boot. The same IIFE is injected into all three
 * surfaces and picks its role from this.
 *
 * - `shell` — the canvas: pan/zoom viewport, docks, chat, inspector. Owns the
 *   only control WebSocket. The user's app is *not* in this document.
 * - `frame` — inside a frame iframe. Installs the realm-local agent the shell
 *   calls into and nothing else: no UI, no socket.
 * - `inline` — the original single-document overlay, injected straight into the
 *   running app. A first-class surface, selected with `airship --mode inline`
 *   or the editor's own switcher.
 */
export type AirshipMode = "shell" | "frame" | "inline";

/**
 * The two surfaces a user can actually choose between, in the words the CLI and
 * the editor use for them.
 *
 * Deliberately not the same vocabulary as `AirshipMode`. `shell` describes what
 * the document *is* to the proxy; `canvas` describes what the user sees, and is
 * the word every doc, flag and button uses. `frame` is internal plumbing — it is
 * a mode but never a surface, which is why this cannot just be a subset type.
 *
 * `mode` is also already taken inside the overlay for edit-vs-view
 * (`data-__airship-mode="edit"`), so everything below the CLI boundary says
 * "surface" to keep the two apart.
 */
export type AirshipSurface = "canvas" | "inline";

export function surfaceToMode(surface: AirshipSurface): AirshipMode {
  return surface === "canvas" ? "shell" : "inline";
}

/** `frame` has no surface of its own; it reports the canvas that owns it. */
export function modeToSurface(mode: AirshipMode): AirshipSurface {
  return mode === "inline" ? "inline" : "canvas";
}

/** Query parameter the proxy branches on when serving HTML. */
export const AIRSHIP_MODE_PARAM = "__airship";

/**
 * Sticky surface preference, written by the editor's own switcher.
 *
 * A cookie and not localStorage because the choice has to be made by the proxy,
 * before any script runs — it decides whether the response body is the canvas
 * shell or the app itself. Scoped to the proxy origin, so it never travels to
 * the app's real host.
 */
export const AIRSHIP_SURFACE_COOKIE = "__airship_surface";

/** Read the surface cookie out of a raw `Cookie:` header. */
export function readSurfaceCookie(
  header: string | undefined
): AirshipSurface | undefined {
  if (!header) {
    return;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) {
      continue;
    }
    if (part.slice(0, eq).trim() !== AIRSHIP_SURFACE_COOKIE) {
      continue;
    }
    const value = part.slice(eq + 1).trim();
    if (value === "canvas" || value === "inline") {
      return value;
    }
  }
}

/** Prefix of the `window.name` a frame iframe is created with, plus its id. */
export const AIRSHIP_FRAME_NAME = "__airship-frame:";

/** Global injected into the page before the overlay bundle loads. */
export interface AirshipWindowConfig {
  /** Which surface this document is. Absent ⇒ `inline` (older injections). */
  mode?: AirshipMode;
  /**
   * The app path this document belongs to, `__airship` stripped.
   *
   * The shell points its frames at it — requesting `/settings` serves the shell,
   * which then loads `/settings?__airship=frame` into every frame. Inline gets
   * it too, so its surface switcher can navigate to the clean path rather than
   * reconstructing one from a URL that may still carry an explicit override.
   */
  pathname?: string;
  wsPath: string;
}
