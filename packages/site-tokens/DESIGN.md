---
name: Airship Site
description: >-
  The design system for Airship's home page — a warm neutral stone ramp, hairline
  rules instead of shadows, a single near-black call to action, and no accent hue
  in the page chrome at all. Hierarchy comes from size, weight and space. This
  front-matter is the canonical token source for `@airship/site-tokens` (emitted
  under the `--pk-*` namespace) and is mapped into Tailwind's theme by apps/web
  with `@theme inline`, so the utilities and this spec resolve to the same values
  by construction. It is fully independent of the visual editor's own `--ap-*`
  chrome tokens (packages/editor-tokens/EDITOR.md), which are dark-only and
  evolve separately — the hero consumes those through a scoped `editor-mock.css`
  this package emits, never through this block.
tokens:
  colors:
    white: "#ffffff"
    stone-50: "#fafaf9"
    stone-100: "#f5f5f4"
    stone-200: "#e7e5e4"
    stone-300: "#d6d3d1"
    stone-400: "#a8a29e"
    stone-500: "#78716c"
    stone-600: "#57534e"
    stone-700: "#44403c"
    stone-800: "#292524"
    stone-900: "#1c1917"
    chrome-light: "#f6f6f6"
    syntax-prop: "#0e7490"
    syntax-old: "#b91c1c"
    syntax-new: "#047857"
    syntax-keyword: "#6d28d9"
    editor-blue: "#0d99ff"
  semantic:
    text-primary: "#1c1917"
    text-secondary: "#78716c"
    text-tertiary: "#a8a29e"
    text-muted: "#57534e"
    text-faint: "#d6d3d1"
    surface-page: "#fafaf9"
    surface-panel: "#ffffff"
    surface-shell: "#ffffff"
    surface-input: "#f5f5f4"
    surface-chrome: "#f6f6f6"
    border-default: "#e7e5e4"
    border-subtle: "rgba(0,0,0,0.06)"
    border-faint: "rgba(0,0,0,0.05)"
    cta-bg: "#1c1917"
    cta-text: "#ffffff"
    cta-hover: "#292524"
    dot-inactive: "#d4d4d4"
    term-dot-inactive: "rgba(0,0,0,0.12)"
    selection-bg: "#cce1ec"
    selection-text: "#1c1917"
    syntax-prop: "#0e7490"
    syntax-old: "#b91c1c"
    syntax-new: "#047857"
    syntax-keyword: "#6d28d9"
    focus-ring: "#78716c"
    scrim: "rgba(0,0,0,0.4)"
  typography:
    families:
      sans: '"Inter", "Inter Fallback", system-ui, -apple-system, "Segoe UI", sans-serif'
      mono: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, SFMono-Regular, Menlo, monospace'
    roles:
      hero-heading:
        size: 32
        weight: 500
        line: 1.25
        tracking: -0.45
        family: sans
      section-heading:
        size: 18
        weight: 500
        line: 1.5556
        tracking: -0.045
        family: sans
      body:
        size: 14
        weight: 400
        line: 1.5714
        tracking: -0.045
        family: sans
      small:
        size: 13
        weight: 400
        line: 1.6923
        tracking: -0.045
        family: sans
      toc:
        size: 12
        weight: 400
        line: 1.3333
        tracking: -0.045
        family: sans
      mono-code:
        size: 13
        weight: 400
        line: 1.8
        tracking: 0
        family: mono
      mono-output:
        size: 12.5
        weight: 400
        line: 1.8
        tracking: 0
        family: mono
      mono-install:
        size: 11
        weight: 400
        line: 1.6364
        tracking: 0
        family: mono
  spacing:
    hair: 1
    xxs: 4
    xs: 8
    sm: 12
    base: 16
    md: 20
    lg: 24
    xl: 32
    xxl: 48
    section: 64
    section-lg: 72
  rounded:
    "none": 0
    xs: 4
    sm: 5
    md: 6
    lg: 8
    xl: 12
    pill: 61
    full: 9999
  elevation:
    flat: "none"
    hairline: "0 0 0 1px var(--pk-color-border-faint)"
    card: "0 0 0 1px var(--pk-color-border-subtle)"
    window: "0 0 0 0.5px rgba(0,0,0,0.15), 0 6px 20px 4px rgba(0,0,0,0.15)"
    floating: "0 8px 32px rgba(0,0,0,0.18)"
  motion:
    duration-instant: "100ms"
    duration-fast: "150ms"
    duration-normal: "300ms"
    duration-slow: "800ms"
    ease-chrome: "cubic-bezier(0.215, 0.61, 0.355, 1)"
    ease-panel: "cubic-bezier(0.23, 1, 0.32, 1)"
    ease-reveal: "cubic-bezier(0.165, 0.84, 0.44, 1)"
    ease-overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  layout:
    nav: 1120
    column: 640
    hero: 800
    band-window: 1040
    breakpoint-desktop: 848
    breakpoint-mobile: 768
    breakpoint-tight: 640
