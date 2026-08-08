import { MOCK_SELECTION } from "#/content/mock-page";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

/**
 * What the picker draws over the element under the cursor.
 *
 * Both boxes are absolutely positioned on a full-mock chrome layer and share one
 * geometry, set by the measuring effect into `--pick-*`. That mirrors the real
 * overlay, where hover and selection are two boxes on the same layer rather than
 * one box that changes style — they need to be able to coexist, and they differ
 * in more than colour: hover is 1.5px over a wash, selection is 2px with no fill
 * and a white outer ring so it stays visible against a light app.
 */
export function PickerOverlay() {
  const geometry = {
    height: "var(--pick-h, 44px)",
    left: "var(--pick-x, 56px)",
    top: "var(--pick-y, 366px)",
    width: "var(--pick-w, 148px)",
  };

  return (
    <div className="ap-chrome-layer">
      <div className="ap-hover-box" style={geometry}>
        <span className="ap-box-label ap-box-label-dim">
          {MOCK_SELECTION.tag}
        </span>
      </div>

      <div className="ap-sel-box" style={geometry}>
        <span className="ap-box-label">
          {MOCK_SELECTION.tag} · {MOCK_SELECTION.size}
        </span>
        {HANDLES.map((handle) => (
          <span className={`ap-handle ap-handle-${handle}`} key={handle} />
        ))}
      </div>
    </div>
  );
}
