/**
 * The first thing in the tab order.
 *
 * Parked off-screen with `top: -100%` rather than `display: none`, because a
 * hidden element is not focusable and a skip link that cannot be focused is
 * worse than no skip link at all — it looks like the page has the affordance.
 */
export function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      Skip to content
    </a>
  );
}
