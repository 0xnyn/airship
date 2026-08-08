import { useCallback, useState } from "react";
import { LogoWordmark } from "#/components/shell/logo-wordmark";
import { TocNav } from "#/components/shell/toc-nav";
import { SECTION_IDS } from "#/content/nav";
import { cn } from "#/lib/cn";
import { useScrollSpy } from "#/lib/use-scroll-spy";

/**
 * The sticky top bar: wordmark left, navigation and controls right.
 *
 * Both layouts — the inline bar and the collapsed mobile menu — are the same
 * DOM, so the tab order and the scroll-spy do not have to know which one is on
 * screen. Only CSS moves things, and below the mobile breakpoint `.toc` wraps
 * onto its own row and collapses to zero height.
 *
 * One placement here is deliberate and is not just markup order: the hamburger
 * comes after the nav in the DOM so it lands at the right edge of the bar. It is
 * always rendered and `display: none` above the breakpoint, which is what
 * correctly takes it out of the tab order at a width where it does nothing.
 */
export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeId = useScrollSpy(SECTION_IDS);

  const toggleMenu = useCallback(() => setMenuOpen((open) => !open), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header className={cn("site-header", menuOpen && "menu-open")}>
      <div className="header-inner">
        <LogoWordmark />

        {/* Closing on navigate matters only in the collapsed layout, where the
            menu overlays the content it just scrolled to. Harmless inline. */}
        <TocNav activeId={activeId} onNavigate={closeMenu} />

        <div className="header-actions">
          <button
            aria-controls="toc-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="hamburger"
            onClick={toggleMenu}
            type="button"
          >
            <span aria-hidden="true" className="hamburger-line" />
            <span aria-hidden="true" className="hamburger-line" />
          </button>
        </div>
      </div>
    </header>
  );
}
