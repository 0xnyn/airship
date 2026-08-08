/**
 * The proxy card's illustration: airship on one port, your app on the one you
 * already had, and two real device frames inside it.
 *
 * It draws both halves of the claim in one picture. The chrome carries the
 * proxy — `localhost:3001` is airship, and the pill beside it names the port it
 * is standing in front of. The canvas carries the viewports: two frames at
 * visibly different widths, each labelled with the number the app inside it
 * would actually report.
 *
 * The widths are not decorative. 393 is the iPhone 15 logical width and 1280 a
 * common desktop breakpoint, which is why the small frame's skeleton stacks and
 * the wide one's sits in a row — the same layout responding to its own frame is
 * the entire point of the sentence underneath.
 *
 * Decorative as a whole, so `aria-hidden` on the root: everything it depicts is
 * stated in the card's own prose.
 */
export function ProxyFigure() {
  return (
    <div aria-hidden="true" className="fig fig-proxy">
      <div className="fig-window">
        <div className="fig-chrome">
          <span className="fig-dots">
            <i className="fig-dot fig-dot-red" />
            <i className="fig-dot fig-dot-yellow" />
            <i className="fig-dot fig-dot-green" />
          </span>
          <span className="fig-url">localhost:3001</span>
          <span className="fig-proxy-pill">proxying :3000</span>
        </div>

        <div className="fig-canvas">
          {/* Enough rows to reach the fade. The frames run past the bottom of
              the window (see `.fig-window`'s mask in cards.css), so a skeleton
              that stopped after three bars would leave the rest of the phone as
              blank paper — the stack has to still be going when it dissolves. */}
          <div className="fig-frame fig-frame-sm">
            <span className="fig-frame-w">393</span>
            <div className="fig-frame-body">
              <span className="fig-bar fig-bar-full" />
              <span className="fig-bar fig-bar-full" />
              <span className="fig-bar fig-bar-half" />
              <span className="fig-bar fig-bar-block" />
              <span className="fig-bar fig-bar-full" />
              <span className="fig-bar fig-bar-half" />
            </div>
          </div>

          <div className="fig-frame fig-frame-lg">
            <span className="fig-frame-w">1280</span>
            <div className="fig-frame-body fig-frame-body-row">
              <span className="fig-bar fig-bar-col" />
              <span className="fig-bar fig-bar-col" />
              <span className="fig-bar fig-bar-col" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
