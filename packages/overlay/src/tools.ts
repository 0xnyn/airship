/*
 * The toolbar's tools.
 *
 * Airship manipulates an existing DOM, so most of a design tool's toolbar has no
 * meaning here: there is no geometry to draw, so Pen, Shape, Star, Polygon and
 * Slice are absent rather than present-and-greyed-out. A disabled pen tool is a
 * worse answer than no pen tool — it promises something the editor will never
 * do.
 *
 * What survives are the tools that are really about *what a click does*:
 *
 * | Tool    | Key | Meaning here                                            |
 * |---------|-----|---------------------------------------------------------|
 * | Move    | V   | hover-select, drag, resize — the default                |
 * | Inspect | I   | hover reads out specs instead of selecting               |
 *
 * Three used to be here and are not:
 *
 * - **Hand (H)** exists again, but not as a member of this group — it is a
 *   latch on `AirshipApp`, wired to `CanvasViewport.setHandTool`. It was first
 *   removed from here because nothing read `tools.active === "hand"`: selecting
 *   it lit the button and changed nothing, the same broken promise a disabled
 *   pen tool would have made. It did not come back here because it belongs to
 *   the other mode. These three are what a click means *while editing*; the Hand
 *   is what a drag means while the page is **live**, which is precisely when the
 *   space-drag modifier stops working — the frames are real iframes in view
 *   mode, and once the pointer takes focus into one, a keydown reaches the shell
 *   only for the handful of commands the catalog marks `inFrame`. Space-to-pan
 *   is not one: it is a raw listener rather than a binding, and routing it would
 *   mean swallowing a bare Space typed into somebody's own form.
 *   Joining this group would have meant inventing a "no tool" member for
 *   a radio that has never needed one. It also stops at the frame boundary: a
 *   press the iframe consumes never reaches the canvas, so the Hand moves the
 *   surface without ever reaching into the app on it.
 * - **Frame (F)** was not a tool. It opened the canvas's add-frame menu and
 *   immediately reset, so it was a button wearing a tool's clothes — and a
 *   second one, since the canvas already has a `+` for exactly that. `F` is now
 *   bound directly to that button (see `bindEditorKeys`), which is what it
 *   always meant.
 * - **Text (T)** had the identical shape and went the same way: `onToolChange`
 *   began the edit and called `reset()` on the next line, so its button could
 *   never stay lit and the radio carried a member that was not a mode. It is a
 *   *state of Move* now — a double-click enters it, a click away leaves it, and
 *   the pointer means "select" throughout. `T` survives as a plain command bound
 *   alongside `Enter` in `bindEditorKeys`, which is all it ever was.
 *
 * Note the seam with Edit/View: that is a *mode* — is the host page interactive
 * at all — while these are what a click means once you are editing. They are
 * orthogonal, which is why the bar keeps both. The tools are, however, edit-mode
 * furniture: `enabled` gates their shortcuts so pressing V or I over a live app
 * in view mode does nothing, matching a bar that no longer shows them.
 */
import type { CommandId } from "./keys/catalog";
import { keys } from "./keys/registry";

export type Tool = "inspect" | "move";

export interface ToolBinding {
  /** The command this tool is. Its chord and its name come from the catalog. */
  id: CommandId;
  tool: Tool;
}

export const TOOLS: ToolBinding[] = [
  { id: "tool.move", tool: "move" },
  { id: "tool.inspect", tool: "inspect" },
];

type Listener = (tool: Tool) => void;

export class ToolController {
  private tool: Tool = "move";
  private readonly listeners = new Set<Listener>();
  private readonly unbind: (() => void)[] = [];

  /**
   * `enabled` is consulted per keypress rather than latched, so the controller
   * never has to be told about mode changes — it asks. Passed as a lazy closure
   * from `AirshipApp`, whose `editing` flag it reads.
   */
  private readonly enabled: () => boolean;

  constructor(enabled: () => boolean = () => true) {
    this.enabled = enabled;
    this.unbind.push(
      keys.bindAll(
        TOOLS.map((t) => ({
          id: t.id,
          run: () => this.set(t.tool),
          when: () => this.enabled(),
        }))
      )
    );
  }

  get active(): Tool {
    return this.tool;
  }

  set(tool: Tool): void {
    if (tool === this.tool) {
      return;
    }
    this.tool = tool;
    for (const listener of this.listeners) {
      listener(tool);
    }
  }

  /**
   * Back to the default. Nothing is momentary any more — this exists for
   * `setEditing(false)`, which has to disarm the latched Inspect before its
   * button disappears.
   */
  reset(): void {
    this.set("move");
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    for (const off of this.unbind) {
      off();
    }
    this.unbind.length = 0;
    this.listeners.clear();
  }
}
