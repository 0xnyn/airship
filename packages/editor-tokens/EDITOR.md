---
name: Airship Editor
description: >-
  Airship's visual-editor token system — a dark editor palette:
  dense neutral surfaces, hairline borders, a single Blue #0D99FF selection
  voltage, and a restrained 3–5% luminance surface progression. This front-matter
  is the canonical token source for the editor chrome (`@airship/editor-tokens`,
  emitted under the `--ap-*` namespace). It is fully independent of the `--pk-*`
  marketing tokens in home/packages/tokens and their re-skinned sibling in
  examples/vite-react, and evolves separately.
  No shadows on panels — separate surfaces with borders instead.
tokens:
  surface:
    canvas: "#1E1E1E"
    base: "#242424"
    sidebar: "#2B2B2B"
    panel: "#313131"
    hover: "#383838"
    active: "#3F3F3F"
    selected: "#454545"
    overlay: "#202020F2"
  border:
    subtle: "rgba(255,255,255,0.06)"
    default: "rgba(255,255,255,0.08)"
    strong: "rgba(255,255,255,0.12)"
    focus: "#0D99FF"
    disabled: "rgba(255,255,255,0.04)"
  text:
    primary: "#FFFFFF"
    secondary: "#C6C6C6"
    tertiary: "#9D9D9D"
    disabled: "#777777"
    placeholder: "#6A6A6A"
    inverse: "#111111"
  icon:
    primary: "#F3F3F3"
    secondary: "#BEBEBE"
    muted: "#8A8A8A"
    disabled: "#666666"
  blue:
    "50": "#EAF6FF"
    "100": "#CDEBFF"
    "200": "#A8DBFF"
    "300": "#75C7FF"
    "400": "#33AEFF"
    "500": "#0D99FF"
    "600": "#007BE5"
    "700": "#0064BC"
    "800": "#004D91"
    "900": "#00355F"
  primary:
    primary: "#0D99FF"
    hover: "#33AEFF"
    active: "#007BE5"
    disabled: "#4A82A6"
    bg: "rgba(13,153,255,0.10)"
    bg-hover: "rgba(13,153,255,0.15)"
    border: "rgba(13,153,255,0.50)"
  semantic:
    success: "#2ECC71"
    success-hover: "#27AE60"
    success-active: "#1E874B"
    success-bg: "rgba(46,204,113,0.12)"
    warning: "#F5C84C"
    warning-hover: "#D9A822"
    warning-active: "#B48600"
    warning-bg: "rgba(245,200,76,0.12)"
    error: "#FF4D4F"
    error-hover: "#E53935"
    error-active: "#C62828"
    error-bg: "rgba(255,77,79,0.12)"
  selection:
    fill: "rgba(13,153,255,0.20)"
    border: "#0D99FF"
    handle: "#FFFFFF"
    guide: "#0D99FF"
  timeline:
    track: "#242424"
    marker: "#666666"
    active-marker: "#FFFFFF"
    highlight: "#0D99FF"
  scrollbar:
    track: "transparent"
    thumb: "rgba(255,255,255,0.12)"
    thumb-hover: "rgba(255,255,255,0.20)"
    thumb-active: "rgba(255,255,255,0.30)"
  divider:
    horizontal: "rgba(255,255,255,0.06)"
    vertical: "rgba(255,255,255,0.08)"
    heavy: "rgba(255,255,255,0.12)"
  shadow:
    xs: "0 1px 2px rgba(0,0,0,0.16)"
    sm: "0 2px 8px rgba(0,0,0,0.20)"
    floating: "0 8px 32px rgba(0,0,0,0.35)"
  opacity:
    "04": "0.04"
    "06": "0.06"
    "08": "0.08"
    "10": "0.10"
    "12": "0.12"
    "16": "0.16"
    "24": "0.24"
    "32": "0.32"
    "48": "0.48"
    "64": "0.64"
  gray:
    "50": "#FAFAFA"
    "100": "#F5F5F5"
    "200": "#EBEBEB"
    "300": "#DCDCDC"
    "400": "#BEBEBE"
    "500": "#9D9D9D"
    "600": "#777777"
    "700": "#5A5A5A"
    "800": "#3F3F3F"
    "900": "#2B2B2B"
    "950": "#1E1E1E"
  input:
    bg: "#2B2B2B"
    hover: "#313131"
    focus: "#313131"
    border: "rgba(255,255,255,0.08)"
    focus-border: "#0D99FF"
    disabled: "#252525"
  button:
    primary: "#0D99FF"
    primary-hover: "#33AEFF"
    primary-pressed: "#007BE5"
    primary-disabled: "#3E5D73"
    secondary: "#313131"
    secondary-hover: "#383838"
    secondary-pressed: "#404040"
    secondary-disabled: "#292929"
    ghost-hover: "rgba(255,255,255,0.05)"
    ghost-pressed: "rgba(255,255,255,0.08)"
  typography:
    families:
      sans: '"Inter", "Inter Fallback", system-ui, "Helvetica Neue", Helvetica, Arial, sans-serif'
      mono: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, SFMono-Regular, Menlo, monospace'
  fontSize:
    micro: 9
    caption: 10
    body: 11
    label: 12
    title: 13
    heading: 14
  iconSize:
    xs: 16
    sm: 20
    md: 24
    lg: 28
  control:
    height: 24
    icon-box: 28
    gutter: 8
    field-gap: 2
    row-gap: 6
    group-gap: 12
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
    section: 80
  rounded:
    none: 0
    xs: 4
    sm: 6
    md: 8
    lg: 12
    xl: 16
    pill: 9999
    full: 9999
  elevation:
    flat: "none"
    card: "0 0 0 1px var(--ap-border-default)"
    floating: "0 2px 8px rgba(0,0,0,0.20)"
    modal: "0 8px 32px rgba(0,0,0,0.35)"
  boxModel:
    padding: "#0D99FF"
    margin: "#F5C84C"
    gap: "#FF4D9D"
  motion:
    ease: "ease"
    ease-out: "cubic-bezier(0.23, 1, 0.32, 1)"
    ease-in-out: "cubic-bezier(0.77, 0, 0.175, 1)"
    dur-micro: "100ms"
    dur-base: "150ms"
    dur-slow: "200ms"
