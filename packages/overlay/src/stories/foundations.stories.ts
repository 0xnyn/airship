import { design } from "@airship/editor-tokens";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { cls, el } from "../dom";
import { plainStage } from "./chrome";

/*
 * The palette and the type ramp, straight from `@airship/editor-tokens`.
 *
 * This page earns its place twice. It is the catalogue entry for the token set
 * every other story renders through — `EDITOR.md` is the source of truth, and
 * this is what that file actually looks like — and it is the canary for the two
 * pieces of setup in `.storybook/preview.ts` that fail silently.
 *
 * If the swatches are transparent, `#__airship-root` is not wrapping the story
 * and every `var(--ap-*)` in the overlay is being dropped as
 * invalid-at-computed-value-time. If the type below renders in Helvetica,
 * `staticDirs` is not serving `/__airship/fonts/*` and the whole editor is being
 * previewed in the wrong face at the wrong metrics.
 *
 * The group → prefix pairs mirror `GROUPS` in `@airship/editor-tokens`' `css.ts`,
 * which is what decides the emitted variable names. They are listed rather than
 * imported because that table is not exported; a group renamed there shows up
 * here as a page of transparent swatches, which is loud enough.
 */

const meta: Meta = {
  title: "Foundations/Tokens",
};

export default meta;

const COLOUR_GROUPS = [
  ["Surface", "surface", design.surface],
  ["Border", "border", design.border],
  ["Text", "text", design.text],
  ["Icon", "icon", design.icon],
  ["Blue", "blue", design.blue],
  ["Semantic", "semantic", design.semantic],
] as const satisfies readonly (readonly [
  string,
  string,
  Record<string, string>,
])[];

/** A labelled swatch: the emitted var, resolved by the browser. */
function swatch(name: string, cssVar: string): HTMLElement {
  return el("div", { style: "display: grid; gap: 6px;" }, [
    el("div", {
      style: `height: 44px; border-radius: 4px; background: var(${cssVar});
              border: 1px solid var(--ap-border-default);`,
    }),
    el("div", {
      style:
        "font: 400 11px var(--ap-font-sans); color: var(--ap-text-primary);",
      text: name,
    }),
    el("div", {
      style:
        "font: 400 10px var(--ap-font-mono); color: var(--ap-text-tertiary);",
      text: cssVar,
    }),
  ]);
}

function grid(children: HTMLElement[]): HTMLElement {
  return el(
    "div",
    {
      style: `display: grid; gap: 16px; padding: 16px;
              grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));`,
    },
    children
  );
}

function heading(label: string): HTMLElement {
  return el("h2", {
    style: `margin: 24px 16px 0; font: 600 12px var(--ap-font-sans);
            letter-spacing: .06em; text-transform: uppercase;
            color: var(--ap-text-secondary);`,
    text: label,
  });
}

/**
 * The setup assertions, run from inside the browser tier.
 *
 * This `play` is the guard that makes the whole catalogue trustworthy. Every
 * failure mode in `.storybook/preview.ts` is *silent*: a story with no
 * `#__airship-root` around it still renders, still passes a smoke test, and is
 * simply the wrong picture — every `var(--ap-*)` dropped as
 * invalid-at-computed-value-time, with nothing thrown and nothing logged. So the
 * one thing that must never be checked by eye is checked here, on every run.
 *
 * It lives on this story rather than in a setup file because since Storybook
 * 10.3 the vitest plugin applies `preview.ts` itself, and a hand-rolled
 * `setProjectAnnotations` now conflicts with that. An assertion inside the run
 * is the more honest check anyway: it proves the decorator *reached the story*,
 * not merely that a config file was loaded.
 */
async function assertSetup(root: HTMLElement): Promise<void> {
  const scope =
    root.closest("#__airship-root") ?? root.querySelector("#__airship-root");
  if (!scope) {
    throw new Error(
      "No #__airship-root around the story — the preview decorator did not run, " +
        "so every --ap-* token is being dropped. See .storybook/preview.ts."
    );
  }
  const read = (name: string) =>
    getComputedStyle(scope).getPropertyValue(name).trim();
  for (const token of [
    "--ap-surface-panel",
    "--ap-text-primary",
    "--ap-space-md",
  ]) {
    if (!read(token)) {
      throw new Error(
        `${token} resolved to nothing — the token scope is broken.`
      );
    }
  }
  if (!document.getElementById("__airship-styles")) {
    throw new Error("The overlay stylesheet is not in the document.");
  }
  await document.fonts.ready;
  for (const family of ["Inter", "JetBrains Mono"]) {
    if (!document.fonts.check(`12px "${family}"`)) {
      throw new Error(
        `${family} is not loaded — staticDirs is not serving /__airship/fonts/*, ` +
          "so the dock is being previewed at the wrong metrics."
      );
    }
  }
  /*
   * The caption's title is stamped by the decorator, not written by the story,
   * so a broken stamp is the same class of silent failure as the three above: a
   * caption renders, reads correctly, and is headed by an empty line on every
   * story in the catalogue. Checking it here means one story fails loudly rather
   * than ~150 stories looking slightly unfinished.
   */
  const title = scope.querySelector<HTMLElement>("[data-story-title]");
  if (!title?.textContent?.trim()) {
    throw new Error(
      "The caption title is empty — the preview decorator did not stamp it. " +
        "See `stampTitle` in .storybook/preview.ts."
    );
  }
}

