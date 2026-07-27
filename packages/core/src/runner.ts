/**
 * @airship/core — the agent engine. `runEdit()` drives a single visual edit
 * through whichever backend is selected (Claude Agent SDK or OpenAI Codex),
 * owning everything that does not depend on that choice: the rendered prompt,
 * the activity timeline, before/after diff capture, and the assembly of the
 * result. Provider-specific work lives behind `AgentAdapter` in `./providers`.
 */

import { dirtyFiles, fileAtHead, isGitRepo } from "@airship/git";
import type {
  AgentKind,
  AttrEditTarget,
  EditStructuredOutput,
  Effort,
  ElementContext,
  FileDiff,
  ImageInput,
  MoveEdit,
  ReviewComment,
  SourceLocation,
  StructuralEdit,
  TextEditTarget,
  TimelineItem,
  TimelineItemPatch,
  TodoItem,
  TokenScanResult,
  Usage,
  VisualEditTarget,
} from "@airship/protocol";
import { failureText, getAdapter } from "./agent";
import { DiffCapture } from "./diff-capture";
import { buildEditPrompt } from "./prompt";
import type { CodexSettings } from "./providers/codex";
import type { OpencodeSettings } from "./providers/opencode-server";
import { TimelineRecorder } from "./timeline";

export interface RunEditInput {
  abortController?: AbortController;
  /** Which backend to run on. Defaults to Claude. */
  agent?: AgentKind;
  /** Direct-manipulation HTML attribute edits. */
  attrChanges?: AttrEditTarget[];
  /** Codex-only passthrough knobs (`--codex-path`, `--codex-config`). */
  codex?: CodexSettings;
  /** Review feedback on a previous turn's diff. */
  comments?: ReviewComment[];
  cwd: string;
  effort?: Effort;
  element?: ElementContext;
  /** Fork the resumed session instead of continuing it. */
  fork?: boolean;
  images?: ImageInput[];
  /** Claude-only: Codex `exec` has no budget cap and reports no cost. */
  maxBudgetUsd?: number;
  /** Claude-only: Codex `exec` runs a turn to completion. */
  maxTurns?: number;
  model?: string;
  /** Direct-manipulation structural moves (drag-to-reposition). */
  moveChanges?: MoveEdit[];
  /** OpenCode-only passthrough knobs (`--opencode-path`, `--opencode-url`, …). */
  opencode?: OpencodeSettings;
  prompt: string;
  /** Resume this agent session (multi-turn refinement). */
  resumeSessionId?: string | null;
  /** Confine edits to the project directory and cut network access. Off by
   * default: the agent runs unsandboxed. */
  safe?: boolean;
  source?: SourceLocation | null;
  /** Direct-manipulation deletes and duplicates. */
  structuralChanges?: StructuralEdit[];
  /** In-place text edits. */
  textChanges?: TextEditTarget[];
  /** The project's design tokens, scanned from disk by the server. Lets the
   * prompt name the scale instead of telling the agent one probably exists. */
  tokens?: TokenScanResult;
  /** Direct-manipulation style deltas from the design inspector. */
  visualChanges?: VisualEditTarget[];
}

export interface RunEditEvents {
  onSessionId?: (id: string) => void;
  /** Coarse, self-overwriting one-liner ("Reading foo.tsx") for the status pill.
   * Superseded for transcript purposes by the timeline, but kept: it is what
   * `JobSnapshot.step` reports to a client that connects mid-job. */
  onStep?: (step: string) => void;
  onText?: (delta: string) => void;
  /** A row was appended to the activity timeline. */
  onTimeline?: (item: TimelineItem) => void;
  /** An existing timeline row changed (result landed, prose streamed). */
  onTimelinePatch?: (id: string, patch: TimelineItemPatch) => void;
  onTodos?: (todos: TodoItem[]) => void;
}

export interface RunEditResult {
  checkpointId: string | null;
  diffs: FileDiff[];
  error?: string;
  followUps: string[];
  ok: boolean;
  sessionId: string | null;
  structured?: EditStructuredOutput | null;
  summary: string;
  /** The ordered activity log, persisted into the job bundle for replay. */
  timeline: TimelineItem[];
  usage?: Usage;
}

export async function runEdit(
  input: RunEditInput,
  events: RunEditEvents = {}
): Promise<RunEditResult> {
  const kind = input.agent ?? "claude";
  const adapter = await getAdapter(kind);

  // A backend without a pre-tool hook cannot snapshot a file before the agent
  // writes it, so its `before` side is reconstructed from the file's HEAD blob
  // and the pre-turn dirty set is primed as a baseline. Both halves belong
  // together and neither is provider-specific, so they live here rather than
  // being copied into every adapter that needs them.
  const diffCapture = new DiffCapture(
    input.cwd,
    adapter.needsGitBaseline ? (abs) => fileAtHead(input.cwd, abs) : undefined
  );
  if (adapter.needsGitBaseline) {
    diffCapture.prime(
      isGitRepo(input.cwd) ? dirtyFiles(input.cwd) : new Set<string>()
    );
  }

  // One recorder owns both the persisted array and the live sink, so the
  // streamed timeline and `RunEditResult.timeline` can never drift apart.
  const recorder = new TimelineRecorder({
    onItem: events.onTimeline,
    onPatch: events.onTimelinePatch,
  });

  let lastStep = "";
  const emitStep = (step: string): void => {
    if (step && step !== lastStep) {
      lastStep = step;
      events.onStep?.(step);
    }
  };

  let outcome: Awaited<ReturnType<typeof adapter.run>>;
  try {
    outcome = await adapter.run({
      diffs: diffCapture,
      emitStep,
      events,
      input,
      promptText: buildEditPrompt(input),
      recorder,
    });
  } catch (err) {
    // An adapter is expected to map its own failures onto `outcome.error`, but
    // a throw here (a failed dynamic import, a missing binary) must still
    // produce a well-formed result rather than rejecting into the job chain.
    outcome = {
      error: failureText(err, input.abortController),
      sessionId: input.resumeSessionId ?? null,
    };
  }

  const diffs = diffCapture.finalize();
  const summary =
    outcome.structured?.summary ||
    outcome.resultText ||
    (outcome.error ? "" : "Edit applied.");

  return {
    checkpointId: outcome.checkpointId ?? null,
    diffs,
    error: outcome.error,
    followUps: outcome.structured?.followUps ?? [],
    ok: !outcome.error,
    sessionId: outcome.sessionId,
    structured: outcome.structured,
    summary,
    timeline: recorder.snapshot(),
    usage: outcome.usage,
  };
}

/**
 * Rewind files to the checkpoint captured during an edit, using the backend's
 * native file checkpointing. Only Claude has one; Codex reports as much rather
 * than silently doing nothing. (`@airship/git.restoreFiles` is the instant,
 * primary undo on both paths; this is the SDK-native alternative.)
 */
export async function rewindEdit(params: {
  agent?: AgentKind;
  checkpointId: string;
  cwd: string;
  sessionId: string;
}): Promise<{ error?: string; ok: boolean }> {
  const adapter = await getAdapter(params.agent ?? "claude");
  if (!adapter.rewind) {
    return {
      error: `${adapter.kind} has no native file checkpointing`,
      ok: false,
    };
  }
  return adapter.rewind(params);
}

/** Best-effort auth check so the CLI can warn early. */
export async function checkAuth(
  agent: AgentKind = "claude"
): Promise<{ ok: boolean; reason?: string }> {
  const adapter = await getAdapter(agent);
  return adapter.checkAuth();
}