---

# Airship Editor Tokens

The visual editor's design system — a **dark editor palette**. The
`@airship/editor-tokens` package generates its TypeScript token objects and CSS
custom properties (`--ap-*`) directly from this front-matter, so this file and
the code never drift. This system is **independent** of the `--pk-*` marketing
tokens in `home/packages/tokens`; the two evolve separately.

There are in fact *two* `--pk-*` sets in this repo — `home/packages/tokens` and
`examples/vite-react/packages/tokens`, which run an identical pipeline against
different specs. They never collide with each other or with this one: each lives
in its own pnpm workspace serving its own app, and pnpm scopes package names per
workspace.

## Character

- Neutral grays, not warm — surfaces step `#1E1E1E → #454545` in ~3–5% luminance
  increments (`{surface.canvas}` → `{surface.selected}`). This progression is the
  core of the editor's feel: calm, dense, cohesive.
- **Hairline borders**, no heavy shadows. Panels separate with `{border.*}`
  hairlines; shadows are reserved for the floated chrome (`{shadow.*}`).
- A single accent: **Blue** `{primary.primary}` `#0D99FF`. It carries selection,
  focus, links, and the primary action — used scarcely.
- **`{semantic.*}` is for state, and state only** — success, warning, error.
  There used to be a purple and an orange family here too, and having them is
  what made them get used: purple ended up on a `@media` condition and on the
  word "Thinking", neither of which is a state. Hue in a grey editor is a claim
  that something needs attention, so a colour with no state behind it spends
  that attention on nothing. Anything that is merely *a different kind of thing*
  is said with weight, italics or the `{text.*}` ramp instead.