/** Every colour group the token package emits, in the order it emits them. */
export const Colour: StoryObj = {
  play: ({ canvasElement }) => assertSetup(canvasElement),
  render: () =>
    plainStage(
      [
        el(
          "div",
          {},
          COLOUR_GROUPS.flatMap(([label, prefix, values]) => [
            heading(label),
            grid(
              Object.keys(values).map((key) =>
                swatch(key, `--ap-${prefix}-${key}`)
              )
            ),
          ])
        ),
      ],
      {
        try: "if any swatch is transparent, the token scope is broken and every other story in this catalogue is lying to you",
        what: "Every colour group `@airship/editor-tokens` emits, resolved by the browser rather than transcribed.",
      }
    ),
};

/**
 * The type ramp in the real faces.
 *
 * Inter and JetBrains Mono are self-hosted and served here from
 * `@airship/editor-tokens/dist/fonts` — the same binaries the proxy serves in
 * production. A fallback face is the tell that `staticDirs` is not resolving,
 * and at these sizes it is unmistakable: the ramp tops out at 14px and the dock
 * is built on the 10px and 11px steps.
 */
export const Type: StoryObj = {
  render: () =>
    plainStage(
      [
        el("div", { style: "padding: 16px; display: grid; gap: 14px;" }, [
          ...Object.entries(design.fontSize).map(([key, px]) =>
            el("div", { style: "display: grid; gap: 2px;" }, [
              el("div", {
                style:
                  "font: 400 10px var(--ap-font-mono); color: var(--ap-text-tertiary);",
                text: `--ap-font-size-${key} · ${px}px`,
              }),
              el("div", {
                style: `font-family: var(--ap-font-sans);
                    font-size: var(--ap-font-size-${key});
                    color: var(--ap-text-primary);`,
                text: "Auto layout · Fill · Stroke · 1440×900",
              }),
            ])
          ),
          el("div", {
            style: `font-family: var(--ap-font-mono); font-size: 11px;
                color: var(--ap-text-primary); padding-top: 8px;`,
            text: "display: flex;  gap: 12px;  padding: 8px 16px;",
          }),
        ]),
      ],
      {
        try: "if this is Helvetica rather than Inter, `staticDirs` is not serving the fonts and the dock is being previewed at the wrong metrics",
        what: "The type ramp in the real faces — the same self-hosted binaries the proxy serves in production.",
      }
    ),
};

/**
 * The scalar ramps — spacing, radius, and the control heights the dock is built
 * on. These are emitted with a `px` suffix (see `PX_PREFIXES` in `css.ts`), so a
 * bar that renders at zero width means the suffix is missing rather than the
 * token.
 */
export const Scale: StoryObj = {
  render: () => {
    const ramp = (
      label: string,
      prefix: string,
      values: Record<string, number>
    ): HTMLElement[] => [
      heading(label),
      el(
        "div",
        { style: "display: grid; gap: 6px; padding: 16px;" },
        Object.keys(values).map((key) =>
          el(
            "div",
            {
              style:
                "display: grid; grid-template-columns: 140px 1fr; align-items: center; gap: 12px;",
            },
            [
              el("span", {
                style:
                  "font: 400 10px var(--ap-font-mono); color: var(--ap-text-tertiary);",
                text: `--ap-${prefix}-${key}`,
              }),
              el("span", {
                style: `height: 12px; background: var(--ap-blue-500);
                        border-radius: 2px; width: var(--ap-${prefix}-${key});`,
              }),
            ]
          )
        )
      ),
    ];
    return plainStage(
      [
        el("div", {}, [
          ...ramp("Spacing", "space", design.spacing),
          ...ramp("Radius", "radius", design.rounded),
        ]),
      ],
      {
        what: "The scalar ramps. These are emitted with a `px` suffix, so a bar at zero width means the suffix is missing rather than the token.",
      }
    );
  },
};

/**
 * A bare `cls()`-prefixed node, for checking the reset applies.
 *
 * `base.css.ts` scopes its reset to the root; this is the smallest thing that
 * proves the stylesheet reached the document at all.
 */
export const Reset: StoryObj = {
  render: () =>
    plainStage(
      [
        el("div", {
          class: cls("insp-multi"),
          text: "Reset applied to this node",
        }),
      ],
      {
        what: "The smallest thing that proves the overlay stylesheet reached the document at all.",
      }
    ),
};
