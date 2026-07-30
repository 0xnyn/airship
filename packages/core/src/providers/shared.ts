/**
 * The vocabulary every non-Claude backend translates *into*.
 *
 * `tool-summary.ts` dispatches on Claude's tool names, and the overlay renders
 * `TimelineToolItem.title` and never reads `.name` — so the name is a private
 * dispatch key, and mapping a provider's own tool onto it misleads nothing
 * while buying one copy of the genuinely provider-neutral rules for truncating
 * build logs and counting patch hunks.
 *
 * This lives apart from any one provider's translation file because both Codex
 * and OpenCode need it. Having `opencode-events.ts` import from
 * `codex-events.ts` would be real coupling between two backends that share
 * nothing else.
 */
import { structuredPatch } from "diff";

/** A provider's tool call expressed in the shared vocabulary. */
export interface NormalizedTool {
  /** Present only on completion; the payload the `⎿` summary is derived from. */
  content?: unknown;
  /** Stable across the call's started/completed pair. */
  id: string;
  input: unknown;
  isError?: boolean;
  name: string;
  /** The richer, probe-defensively `tool_use_result` analogue. */
  typed?: unknown;
}

/**
 * Build a `structuredPatch`-shaped probe target from a before/after pair, so a
 * backend that reports *which* files changed but never *how much* can still
 * show a real `+N −M` on an `Edit(...)` row.
 *
 * Runs an actual line diff rather than treating the whole file as replaced:
 * `countsFromStructuredPatch` counts `+`/`-` prefixed lines, so a naive
 * whole-file pair would report every line as both added and removed.
 */
export function synthesizePatch(
  before: string | null,
  after: string | null
): { structuredPatch: Array<{ lines: string[] }> } {
  const { hunks } = structuredPatch("a", "b", before ?? "", after ?? "");
  return { structuredPatch: hunks.map((h) => ({ lines: [...h.lines] })) };
}