- Dedicated `{text.*}`, `{icon.*}`, `{border.*}`, `{blue.*}` and `{gray.*}"
  scales keep surfaces, typography and icons decoupled from each other.
- **Icons sit one step below text.** `{icon.secondary}` is the resting colour for
  every glyph; `{icon.primary}` is reserved for hover and the active state of a
  segmented control. An icon that matches the text colour reads as loud as a
  label, which is what makes a dense panel feel busy.
- Type is a six-step ramp, `{fontSize.micro}` 9px → `{fontSize.heading}` 14px.
  The editor is deliberately denser than the marketing site: `label` (12px) is
  the workhorse for controls, `body` (11px) for monospace metadata, and
  `heading` (14px) is as large as chrome ever gets.
- Icons render at `{iconSize.*}` — 16/20/24/28. The imported glyph set insets its
  artwork inside a 24 box (the mark spans roughly 4..20), so **24px is the
  default**, not 16: a 24-box glyph drawn at 16px yields a ~10px mark.
- `{control.height}` 24px and `{control.gutter}` 8px define the inspector's
  rhythm — every field, icon button and segmented cell is one control tall.
- `{control.icon-box}` 28px is the *chrome's* ghost icon button — the bottom
  bar's tools, the canvas verbs beside them, the dock headers, Send. Larger than
  `control.height` on purpose: those buttons carry a 20px glyph and nothing else,
  so at 24 the mark would sit flush against the button's edge with no optical
  padding at all, which is what the dock headers used to do while the bottom bar
  a few pixels away did not. Inspector controls stay on `control.height`; they
  sit in a field grid whose rhythm is the thing that matters there.
- **Vertical spacing is a three-step scale, not one gap.** A panel that puts
  everything at the same pitch reads as an undifferentiated stack however good
  its individual controls are, which is exactly what the inspector did before
  these existed:

  | Token | | Separates |
  | --- | --- | --- |
  | `{control.field-gap}` | 2px | parts of **one** control — the four padding sides, a swatch and its hex, the cells of a segmented group |
  | `{control.row-gap}` | 6px | **rows** within a group |
  | `{control.group-gap}` | 12px | **groups** within a section |
  | `{control.gutter}` | 8px | columns on one row |

  These are deliberately off the `{spacing.*}` scale. That scale is for page and
  panel chrome, where 4px is the smallest meaningful step; this one is for the
  inside of a 24px-tall control, where 2px is a real distance. Two scales, two
  jobs — and every gap inside the inspector must come from one of these four,
  so that changing the panel's density is one edit here rather than a sweep
  through twenty CSS rules.
- **`{boxModel.*}` are conventions, not choices.** Blue inside the border, amber
  outside it, pink between children — the same three every browser's element
  inspector has used for fifteen years. Anyone who has opened one already knows
  which is which, and a prettier assignment would cost that recognition for
  nothing. They are their own group rather than borrowed from `{semantic.*}`
  because none of them is a state, and rather than from `{primary.*}` because
  only one of them is the accent.
- **Motion is three durations and three curves, and no more.** Before
  `{motion.*}` existed the overlay had twenty-odd hand-written `transition`
  declarations and not one `cubic-bezier` anywhere, which is why nothing in it
  moved with a recognisable hand.

  | Token | | Used for |
  | --- | --- | --- |
  | `{motion.dur-micro}` | 100ms | a control changing state under the pointer — background, colour, a caret |
  | `{motion.dur-base}` | 150ms | structure moving — a panel opening, a row stepping aside for a drag |
  | `{motion.dur-slow}` | 200ms | a whole surface re-anchoring, like a dock snapping to the other side |
  | `{motion.ease}` | `ease` | micro-states, where the curve is not perceptible and a named one is a lie |
  | `{motion.ease-out}` | easeOutQuint | the house curve: leaves fast, settles slowly, reads as physical |
  | `{motion.ease-in-out}` | easeInOutQuart | symmetric moves that start and end at rest |

  **Canvas chrome is exempt and must stay exempt.** The hover and selection
  outlines are re-positioned on every pointer move, so a transition on them
  interpolates between two elements and the outline visibly trails the cursor —
  it reads as lag, not as easing. `overlay/src/styles/chrome.css.ts` carries no
  `transition` at all, and there is a build check that keeps it that way.

## Theming

Editor chrome is dark-only. All tokens are emitted flat under `--ap-*` on the
overlay's scoped root — there is no light/dark swap and no coupling to the
marketing theme.