---

# Airship Site Design Tokens

The design system for `apps/web`. `@airship/site-tokens` generates its TypeScript
token objects and its CSS custom properties (`--pk-*`) directly from the
front-matter above, so this file and the code cannot drift. The app maps those
variables into Tailwind's theme with `@theme inline`, which means a Tailwind
utility and this spec resolve to the same value by construction.

This system belongs to the **page**, not to the editor. It is independent of
`packages/editor-tokens/EDITOR.md` (`--ap-*`), which is dark-only chrome for the
visual editor and evolves on its own schedule. The hero does render a miniature
of that editor — but it reaches those variables through `editor-mock.css`, a
block this package's postbuild emits scoped to `.ap-mock`, never through the
tokens here. Two namespaces, two owners, one build pipeline.

## Character

- **The palette is `stone`, not `gray`.** Every neutral carries a trace of warmth
  (`{colors.stone-500}` is `#78716c`, not `#737373`). On a page that is almost
  entirely neutral, that warmth is the difference between restraint and
  coldness, and it is the reason the near-black CTA reads as ink rather than as
  a UI chip. Swapping in a true gray ramp changes the character of every surface
  at once, which is exactly why it is a token and not a literal.

- **There is no accent hue in the page chrome.** `{semantic.cta-bg}` is
  `{colors.stone-900}` — near-black on near-white. Contrast, not hue, is what
  makes a thing look clickable, and there is plenty of it. With no accent to
  spend, hierarchy has to come from size, weight and space.

  Four chromatic values do exist, and all four are **semantic, not decorative**:
  `{colors.syntax-old}` and `{colors.syntax-new}` are the two sides of a diff,
  `{colors.syntax-prop}` is a CSS property name, `{colors.syntax-keyword}` is a
  language keyword. They appear only inside the mono blocks that show what the
  agent reads and writes. A fifth, `{colors.editor-blue}`, is the editor's
  selection blue — it appears **only** inside `.ap-mock`, where it is quoting
  the product rather than styling the page.

- **Hairline rules, never shadows.** `{elevation.hairline}` and
  `{elevation.card}` are `0 0 0 1px` rings. Sections separate with a
  `border-bottom`, not a drop shadow; cards have no fill and no border box, only
  a rule underneath. The one real shadow in the system is
  `{elevation.window}` — and it exists to make the hero's Safari window read as
  a *window*, which is a different job from making a card read as a card.

- **The shell is the page; the page surface is what the page quotes.**
  `{semantic.surface-shell}` (`#ffffff`) sits under `html`, `.layout` and the
  sticky header — the whole chrome is one white, so the bar can scroll over the
  content it covers without ever showing a seam. `{semantic.surface-page}`
  (`#fafaf9`) is one step off it and is reserved for surfaces the page is
  *showing* rather than *being*: the browser content area in the hero, the
  miniature app inside it, the fill behind a figure. That single step of warmth
  is the whole difference between a screenshot and the page around it.

- **Every text pair clears WCAG AA (4.5:1).** That is a constraint on the
  palette, not an afterthought, and it is why the syntax accents are the `700`
  tier rather than the `600` tier the rest of this family suggests:
  `emerald-600` measures 3.8:1 on white and `cyan-600` 3.7:1, so a diff's `+`
  and `-` lines — the two colours on this page that actually carry meaning —
  would have been the least legible text in the system.

  `{semantic.text-tertiary}` is the one value that does NOT clear it (2.5:1),
  and it is therefore reserved for the hero illustration, which is `aria-hidden`
  and decorative. No prose and no icon uses it. If you reach for it in the page
  chrome, reach for `{semantic.text-secondary}` instead.

