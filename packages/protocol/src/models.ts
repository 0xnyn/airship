// AUTO-GENERATED from https://models.dev/models.json by scripts/gen-models.mjs.
// Do not edit by hand — edit scripts/models.curation.json and run
// `make models:refresh`. 34 models across three harnesses.

/**
 * The model list the picker paints before anything has been asked, and falls
 * back to when a probe fails.
 *
 * This module is deliberately free of zod and of every other runtime import,
 * and reaches the overlay through the `./models` export subpath alongside
 * `./tokens`. That is what lets the browser bundle import the list as a value,
 * rather than hand-copying it beside `AGENTS` in `app.ts`, at no cost — an
 * import from the package's main entry would pull the validator in with it.
 *
 * (The overlay bundle does contain zod today regardless: `app.ts` takes
 * `modeToSurface` and the surface constants from that main entry, which is
 * enough to drag it along. This module simply does not add to that, and stays
 * correct if those imports are ever moved.)
 *
 * It is a *seed*, never the truth. Claude and OpenCode both enumerate their own
 * models at runtime and their answers win, because only they know what the user
 * is signed in to. Codex can enumerate nothing at any layer, so for that
 * harness this is the whole list — which is the reason the generator exists.
 */
export interface SeedModel {
  /** Right-aligned dimmed hint on the row — a context window. */
  hint?: string;
  /** What goes on the wire. Bare for claude and codex; `provider/model` for
   * opencode, whose `modelRefFor` drops an id it cannot attribute. */
  id: string;
  label: string;
}

/*
 * Keys spelled out rather than imported as `AgentKind`. That type is a
 * `z.infer`, so naming it here would tie this module to the zod-importing
 * barrel for no gain — `models.test.ts` asserts these keys against
 * `AGENT_KINDS` instead, which catches the drift the import would have.
 */
export const SEED_MODELS: Record<"claude" | "codex" | "opencode", SeedModel[]> =
  {
    claude: [
      { hint: "latest", id: "opus", label: "Opus" },
      { hint: "latest", id: "sonnet", label: "Sonnet" },
      { hint: "latest", id: "haiku", label: "Haiku" },
      { hint: "latest", id: "fable", label: "Fable" },
      { hint: "1M", id: "claude-opus-5", label: "Claude Opus 5" },
      { hint: "1M", id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { hint: "1M", id: "claude-fable-5", label: "Claude Fable 5" },
      { hint: "1M", id: "claude-mythos-5", label: "Claude Mythos 5" },
      { hint: "1M", id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { hint: "1M", id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { hint: "1M", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { hint: "1M", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      {
        hint: "200K",
        id: "claude-opus-4-5",
        label: "Claude Opus 4.5 (latest)",
      },
      {
        hint: "200K",
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5 (latest)",
      },
    ],
    codex: [
      { hint: "1.1M", id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { hint: "1.1M", id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { hint: "1.1M", id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { hint: "1.1M", id: "gpt-5.5", label: "GPT-5.5" },
      { hint: "1.1M", id: "gpt-5.5-pro", label: "GPT-5.5 Pro" },
      { hint: "400K", id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
      { hint: "400K", id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
      { hint: "1.1M", id: "gpt-5.4", label: "GPT-5.4" },
      { hint: "1.1M", id: "gpt-5.4-pro", label: "GPT-5.4 Pro" },
      { hint: "400K", id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    ],
    opencode: [
      { hint: "1M", id: "anthropic/claude-opus-5", label: "Claude Opus 5" },
      { hint: "1.1M", id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
      { hint: "1.1M", id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
      { hint: "1.1M", id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
      { hint: "1M", id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5" },
      { hint: "1M", id: "anthropic/claude-fable-5", label: "Claude Fable 5" },
      { hint: "1M", id: "anthropic/claude-mythos-5", label: "Claude Mythos 5" },
      { hint: "1M", id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8" },
      { hint: "1.1M", id: "openai/gpt-5.5", label: "GPT-5.5" },
      { hint: "1.1M", id: "openai/gpt-5.5-pro", label: "GPT-5.5 Pro" },
    ],
  };
