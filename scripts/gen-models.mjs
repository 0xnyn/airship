// Generates packages/protocol/src/models.ts — the seed model catalogue — from
// the models.dev registry.
//
// Why a seed exists at all: of the three harnesses, only two can enumerate
// their own models. Claude answers `query.supportedModels()` and OpenCode
// answers `client.config.providers()`, both live and both scoped to what the
// user is actually authenticated for. **Codex can enumerate nothing** — no CLI
// subcommand, no app-server RPC, no config file to read. Without this its list
// would be a constant somebody has to remember to edit on every OpenAI release,
// and the failure mode of forgetting is silent: the picker just stops offering
// the model you wanted.
//
// The seed also does two smaller jobs. It is what the menu paints *before* the
// live probe returns, so opening the picker is never a wait; and it is what the
// menu falls back to when a probe fails or there is no network.
//
// Usage:
//   node scripts/gen-models.mjs           # fetch and write
//   node scripts/gen-models.mjs --check   # verify without writing
//
// `--check` exists for local use — `make preflight` deliberately does NOT run
// it. Every other generated file in this repo derives from something committed
// beside it, so a drift gate can only fire when a human changed the input. This
// one derives from a remote file that changes whenever a vendor ships a model,
// so gating on it would make the gate go red on PRs that touched nothing and
// require network to pass. `reference/NEXT-STEPS.md` §7 describes what that
// costs: "the gate will fail on every single PR forever."
//
// Refresh is therefore a deliberate act — `make models:refresh` — reviewed as a
// diff, the way a lockfile bump is.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// `new URL(..., import.meta.url)` throughout, handed straight to the fs calls,
// which take a file URL. Same reasoning as scripts/gen-controls.mjs: nothing
// here converts one to a path string, which sidesteps the `/C:/…` and
// percent-encoding traps packages/overlay/scripts/check-css.mjs documents.
const CURATION = new URL("./models.curation.json", import.meta.url);
const OUT = new URL("../packages/protocol/src/models.ts", import.meta.url);

// The provider-agnostic file, 279 KB. `api.json` carries the same models keyed
// per provider with pricing attached and is 3.7 MB — thirteen times the bytes
// for a `cost` field no menu row renders. Switch only if a price hint is added.
const SOURCE = "https://models.dev/models.json";

/** models.dev id prefix → the harness whose group the model belongs in. */
const HARNESS = { "anthropic/": "claude", "openai/": "codex" };

/**
 * `.bin/biome` is the POSIX shell wrapper, which Windows cannot execute. pnpm
 * writes a `biome.CMD` beside it for exactly this, and spawning that needs a
 * shell — a batch file is not an executable image. The arguments here are
 * fixed and the generated source travels on stdin rather than argv, so there is
 * nothing for a shell to mis-split.
 */
const WIN32 = process.platform === "win32";
const BIOME = new URL(
  `../node_modules/.bin/biome${WIN32 ? ".CMD" : ""}`,
  import.meta.url
);

function die(message) {
  process.stderr.write(`gen-models: ${message}\n`);
  process.exit(1);
}

/**
 * Hand the rendered source to biome before it is written or compared.
 *
 * Not a nicety — it is what keeps `--check` honest. `make preflight` runs
 * `ultracite fix` over the whole tree, so a generated file that is not already
 * clean gets rewritten the moment anyone lints, and every subsequent `--check`
 * then reports stale against a file nobody touched. Running it here means the
 * generator and the linter cannot disagree, and the template is free to emit
 * readable one-line rows without predicting where biome wraps.
 *
 * `check --write` rather than `format`: formatting alone leaves lint rules to
 * fire later, which is the same staleness one step removed. Safe fixes only —
 * `--unsafe` reflows prose (it "fixes" a JSDoc line starting with an asterisk
 * by deleting the space, mangling the sentence), so anything it would touch is
 * a template bug to fix here rather than to paper over.
 */
function format(source) {
  const out = spawnSync(
    fileURLToPath(BIOME),
    ["check", "--write", "--stdin-file-path=models.ts"],
    { encoding: "utf8", input: source, shell: WIN32 }
  );
  if (out.error || out.status !== 0) {
    die(
      `biome could not format the output: ${out.error?.message ?? out.stderr?.trim() ?? `exit ${out.status}`}`
    );
  }
  return out.stdout;
}

/**
 * Context window as a menu hint.
 *
 * `MenuItem.hint` renders right-aligned in a dimmed mono — "a shortcut, a size,
 * a unit" — so it wants `1M`, not a sentence. This is the whole reason the seed
 * carries metadata rather than bare ids: Claude's own `supportedModels()`
 * returns a prose `description`, which is the wrong shape for that slot.
 */
function contextHint(limit) {
  const n = limit?.context;
  if (!n) {
    return;
  }
  return n >= 1_000_000
    ? `${Math.round(n / 100_000) / 10}M`.replace(".0M", "M")
    : `${Math.round(n / 1000)}K`;
}

/** Strip the provider prefix: `anthropic/claude-opus-5` → `claude-opus-5`. */
function bareId(id) {
  return id.slice(id.indexOf("/") + 1);
}

/**
 * The mechanical half of the filter.
 *
 * Everything decided here is a property models.dev states outright. Anything
 * that needs judgement — that `gpt-realtime-2.1` passes `tool_call` and
 * `reasoning` but is not a coding model — belongs in the deny list, where it is
 * reviewable, rather than as a special case in this function.
 */
