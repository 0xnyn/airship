import { GitHubIcon } from "#/components/ui/github-icon";
import { TOC_EXTERNAL_LINKS, TOC_LINKS } from "#/content/nav";

/**
 * The table of contents.
 *
 * `aria-current="true"` rather than a class alone, so the active entry is
 * announced and not merely coloured. The scroll-spy that sets it lives in the
 * header, which owns the state — this component only renders.
 */
export function TocNav({
  activeId,
  onNavigate,
}: {
  activeId: string;
  onNavigate: () => void;
}) {
  return (
    <nav aria-label="On this page" className="toc" id="toc-nav">
      <div className="toc-inner">
        {TOC_LINKS.map((link) => (
          <a
            aria-current={activeId === link.id ? "true" : undefined}
            className="toc-link"
            href={`#${link.id}`}
            key={link.id}
            onClick={onNavigate}
          >
            {link.label}
          </a>
        ))}

        <div aria-hidden="true" className="toc-sep" />

        {TOC_EXTERNAL_LINKS.map((link) => (
          <a
            aria-label={link.label}
            className="toc-link"
            href={link.href}
            key={link.href}
            onClick={onNavigate}
            rel="noopener"
            target="_blank"
          >
            <GitHubIcon />
          </a>
        ))}
      </div>
    </nav>
  );
}
