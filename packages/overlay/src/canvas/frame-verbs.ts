/**
 * What can be done *to* a frame, as free functions — delete, duplicate, reload.
 *
 * These lived as private methods on `FrameChrome`, which was right while the
 * frame's own furniture and the bar group were the only doors onto them. The
 * frame list is a third, and it is the one that made the arrangement a hazard
 * rather than merely a shape: a panel calling `frames.remove` directly is one
 * line, looks correct, and silently ships a delete with **no undo** — the
 * affordance does not live in the model, it rides on the toast (see the note on
 * `deleteFrame`). Nothing about `FrameManager`'s API would have stopped that,
 * and nothing would have reported it afterwards.
 *
 * So the receipts move here with the verbs. A frame deleted from the list and a
 * frame deleted with ⌫ are now the same act with the same wording and the same
 * way back, because they are the same function — which is the arrangement
 * `AirshipApp.undoEdit` already has for ⌘Z and the bar's Undo, and for the same
 * reason.
 *
 * Free functions rather than a class: there is no state here, only a
 * `FrameManager` passed in. `toast` is imported directly for the reason its own
 * header gives — it has no per-instance state and *is* the DOM, so there is
 * nothing to invert.
 */

import { toast } from "../toast";
import {
  type Frame,
  type FrameManager,
  MAX_FRAMES,
  type RemovedFrame,
} from "./frames";

/**
 * Put a removed frame back — the Undo button's half of `deleteFrame`.
 *
 * Silent on success, because the frame reappearing where it was *is* the
 * feedback. The only way to reach the refusal is to have filled the canvas
 * since the delete, and a refusal always speaks: a toast action that has
 * already faded has no disabled state to lean on.
 */
export function restoreFrame(
  frames: FrameManager,
  removed: RemovedFrame
): void {
  if (frames.restoreRemoved(removed)) {
    return;
  }
  toast(`Frame limit reached (${MAX_FRAMES})`, { tone: "error" });
}

/**
 * Remove a frame, and offer it back.
 *
 * A deleted frame is obviously gone, so the toast is not here on the legibility
 * clause; it is here because it *carries* the undo. `History` journals element
 * ops only, and teaching it a frame op would put the model that replays DOM
 * mutations in charge of rebuilding an iframe realm — so the affordance rides
 * on the receipt instead. See the header of `toast.ts`.
 *
 * No confirmation, deliberately. A modal in front of a reversible act taxes the
 * ninety-nine deletes you meant in order to catch the one you did not; the Undo
 * catches that one and does not charge for the rest.
 */
export function deleteFrame(frames: FrameManager, frame: Frame): void {
  const { name } = frame;
  const removed = frames.remove(frame.id);
  if (!removed) {
    return;
  }
  toast(`Deleted ${name}`, {
    action: { label: "Undo", run: () => restoreFrame(frames, removed) },
  });
}

/**
 * Copy a frame, device and all.
 *
 * `duplicate` → `add` returns null at the cap and the geometry gives no hint:
 * `placeNext` puts the copy right of the *rightmost* frame, which above roughly
 * 60% zoom is off-screen, so this verb does its work entirely out of sight
 * either way. The bar's Duplicate is disabled at the cap and the `+` button has
 * `fbar-off` to say so, but a menu row has nothing — so for those doors the
 * refusal has to be spoken.
 */
export function duplicateFrame(frames: FrameManager, frame: Frame): void {
  const { name } = frame;
  if (frames.duplicate(frame.id)) {
    toast(`Duplicated ${name}`);
  } else {
    toast(`Frame limit reached (${MAX_FRAMES})`, { tone: "error" });
  }
}

/**
 * Reload the app inside a frame. A fast reload of a static route repaints
 * identically, so without the receipt there is no way to tell it happened.
 */
export function reloadFrame(frames: FrameManager, frame: Frame): void {
  frames.reload(frame);
  toast(`Reloaded ${frame.name}`);
}
