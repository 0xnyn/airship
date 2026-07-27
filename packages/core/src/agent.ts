/**
 * The provider seam.
 *
 * `runEdit` owns everything that is the same regardless of backend — building
 * the prompt, the timeline recorder, the diff capture, the step de-duplication,
 * and the assembly of the final `RunEditResult`. An adapter owns only the part
 * that genuinely differs: how to start a session, and how to translate that
 * session's event stream into recorder calls.
 *
 * Keeping the result assembly on the shared side is deliberate. It means the
 * two backends cannot drift in what they report, only in how they get there.
 */
import type { EditStructuredOutput, Usage } from "@airship/protocol";
import type { DiffCapture } from "./diff-capture";
import type { RunEditEvents, RunEditInput } from "./runner";
import type { TimelineRecorder } from "./timeline";

export type { AgentKind } from "@airship/protocol";

import type { AgentKind } from "@airship/protocol";

/** Everything an adapter is handed. Provider-neutral by construction. */
export interface AgentRunContext {
  /** Net before→after capture. Codex additionally needs `prime`/`recordAfterTheFact`. */
  diffs: DiffCapture;
  /** De-duplicated, so both backends behave identically at the status pill. */
  emitStep: (step: string) => void;
  events: RunEditEvents;
  input: RunEditInput;
  /** `buildEditPrompt(input)` already rendered — adapters must not re-derive it. */
  promptText: string;
  recorder: TimelineRecorder;
}

/**
 * What an adapter returns. `runEdit` assembles the public `RunEditResult`
 * around this, so an adapter never constructs one itself.
 */
export interface AgentRunOutcome {
  /** Claude-only: the file-checkpoint anchor for `rewindFiles`. */
  checkpointId?: string | null;
  error?: string;
  /** The final prose response, used as `summary` when there is no structured output. */
  resultText?: string;
  sessionId: string | null;
  structured?: EditStructuredOutput | null;
  usage?: Usage;
}

export interface AgentAdapter {
  /** Best-effort, synchronous, env/fs-only so startup stays fast. */
  checkAuth: () => { ok: boolean; reason?: string };
  readonly kind: AgentKind;
  /**
   * True when the backend has no pre-tool hook, so a write is only ever
   * reported after it already happened. Such a backend needs both halves of
   * the reconstructed baseline: `before` read from the file's git HEAD blob,
   * and the pre-turn dirty set primed so a file the user had already edited by
   * hand diffs from its on-disk state rather than from HEAD.
   *
   * Claude snapshots each file in a `PreToolUse` hook and needs neither.
   */
  readonly needsGitBaseline?: boolean;
  /** Optional because not every backend has native file checkpointing. */
  rewind?: (params: {
    checkpointId: string;
    cwd: string;
    sessionId: string;
  }) => Promise<{ error?: string; ok: boolean }>;
  run: (ctx: AgentRunContext) => Promise<AgentRunOutcome>;
}

/**
 * What to report for a thrown error.
 *
 * An abort surfaces as an ordinary throw, so the signal has to be consulted
 * before the error itself — otherwise cancelling a run reads as a failure with
 * whatever message the SDK happened to unwind with. Every adapter and the
 * runner need exactly this, hence one copy.
 */
export function failureText(
  err: unknown,
  abortController?: AbortController
): string {
  if (abortController?.signal.aborted) {
    return "cancelled";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve a backend. A plain switch with static `import()` specifiers, so tsup
 * can see both chunks; the dynamic form means a Claude-only run never pays to
 * load the Codex SDK (and vice versa), and a broken install surfaces as a clear
 * import error at use rather than a crash at module load.
 */
export async function getAdapter(kind: AgentKind): Promise<AgentAdapter> {
  switch (kind) {
    case "codex": {
      const { codexAdapter } = await import("./providers/codex");
      return codexAdapter;
    }
    case "opencode": {
      const { opencodeAdapter } = await import("./providers/opencode");
      return opencodeAdapter;
    }
    default: {
      const { claudeAdapter } = await import("./providers/claude");
      return claudeAdapter;
    }
  }
}
