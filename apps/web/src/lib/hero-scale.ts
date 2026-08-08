/*
 * The hero mock's scale, resolved before first paint.
 *
 * `.ap-mock` is authored at a fixed 1200px and shrunk with `transform: scale()`
 * to whatever width the browser window in the hero actually got. Only the
 * measuring effect in hero-stage.tsx knows that width exactly — but it cannot
 * run until React has hydrated, and the server-rendered HTML paints long before
 * that. Whatever the CSS fallback says is therefore what a visitor sees first.
 *
 * A single fallback was fine when the stage was a fixed 800px card: one number
 * was correct at every viewport. Once the band went full-bleed the window's
 * width became a function of the viewport, no constant is right below the cap,
 * and first paint was out by up to 66% — a visible snap on load.
 *
 * So: a tiny inlined script that runs before the first paint, computing the
 * scale from the only input it needs (viewport width) and letting the real
 * measurement refine it after hydration. The numbers below are
 * transcribed from hero-desktop.css and hero-overlay.css; if the geometry there
 * changes, it changes here.
 */

/** Author-space width of `.ap-mock` — see hero-overlay.css. */
export const MOCK_WIDTH = 1200;

/** `.browser-window`'s `max-width` — see hero-desktop.css. */
export const WINDOW_MAX_WIDTH = 1040;

/**
 * `.desktop-bg`'s horizontal padding at each breakpoint, widest first — see the
 * band rules in hero-desktop.css. The window is the band's width minus twice
 * this, capped at WINDOW_MAX_WIDTH.
 */
export const BAND_PADDING_X = [
  { padding: 12, upTo: 640 },
  { padding: 16, upTo: 847 },
  { padding: 48, upTo: Number.POSITIVE_INFINITY },
] as const;

/** The scale the mock should render at, for a given viewport content width. */
export function heroScaleFor(viewportWidth: number): number {
  const step =
    BAND_PADDING_X.find((s) => viewportWidth <= s.upTo) ?? BAND_PADDING_X[2];
  const content = Math.min(WINDOW_MAX_WIDTH, viewportWidth - step.padding * 2);
  return Math.max(0, content) / MOCK_WIDTH;
}

/**
 * Runs before first paint, inlined into the document head — see __root.tsx.
 *
 * Written onto <html> rather than onto `.hero-visual`, because at the time this
 * runs the document is still being parsed and the hero does not exist yet.
 * Custom properties inherit, so the value reaches `.ap-mock` all the same, and
 * the inline style `measureHero` later writes onto `.hero-visual` overrides it
 * — the seed is the opening bid, the measurement is the final answer.
 *
 * `clientWidth`, not `innerWidth`: it excludes the scrollbar, which is what the
 * band's own `width: 100%` will resolve against. Stringified verbatim into a
 * <script>, so it must be self-contained — no imports, no closure over module
 * scope — and the try/catch keeps a failure here from blocking the parser.
 */
export const HERO_SCALE_SEED_SCRIPT = `(function(){try{var w=document.documentElement.clientWidth;var p=w<=${BAND_PADDING_X[0].upTo}?${BAND_PADDING_X[0].padding}:w<=${BAND_PADDING_X[1].upTo}?${BAND_PADDING_X[1].padding}:${BAND_PADDING_X[2].padding};var c=Math.min(${WINDOW_MAX_WIDTH},w-p*2);if(c>0){document.documentElement.style.setProperty("--ap-mock-scale",String(c/${MOCK_WIDTH}))}}catch(e){}})()`;
