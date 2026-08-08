import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";
import { MOCK_PROMPT, MOCK_SELECTION } from "#/content/mock-page";

/**
 * Where you say what you want.
 *
 * One bordered box holding the selection chip, the prompt and the send button —
 * which is the shape of airship's real composer, and the shape of the claim: the
 * chip says *what*, the sentence says *what about it*, and that is the entire
 * interface.
 *
 * The prompt is real text clipped from the right by the timeline rather than a
 * string assembled by a timer. That keeps the typing honest under the pause
 * button and under `prefers-reduced-motion`, and means it costs nothing when the
 * hero is scrolled out of view.
 */
export function ComposerField() {
  return (
    <div className="ap-composer">
      <div className="ap-field">
        <div className="ap-chips">
          <span className="ap-sel-chip">
            {MOCK_SELECTION.tag}
            <span className="ap-chip-x">&#215;</span>
          </span>
        </div>

        <div className="ap-input">
          <span className="ap-placeholder">Describe the change…</span>
          <span className="ap-typed">{MOCK_PROMPT}</span>
          <span className="ap-caret" />
        </div>

        <span className="ap-send">
          <EditorGlyph name="chevronUp" size={16} />
        </span>
      </div>
    </div>
  );
}