function candidates(models, curation) {
  const deny = curation.deny.map((p) => new RegExp(p));
  const out = [];
  for (const [id, model] of Object.entries(models)) {
    const prefix = Object.keys(HARNESS).find((p) => id.startsWith(p));
    if (!(prefix && model.tool_call && model.reasoning)) {
      continue;
    }
    if (!model.release_date || model.release_date < curation.since) {
      continue;
    }
    if (deny.some((re) => re.test(id))) {
      continue;
    }
    out.push({
      date: model.release_date,
      harness: HARNESS[prefix],
      hint: contextHint(model.limit),
      id,
      label: model.name ?? bareId(id),
    });
  }
  // Newest first, then by id so a same-day pair never reorders between runs.
  // Determinism is the property the "run it twice, no diff" check rests on.
  out.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return out;
}

/**
 * Candidates → the three harness groups.
 *
 * Claude and Codex take the bare id, which is what `--model` wants for each.
 * OpenCode takes the `provider/model` form its adapter's `modelRefFor` splits
 * on — a bare id there has no resolvable provider and gets dropped.
 *
 * OpenCode's group is seeded from the same two providers rather than from the
 * whole registry. It resolves models.dev itself at startup and reports back
 * only what the user is authenticated for, so anything richer here would be
 * both duplicated work and a list of models that cannot be called. This is
 * first paint, and the live probe replaces it wholesale.
 */
function group(all, curation) {
  const seeded = { claude: [], codex: [], opencode: [] };
  for (const harness of ["claude", "codex"]) {
    const extra = curation.extra?.[harness] ?? [];
    const derived = all
      .filter((m) => m.harness === harness)
      .slice(0, curation.limit)
      .map((m) => ({ hint: m.hint, id: bareId(m.id), label: m.label }));
    seeded[harness] = [...extra, ...derived];
  }
  seeded.opencode = all
    .slice(0, curation.limit)
    .map((m) => ({ hint: m.hint, id: m.id, label: m.label }));
  return seeded;
}

function render(seeded, count) {
  const rows = (models) =>
    models
      .map((m) => {
        const hint = m.hint ? ` hint: ${JSON.stringify(m.hint)},` : "";
        return `    {${hint} id: ${JSON.stringify(m.id)}, label: ${JSON.stringify(m.label)} },`;
      })
      .join("\n");

  return `// AUTO-GENERATED from ${SOURCE} by scripts/gen-models.mjs.
// Do not edit by hand — edit scripts/models.curation.json and run
// \`make models:refresh\`. ${count} models across three harnesses.

/**
 * The model list the picker paints before anything has been asked, and falls
 * back to when a probe fails.
 *
 * This module is deliberately free of zod and of every other runtime import,
 * and reaches the overlay through the \`./models\` export subpath alongside
 * \`./tokens\`. That is what lets the browser bundle import the list as a value,
 * rather than hand-copying it beside \`AGENTS\` in \`app.ts\`, at no cost — an
 * import from the package's main entry would pull the validator in with it.
 *
 * (The overlay bundle does contain zod today regardless: \`app.ts\` takes
 * \`modeToSurface\` and the surface constants from that main entry, which is
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
  /** What goes on the wire. Bare for claude and codex; \`provider/model\` for
   * opencode, whose \`modelRefFor\` drops an id it cannot attribute. */
  id: string;
  label: string;
}

/*
 * Keys spelled out rather than imported as \`AgentKind\`. That type is a
 * \`z.infer\`, so naming it here would tie this module to the zod-importing
 * barrel for no gain — \`models.test.ts\` asserts these keys against
 * \`AGENT_KINDS\` instead, which catches the drift the import would have.
 */
export const SEED_MODELS: Record<"claude" | "codex" | "opencode", SeedModel[]> =
  {
  claude: [
${rows(seeded.claude)}
  ],
  codex: [
${rows(seeded.codex)}
  ],
  opencode: [
${rows(seeded.opencode)}
  ],
};
`;
}

async function main() {
  const curation = JSON.parse(readFileSync(CURATION, "utf8"));
  const check = process.argv.includes("--check");

  let models;
  try {
    const res = await fetch(SOURCE);
    if (!res.ok) {
      die(`${SOURCE} returned ${res.status}`);
    }
    models = await res.json();
  } catch (err) {
    die(`could not fetch ${SOURCE}: ${err.message}`);
  }

  const all = candidates(models, curation);
  if (!all.length) {
    // A registry reshuffle that silently emptied the file would take Codex's
    // only model list with it, so this fails rather than writing the void.
    die(
      "no models survived the filter — check `since` and `deny` in models.curation.json"
    );
  }

  const seeded = group(all, curation);
  const count = Object.values(seeded).reduce((n, g) => n + g.length, 0);
  const next = format(render(seeded, count));

  // `\r\n` normalised on both sides: the repo is checked out with native line
  // endings on Windows and this comparison is about content.
  const same = (a, b) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

  if (check) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf8");
    } catch {
      die(
        "packages/protocol/src/models.ts is missing — run `make models:refresh`."
      );
    }
    if (!same(current, next)) {
      die(
        "packages/protocol/src/models.ts is stale — run `make models:refresh` and commit the result."
      );
    }
    process.stdout.write("packages/protocol/src/models.ts is up to date\n");
    return;
  }

  writeFileSync(OUT, next);
  process.stdout.write(
    `wrote packages/protocol/src/models.ts — ${seeded.claude.length} claude, ${seeded.codex.length} codex, ${seeded.opencode.length} opencode\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
