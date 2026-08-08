import { MOCK_DIFF } from "#/content/mock-page";

/**
 * The diff the agent produced, before you accept it.
 *
 * Collapsed to `max-height: 0` rather than unmounted, so it can grow open on the
 * timeline. The header carries the two things you check first — which file, and
 * how much changed — and only then the body.
 */
export function DiffCard() {
  return (
    <div className="ap-diff">
      <div className="ap-diff-head">
        <span className="ap-diff-file">{MOCK_DIFF.file}</span>
        <span className="ap-diff-stat">{MOCK_DIFF.stat}</span>
      </div>
      <div className="ap-diff-body">
        {MOCK_DIFF.lines.map((line, index) => (
          <div
            className={`ap-diff-line ap-diff-${line.kind} ap-diff-line-${index + 1}`}
            key={line.text}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