- **Everything is 14px.** `{typography.roles.body}` is the size of nearly all
  prose on the page; `{typography.roles.section-heading}` is 18px and
  `{typography.roles.hero-heading}` is 32px, and that is the entire scale. Three
  sizes, two weights (400 and 500), and no bold anywhere. The restraint is the
  design.

- **`body { letter-spacing: -0.045px }` is global.** Every sans role therefore
  carries `tracking: -0.045` explicitly, so applying a `.pk-*` class never
  silently resets it back to zero. The one exception is
  `{typography.roles.hero-heading}` at `-0.45px`, ten times tighter, because
  32px type needs it and 14px type does not. Mono roles set `0`.

## Type scale

`line` is a unitless ratio, which is what `line-height` wants. The pixel values
the ratios were derived from, since those are what the ported CSS was measured
in:

| role | px | ratio |
| --- | --- | --- |
| `hero-heading` | 32 / 40 | 1.25 |
| `section-heading` | 18 / 28 | 1.5556 |
| `body` | 14 / 22 | 1.5714 |
| `small` | 13 / 22 | 1.6923 |
| `toc` | 12 / 16 | 1.3333 |
| `mono-install` | 11 / 18 | 1.6364 |
| `mono-code` | 13 / 23.4 | 1.8 |
| `mono-output` | 12.5 / 22.5 | 1.8 |

## Radius

`{rounded.pill}` is `61px`, not `9999px`, and the oddness is deliberate: it is
the value the hero's primary CTA was measured at, and at a 40px-tall button `61`
and `9999` are visually identical while `61` survives being scrubbed in the
inspector as a number. `{rounded.full}` is the real `9999` for anything that
must stay a capsule at any height.

The rest is a tight ladder — `{rounded.xs}` 4px on small controls, `{rounded.sm}`
5px, `{rounded.md}` 6px on inputs, `{rounded.lg}` 8px on the browser window and
code-block chrome, `{rounded.xl}` 12px on the output and install cards. Nothing
in the system is rounder than 12px except a pill.

## Motion

Four easings, each with a job:

- `{motion.ease-chrome}` — anything that behaves like UI chrome moving into
  place. The default.
- `{motion.ease-panel}` — panels and docks sliding in. Slower out, longer tail.
- `{motion.ease-reveal}` — disclosure: the FAQ accordion, the TOC indicator, the
  collapsed nav opening.
- `{motion.ease-overshoot}` — reserved for the hero's payoff beat, where a value
  the agent changed lands with a slight overshoot. It is the only easing in the
  system that goes past its target, and using it anywhere else would make that
  moment ordinary.

Every one of them is honoured only when `prefers-reduced-motion` is not
`reduce`.

## Layout

Three widths, deliberately not one. `{layout.nav}` 1120px is both the sticky bar
and every section under it, so a section heading starts on the same x as the
wordmark. `{layout.column}` 640px is the reading measure — a cap on the prose
*inside* a section, not on the section itself. `{layout.hero}` 800px is the
hero's own cap.

That split is recent and worth the sentence. Sections used to be 640px, which
fused "how wide is this box" with "how long is a line of text" into one number.
It held until the first two-up card grid, where 640px meant ~310px per card —
too narrow for a card to carry an illustration. Widening the sections and
capping the prose separately lets a section hold things that want the room (a
card grid, a terminal block, a row of code) without making its paragraphs
unreadable.

The page's one full-bleed element is the wallpaper band under the hero, which is
uncapped: it spans the viewport at every width. What it carries is capped, at
`{layout.band-window}` 1040px, and that number sets the band's proportion — the
window's height follows from its width via the mock's 1200×636 ratio, and the
band's height follows from the window. 1040 is also 1040/1200 of `.ap-mock`'s
authored width, which lands `--ap-mock-scale` near 0.87 and renders the mock at
very nearly the size it was drawn at.

Breakpoints: `{layout.breakpoint-desktop}` 848px is where the hero's animated
cursor is dropped, because past it the controls it points at are too small to
follow; `{layout.breakpoint-mobile}` 768px is where the nav folds behind a
hamburger, and where the desktop-only CTA row gives way to the "this is a
desktop tool" callout; `{layout.breakpoint-tight}` 640px tightens everything.

There is no `breakpoint-nav`. The bar used to be a 220px fixed rail that turned
into a sticky top bar at 1240px, and both the rail and that breakpoint are gone —
it is a top bar at every width now, and the only thing that changes is whether
its links are inline or collapsed.
