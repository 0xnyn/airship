/**
 * Resolving an edit request against the project on disk, so the prompt can name
 * files, lines and design tokens the browser has no way to know.
 */
import type { EditPromptInput } from "@airship/core";
import type {
  CreateJobRequest,
  ElementContext,
  SourceLocation,
} from "@airship/protocol";
import { resolveServerSource } from "@airship/source/server";
import { scanProjectTokens } from "@airship/source/tokens";

/**
 * Backfill file/line/context for every edit that names a DOM element, the same
 * way the single selection is resolved — the agent cannot find a JSX node it
 * has no location for.
 */
function backfillSources(cwd: string, request: CreateJobRequest) {
  const locate = (element: ElementContext, source?: SourceLocation | null) =>
    resolveServerSource(cwd, { element, source: source ?? null });
  return {
    attrChanges: request.attrChanges?.map((target) => ({
      ...target,
      source: locate(target.element, target.source),
    })),
    // Each move needs its element, its new parent, and its anchor sibling.
    moveChanges: request.moveChanges?.map((move) => ({
      ...move,
      beforeSource: move.before ? locate(move.before, move.beforeSource) : null,
      newParentSource: move.newParent
        ? locate(move.newParent, move.newParentSource)
        : null,
      source: locate(move.element, move.source),
    })),
    structuralChanges: request.structuralChanges?.map((edit) => ({
      ...edit,
      source: locate(edit.element, edit.source),
    })),
    textChanges: request.textChanges?.map((edit) => ({
      ...edit,
      source: locate(edit.element, edit.source),
    })),
    visualChanges: request.visualChanges?.map((target) => ({
      ...target,
      source: locate(target.element, target.source),
    })),
  };
}

/** The element the turn is *about*, and where it lives. */
function primaryLocation(cwd: string, request: CreateJobRequest) {
  const primaryElement =
    request.element ??
    request.visualChanges?.[0]?.element ??
    request.moveChanges?.[0]?.element ??
    request.structuralChanges?.[0]?.element ??
    request.textChanges?.[0]?.element ??
    request.attrChanges?.[0]?.element;
  const source = resolveServerSource(cwd, {
    element: primaryElement,
    source:
      request.source ??
      request.visualChanges?.[0]?.source ??
      request.moveChanges?.[0]?.source ??
      request.structuralChanges?.[0]?.source ??
      request.textChanges?.[0]?.source ??
      request.attrChanges?.[0]?.source ??
      null,
  });
  return { primaryElement, source };
}

/**
 * Everything the prompt is built from, resolved against the project on disk.
 *
 * Returns an `EditPromptInput` exactly, and that is the point: `startEdit`
 * spreads it into `runEdit` (which renders it via `buildEditPrompt`) and the
 * `prompt` handler renders it directly, so the preview the user reads and the
 * instruction the agent receives are the same string by construction rather
 * than by inspection. Anything prompt-relevant assembled outside this function
 * is a drift bug.
 */
export function preparePromptInput(
  cwd: string,
  request: CreateJobRequest
): EditPromptInput {
  const { primaryElement, source } = primaryLocation(cwd, request);
  return {
    ...backfillSources(cwd, request),
    // No `resolveServerSource` backfill: a comment already carries a
    // repo-relative path and a real source line. That resolver maps DOM
    // elements onto source, which a comment has already skipped past.
    comments: request.comments,
    element: primaryElement,
    prompt: request.prompt,
    source,
    // The project's own design vocabulary, so the prompt can name tokens
    // instead of advising the agent to go looking for some. Cached after the
    // first walk, so this is a map lookup on every turn but the first.
    tokens: scanProjectTokens(cwd),
  };
}
