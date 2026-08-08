import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { SITE } from "#/content/site";
import { SOFTWARE_JSON_LD } from "#/content/structured-data";
import { HERO_SCALE_SEED_SCRIPT } from "#/lib/hero-scale";
import appCss from "#/styles/app.css?url";

/*
 * The document shell.
 *
 * There is no index.html — TanStack Start owns the document, which is why the
 * <head> is described here as data rather than written as markup.
 */

export const Route = createRootRoute({
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: `${SITE.name} — ${SITE.tagline}` },
      { content: SITE.description, name: "description" },

      /*
       * Absolute URLs, because a crawler resolving an Open Graph image against
       * the wrong base is the classic way to ship a card with no picture.
       */
      { content: `${SITE.name} — ${SITE.tagline}`, property: "og:title" },
      { content: SITE.description, property: "og:description" },
      { content: `${SITE.origin}/og.png`, property: "og:image" },

      /*
       * Declared because the card is a fixed 1200×630 (scripts/og.mjs). A
       * crawler that has to fetch the image before it can lay the card out
       * often just renders a link instead; these let it reserve the box first.
       */
      { content: "1200", property: "og:image:width" },
      { content: "630", property: "og:image:height" },
      { content: `${SITE.name} — ${SITE.tagline}`, property: "og:image:alt" },
      { content: SITE.origin, property: "og:url" },
      { content: "website", property: "og:type" },
      { content: "summary_large_image", name: "twitter:card" },

      /*
       * The page is light, full stop — there is no second palette to switch to,
       * so both of these are unconditional.
       *
       * `theme-color` names the shell surface rather than the page surface: the
       * shell is what meets the top of the viewport, so it is what the browser
       * chrome should continue. `color-scheme` is the half that speaks for the
       * parts of the window the stylesheet does not own — scrollbars, form
       * controls, the canvas painted before the first byte of CSS lands. Without
       * it a visitor on a dark OS gets dark UA chrome framing a light page.
       */
      { content: "#ffffff", name: "theme-color" },
      { content: "light", name: "color-scheme" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/*
          Sizes the hero mock before first paint. Render-blocking on purpose:
          the server cannot know the viewport, the measurement cannot run until
          hydration, and the frame in between is one a visitor sees. Without it
          the mock paints at a constant scale and then snaps to the measured one.

          `suppressHydrationWarning` on <html> above is the matching half — this
          writes `--ap-mock-scale` onto the element the server rendered, so its
          style attribute is expected to differ from the server's markup.

          A <script> body cannot be expressed as a React child, and the content
          is a module-level constant with no interpolated input — hence the
          suppression below.
        */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: see above.
          dangerouslySetInnerHTML={{ __html: HERO_SCALE_SEED_SCRIPT }}
        />
        {/*
          Structured data. Same constraint as the script above — a <script>
          body cannot be a React child — and the content is JSON serialised from
          a module-level constant, so there is no injection surface.
        */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: see above.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
          type="application/ld+json"
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
