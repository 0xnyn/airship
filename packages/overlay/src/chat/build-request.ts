/**
 * Assembling one edit turn from the composer's state.
 *
 * Its own module rather than a method on `AirshipApp` because two callers need
 * it — Send and the prompt preview — and because a pure function over the
 * change sets is testable, where the app that owns them is not.
 */
import type {
  AgentKind,
  CreateJobRequest,
  ImageInput,
} from "@airship/protocol";
import type { AttrSet } from "../attr-set";
import type { ChangeSet } from "../change-set";
import type { CommentSet } from "../comment-set";
import type { MoveSet } from "../move-set";
import type { Selection } from "../picker";
import type { StructureSet } from "../structure-set";

/** The composer state one turn is assembled from — `AirshipApp`'s own fields. */
export interface EditRequestParts {
  agent: AgentKind;
  attrSet: AttrSet;
  changeSet: ChangeSet;
  commentSet: CommentSet;
  images: ImageInput[];
  /** Which model that backend runs on. Absent leaves it to the daemon. */
  model?: string;
  moveSet: MoveSet;
  /** The turn this one continues, when refining rather than starting fresh. */
  parentJobId: string | null;
  prompt: string;
  selected: Selection | null;
  structureSet: StructureSet;
}

/**
 * The one assembly of an edit turn, shared by Send and by the prompt preview.
 *
 * `null` means there is nothing to send — the same condition that makes Send a
 * no-op, and the reason the preview can show an empty state without a round
 * trip: `CreateJobRequestSchema`'s refine would reject an empty turn, and the
 * server answers a rejected message with an error the overlay toasts.
 *
 * Deliberately free of side effects. The preview calls this on a debounce, so
 * consuming a one-shot here — the fork flag is the live example — would let
 * merely *looking* at the prompt change what eventually gets sent. `fork` is
 * therefore the caller's job, and it does not affect the prompt text anyway.
 */
export function buildEditRequest(p: EditRequestParts): CreateJobRequest | null {
  const prompt = p.prompt.trim();
  /*
   * Never ask the agent to edit something this same turn asks it to delete.
   *
   * The two sets are independent, and `removeSelection` does not touch the change
   * set — deliberately, because a delete is undoable and the declarations have to
   * come back with it. So styling a card and then pressing ⌫ produced a turn
   * carrying `visualChanges` for that card *and* `structuralChanges: [{op:
   * "delete"}]` for it, which is two contradictory instructions about one element.
   *
   * Dropped at assembly rather than at delete time for that undo reason, and
   * matched by `contains` because a delete takes its whole subtree with it.
   */
  const doomed = p.structureSet.deletedRoots();
  const deleted = doomed.length
    ? (node: Element) =>
        doomed.some((root) => root === node || root.contains(node))
    : undefined;

  const visualChanges = p.changeSet.isEmpty()
    ? undefined
    : nonEmpty(p.changeSet.targets(deleted));
  const moveChanges = p.moveSet.isEmpty() ? undefined : p.moveSet.targets();
  const structuralChanges = p.structureSet.targets();
  const textChanges = p.structureSet.textTargets(deleted);
  const attrChanges = p.attrSet.targets(deleted);
  const hasVisual = Boolean(
    visualChanges ||
      moveChanges ||
      structuralChanges.length ||
      textChanges.length ||
      attrChanges.length
  );
  const comments = p.commentSet.isEmpty() ? undefined : p.commentSet.targets();
  if (!(prompt || hasVisual || comments)) {
    return null;
  }

  // Scope to the selection if any, else the first moved element.
  const element =
    p.selected?.element ??
    moveChanges?.[0]?.element ??
    structuralChanges[0]?.element ??
    textChanges[0]?.element ??
    attrChanges[0]?.element;
  const source =
    p.selected?.source ??
    moveChanges?.[0]?.source ??
    structuralChanges[0]?.source ??
    textChanges[0]?.source ??
    attrChanges[0]?.source ??
    null;

  return {
    agent: p.agent,
    // Empty arrays are not the same as absent: both the server's schema refine
    // and `buildEditPrompt`'s branch tests key off length, so sending `[]`
    // would pick a different prompt shape than sending nothing.
    attrChanges: attrChanges.length ? attrChanges : undefined,
    comments,
    element,
    images: p.images?.length ? p.images : undefined,
    // Absent rather than empty, like the arrays above but for a different
    // reason: the daemon reads a missing model as "use the default resolved for
    // this backend", and an empty string would be a model id of "".
    model: p.model || undefined,
    moveChanges,
    // Feedback on an edit is a follow-up on *that* edit's session. Without
    // this, commenting on an older turn after starting a new chat would
    // reach an agent with no memory of the code being critiqued, which
    // would re-derive it from scratch.
    parentJobId: p.parentJobId ?? p.commentSet.parentJobId() ?? undefined,
    prompt,
    source,
    structuralChanges: structuralChanges.length ? structuralChanges : undefined,
    textChanges: textChanges.length ? textChanges : undefined,
    visualChanges,
  };
}

/**
 * `undefined` for an empty array, because the two are not interchangeable here.
 *
 * Both the server's schema refine and `buildEditPrompt`'s branch tests key off
 * length, so an `[]` left behind after `deleted` filtered everything out would
 * pick a different prompt shape than sending nothing at all.
 */
function nonEmpty<T>(list: T[]): T[] | undefined {
  return list.length ? list : undefined;
}

/** Whether a request carries direct-manipulation deltas the DOM is previewing. */
export function hasVisualDeltas(request: CreateJobRequest): boolean {
  return Boolean(
    request.visualChanges ||
      request.moveChanges ||
      request.structuralChanges ||
      request.textChanges ||
      request.attrChanges
  );
}
