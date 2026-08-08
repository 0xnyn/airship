import { MOCK_DIFF, MOCK_SELECTION } from "#/content/mock-page";

/**
 * The source card's illustration: the chain from a click to a diff.
 *
 * Three beats, top to bottom, because that is the order the tool actually runs
 * in — you pick an element, it resolves to a file and a line, the agent edits
 * source. The middle chip is the one that carries the claim: without it this
 * would just be another "AI writes code" picture.
 *
 * Every string is read from content/mock-page.ts rather than written here, so
 * this figure and the hero animation cannot drift into quoting different files.
 * It is the same selection and the same diff the demo above performs — the two
 * are meant to be recognisably one story, not two examples of one.
 *
 * Note the file changes between beat two and beat three, and that is correct
 * rather than a mistake: the element lives in `hero-section.tsx`, but the class
 * it renders with is defined in `shell.css`, so that is what the agent edits. It
 * is a small argument for the whole feature — resolving to source means landing
 * on the line that decides the value, not the line that mentions it.
 */
export function SourceFigure() {
  return (
    <div aria-hidden="true" className="fig fig-source">
      <div className="fig-pick">
        <span className="fig-pick-badge">{MOCK_SELECTION.tag}</span>
        <span className="fig-pick-el">Get started</span>
        <i className="fig-handle fig-handle-tl" />
        <i className="fig-handle fig-handle-tr" />
        <i className="fig-handle fig-handle-bl" />
        <i className="fig-handle fig-handle-br" />
      </div>

      <div className="fig-resolve">
        <span className="fig-thread" />
        <span className="fig-chip">
          {MOCK_SELECTION.sourceFile}
          <span className="fig-chip-line">:{MOCK_SELECTION.sourceLine}</span>
        </span>
      </div>

      <div className="fig-diff">
        <div className="fig-diff-head">
          <span className="fig-diff-file">{MOCK_DIFF.file}</span>
          <span className="fig-diff-stat">{MOCK_DIFF.stat}</span>
        </div>
        <div className="fig-diff-body">
          {MOCK_DIFF.lines
            .filter((line) => line.kind !== "ctx")
            .map((line) => (
              <div
                className={`fig-diff-line fig-diff-${line.kind}`}
                key={line.text}
              >
                {line.text.trim()}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
