import { EditorGlyph } from "#/components/hero/airship-mock/editor-glyph";

/**
 * The floating bottom bar.
 *
 * Compact and understated on purpose: a small radius, a hairline border and a
 * ring rather than a pill with a drop shadow. It is the one piece of chrome that
 * is always on screen, and the version of it that announces itself gets tiring
 * within a minute.
 *
 * Left to right: undo/redo, the tool group, inspect, the Edit|View toggle, and
 * the pending-tweak counter — which is the only thing on the bar that moves.
 */
export function BottomBar() {
  return (
    <div className="ap-bar">
      <span className="ap-tool-group">
        <span className="ap-tool">
          <EditorGlyph name="undo" size={20} />
        </span>
      </span>

      <span className="ap-bar-sep" />

      <span className="ap-tool-group">
        <span className="ap-tool ap-tool-on">
          <EditorGlyph name="cursor" size={20} />
        </span>
        <span className="ap-tool">
          <EditorGlyph name="hand" size={20} />
        </span>
        <span className="ap-tool">
          <EditorGlyph name="text" size={20} />
        </span>
      </span>

      <span className="ap-bar-sep" />

      <span className="ap-tool-group">
        <span className="ap-tool">
          <EditorGlyph name="inspect" size={20} />
        </span>
      </span>

      <span className="ap-bar-sep" />

      <span className="ap-seg-group">
        <span className="ap-seg ap-seg-on">
          <EditorGlyph name="edit" size={14} />
          Edit
        </span>
        <span className="ap-seg">
          <EditorGlyph name="view" size={14} />
          View
        </span>
      </span>

      {/*
        Collapsed to zero width until the first tweak lands, so the bar has no
        empty slot waiting to be filled — it simply grows.
      */}
      <span className="ap-tweak-badge-wrap">
        <span className="ap-tweak-badge">
          <span className="ap-tweak-count-1">1</span>
          <span className="ap-tweak-count-2">2</span>
        </span>
      </span>
    </div>
  );
}
