# Contributing

This is the contributor's half of the documentation. [`README.md`](README.md) covers
installing and using Airship; everything here is about working on it.

## Getting set up

Node 22.13 or later, and [pnpm](https://pnpm.io) — the repo pins `pnpm@11.9.0` through
`packageManager`, so Corepack will pick the right one.

```bash
pnpm install
pnpm build
```

`make help` lists every target, grouped by the surface it acts on. Targets follow a
`<surface>:<action>` convention — `web:dev`, `run:codex`, `storybook:build` — and repo-wide
operations stay bare (`build`, `check`, `preflight`).

The fastest way to see the tool working on itself:

```bash
make demo        # install + build, then prints the recipe

make web:dev     # terminal 1 — apps/web's dev server on :5173
make run         # terminal 2 — airship on :5174, editing apps/web
```

Open <http://localhost:5174> and you are looking at Airship, with Airship's own home page live
inside it. Pick the hero's button, ask for a change, and the diff lands in `apps/web/src/`.
`make run:solo` does both in one terminal via `--exec`.

## Repo layout

| Package | Role |
| --- | --- |
| `@airship/protocol` | Shared zod schemas + types (the client↔server contract) |
| `@airship/source` | DOM-element → source-file resolution (`element-source` + server fallback) |
| `@airship/git` | Optional auto-commit (Conventional Commits) + content-restore undo |
| `@airship/core` | **The agent engine** — `runEdit()` dispatches to a backend adapter |
| `@airship/server` | Reverse proxy + WebSocket + job/history store |
| `@airship/overlay` | Canvas shell + frames, picker, inspector, prompt, diffs, history — and a Storybook of all of it |
| `@airship/editor-tokens` | The editor's own `--ap-*` design tokens, generated from `EDITOR.md` |
| `@airship/editor-icons` | Vendored UI icon set, normalised to one generated module |
| `@airship/site-tokens` | The home page's `--pk-*` design tokens, generated from `DESIGN.md` |
| `@airshiplabs/cli` | The `airship` binary — the one package published to npm |
| `@airship/web` | The home page — and the app Airship edits in `make run` |

## Everyday commands

```bash
pnpm build       # turbo build (topological, including apps/web)
pnpm dev         # watch every package AND serve the site
pnpm dev:pkgs    # …packages only, when the site is not what you are changing
pnpm typecheck   # tsc --noEmit across the workspace
pnpm test        # vitest
pnpm lint        # biome (ultracite preset)
pnpm commit      # guided Conventional Commit (czg)
make storybook   # the overlay's own chrome, browsable — see below
```

`make check` runs lint + typecheck + test. `make preflight` runs that plus the route-tree
drift check, which is exactly what CI gates a PR on — run it before opening one.
`make preflight:fix` autofixes what is autofixable first, then verifies the rest.

Toolchain: **pnpm** workspaces + **Turborepo**, **Biome** via **Ultracite**, **Husky** +
**commitlint** for Conventional Commits, **tsup** builds.

### Two turbo edges worth knowing

Both are the same edge for the same reason: a package's `dist` has to exist before something
else can start against it.

- **`@airship/web#dev` depends on `@airship/site-tokens#build`**, because Vite has no
  `dist/tokens.css` to import until that package's postbuild has emitted it. Start the site
  through turbo (`make web:dev`, `pnpm dev:web`) rather than with a bare `vite dev`.
- **Storybook must start through turbo** for the same reason — see below.

### Hooks

`pre-commit` blocks direct commits to `main` and runs `ultracite fix` over staged files.
`commit-msg` runs commitlint. `pre-push` blocks pushes to `main`. The test suite deliberately
does *not* run in `pre-commit`: it runs in CI on every PR and locally via `make preflight`, and
a full `turbo run test` on every commit would tax exactly the fast checkpoint commits this repo
lives on while catching nothing the PR gate would not.

## Architecture

```
canvas shell ──ws──► proxy/server ──► @airship/core ──► claude │ codex │ opencode ──► edits your files
  ├ frame 1440×900     (serve + route)   (adapter)          (agent backend)          (diff + undo)
  └ frame  393×852
    (live app, pick element)
```

`runEdit()` owns everything that does not depend on which agent runs — the rendered prompt, the
activity timeline, diff capture, and result assembly — and dispatches the rest through
`AgentAdapter` (`packages/core/src/providers/`).

### Claude

Leans on the Agent SDK rather than hand-rolling a subprocess:

- **`query()` streaming-input loop** — typed `SDKMessage`s; native image input; cancel via `AbortController`.
- **`includePartialMessages`** — token-level streaming of Claude's text to the overlay.
- **`PreToolUse` hooks** — robust before/after **diff capture**, plus (under `--safe`) a **sandbox** that denies edits/commands outside the project.
- **`createSdkMcpServer` + `tool()`** — a `get_element_context` tool exposing the selection to Claude.
- **`outputFormat` (JSON schema)** — typed `{ summary, filesChanged, followUps }` per edit.
- **`enableFileCheckpointing` + `rewindFiles`** — native undo (with content-restore fallback).
- **`resume` / `forkSession`** — multi-turn refinement on the same session.
- **`settingSources: ["project"]`** — respects the target repo's `CLAUDE.md`.
- **`maxTurns` / `maxBudgetUsd` / `effort`** — per-edit guardrails; usage/cost reported back.

### Codex

The Codex SDK spawns `codex exec --experimental-json` and streams JSONL. It offers less, and
the adapter is explicit about each gap rather than faking it:

| | Claude | Codex |
| --- | --- | --- |
| Text streaming | token-level | whole messages at completion |
| Diff `before` side | `PreToolUse` snapshot | reconstructed from the git HEAD blob |
| Tool screening | hooks + `canUseTool` | the CLI's own OS sandbox |
| Selection re-read | `get_element_context` MCP tool | inlined in the prompt |
| Structured output | validated by the SDK | model JSON, zod-parsed defensively |
| Cost | `total_cost_usd` | tokens only |
| Fork a session | `forkSession` | starts a fresh thread, and says so |
| `maxTurns` / `maxBudgetUsd` | enforced | unsupported; warned about at startup |

Codex items are normalized into the same tool vocabulary Claude uses (`command_execution` →
`Bash`, `file_change` → `Edit`/`Write`/`Delete`), so one copy of the summarization rules serves
both and the transcript reads the same either way.

### OpenCode

Structurally unlike the other two: OpenCode is a **client/server pair**, not an in-process
iterator. The SDK shells out to `opencode serve` and speaks HTTP + SSE, so a turn is a blocking
`session.prompt` raced against a *global* event subscription carrying every session on that
server. Airship keeps one lazily started server per process and filters every event by session
id.

It is the most capable of the three in several places, and the adapter uses all of them:

| | Codex | OpenCode |
| --- | --- | --- |
| Text streaming | whole messages at completion | token-level (`message.part.delta`) |
| System prompt | rides on the first turn's text | a real `system` field |
| Fork a session | starts a fresh thread, and says so | native `session.fork`, history intact |
| Native undo | none | `session.revert`, snapshot-backed |
| Cost | tokens only | real cost per message |
| Reasoning effort | `modelReasoningEffort` | **none** — `--effort` is ignored |

Gaps handled explicitly rather than faked:

- **No bundled binary.** `@opencode-ai/sdk` ships only a spawn helper; the `opencode` CLI is a
  separate install. `checkAuth()` scans PATH and says so.
- **No OS sandbox.** See the safety section in the README.
- **No in-process MCP** — MCP servers are config-declared subprocesses, so the selection is
  inlined in the prompt as it is for Codex.
- **`--model` wants `provider/model`.** A bare id cannot be resolved to a provider, so it is
  dropped with a warning rather than silently ignored.
- **Structured output is a prompt convention, not a constrained decode.** The model emits its
  JSON inside `<structuredoutput>` tags within ordinary prose, and opencode's own extractor
  frequently fails to lift it back out. The adapter parses the tag itself and strips it from the
  streamed transcript on the way past — including when the opening tag arrives split across two
  deltas.

The wire types are declared in `providers/opencode-wire.ts` rather than imported from the SDK:
the SDK's generated `Event` union omits `message.part.delta` entirely (237 of 313 events in a
real turn), omits `server.heartbeat`, and declares a `permission.updated` the server does not
emit in place of the `permission.asked` it does. Trusting it would drop streaming and deadlock
every permission request while type-checking cleanly.

## The site

`apps/web` does two jobs. It is Airship's home page, and it is the app the `run` targets point
the CLI at — so the demo in its hero is a picture of the tool editing the very page you are
reading.

It is a TanStack Start (Vite 7) app inside this workspace, styled from `packages/site-tokens`
(`--pk-*`, generated from that package's `DESIGN.md`).

The hero recreates Airship's **inline mode** in miniature and animates the thing the tool
actually claims: pick an element, describe the change, the agent edits the file — composer,
streaming tool calls, diff, and the button changing on the page. It is a static recreation, not
the editor: the chrome is HTML and a ten-second CSS timeline, sharing only the `--ap-*` palette
with the real thing, which `site-tokens` re-emits scoped to that one subtree so it cannot drift.

Two things about it are editorial rather than faithful, and are commented as such where they
live. The real overlay runs **two** docks — chat left, inspector right — while the hero folds
them into one panel with the agent as the front tab (`design-dock.tsx`); and the hero's glyphs
are hand-drawn rather than the vendored set the editor uses. Everything inside those panels is
transcribed 1:1.

`?frame=62` freezes the loop at any percent for inspection, and `prefers-reduced-motion` pins it
at the frame that explains the most.

Page copy lives in `apps/web/src/content/*.json` so it can be edited without opening a
component, and `content/resolve.ts` is the only place that turns a `{{token}}` or a `link` key
into a real value. That indirection is why the install command appears once, in `site.json`, and
why `resolve.ts` throws at module load on an unknown token rather than shipping the literal
`{{installCommand}}` to a visitor.

### The social card

`public/og.png` is generated, not drawn:

```bash
make web:og      # rewrites apps/web/public/og.png, then commit it
```

`apps/web/scripts/og.mjs` renders an HTML card in headless Chromium at a fixed 1200×630 and
screenshots it. The heading and the install command are read from `hero.json` and `site.json` —
the same files the page renders from — because those are the two strings that drift. The card
spent a while advertising a headline the page had stopped using and an install command that
installed somebody else's package, which is what a picture of copy gets you when nothing checks
it. The one line the script owns is the blurb, and there is a comment saying why.

It needs `@airship/site-tokens` built, since it embeds Inter and JetBrains Mono from that
package's `dist/fonts`; the make target builds it first.

## Storybook

```bash
make storybook       # the catalogue on :6006
make test:browser    # every story, as a test, in real Chromium
make browsers        # one-time: download that Chromium
```

`packages/overlay` carries a Storybook of the editor's own chrome — the inspector's controls, its
sections, the whole Design panel, the chat timeline, diffs, toasts and the device presets.
Stories are colocated next to the code they cover (`src/**/*.stories.ts`), the same convention
the `.test.ts` files already follow.

It exists for two reasons that are really one.

**The panel is hard to look at.** The only other way is `make web:dev` plus `make run`, then
picking an element and hoping it lands in the state you wanted. States that matter and are
awkward to reach by hand — `Mixed` across a multi-selection, a token-bound field, a locked aspect
ratio, a six-stop gradient, an element matched by fourteen rules, a `Bash` that failed next to an
`Edit` still running — are effectively unreviewable. Each of those is now a URL.

**It is the real-browser half of the test suite.** `packages/overlay/vitest.config.ts` runs on
happy-dom, and its own docstring — plus `inspector/test-support.ts`'s — lists what that costs: no
layout, no native CSS nesting, `@layer` dropped outright, no `CSSStyleDeclaration` iterator.
Those are the four things the inspector reads. `make test:browser` runs the same stories under
`@vitest/browser` where all four are real, which is why the CSS pane has a story at all —
`style-model.ts` notes it "could never be rendered in a test".

Two things are worth knowing before you touch it.

- **Start it through turbo.** `.storybook/main.ts` maps `@airship/editor-tokens`' `dist/fonts`
  onto `/__airship/fonts`, which is where the overlay's `@font-face` rules point; Storybook
  refuses to start when a `staticDirs` source is missing, so a bare
  `pnpm --filter @airship/overlay storybook` fails on a clean checkout.
- **The browser tier is deliberately outside `pnpm test`.** It has its own config
  (`vitest.browser.config.ts`) and its own script, because a test tier that launches Chromium
  fails on any machine that has not downloaded it. It is also outside CI for now —
  `@storybook/addon-a11y` fails the run on axe violations and the overlay still has a backlog of
  them, so the lane would start red. `make test:browser` runs it on demand; `make browsers`
  fetches the Chromium it needs.

Section stories render one section inside a *real* `DesignPanel` rather than against a stand-in
`SectionContext`, by shadowing one private method. The reasoning, and the six things that go
quietly wrong if you do it the other way, are in `src/stories/story-panel.ts`.

## Testing

`pnpm test` runs vitest across the workspace — around sixty suites, concentrated in
`packages/overlay` (the inspector's CSS reasoning), `packages/core` (provider event mapping,
diff capture, the sandbox), and `apps/cli/src/lib` (argument parsing, config resolution, port
detection, help rendering).

The CLI's own tests are worth reading before changing `args.ts`: citty parses but does not
validate, and `args.test.ts` pins the behaviour that covers the difference.

The browser tier is separate — see Storybook above.

## CI

Every PR into `main` runs:

- **`checks.yml`** — lint, then `turbo typecheck test` scoped with `--affected` against the PR
  base. `make preflight` is the local equivalent, minus the scoping: locally there is no base, so
  it runs repo-wide, and it layers on a route-tree drift check.
- **`branch-policy.yml`** — only `release/*`, `hotfix/*`, `security/*` and `dependabot/*`
  branches may target `main`. Releases are cut from `release/*`, so this is what keeps the
  release lane legible, and what makes `dependabot/*` an explicit exception rather than an
  accident.

**The site's deploy is not in this repo.** `apps/web` ships through Cloudflare Workers Builds,
configured in the Cloudflare dashboard and wired to GitHub by the *Cloudflare Workers & Pages*
GitHub App — so there is no `web-deploy.yml` to find, and no `CLOUDFLARE_*` secret on the repo.
A push to `main` touching `apps/web/`, `packages/site-tokens/` or `packages/editor-tokens/`
runs `pnpm -w run build:web` and then `wrangler deploy`, updating the `airship-web` worker. Any
other branch runs `wrangler versions upload` instead, which publishes a *version* rather than
promoting it: the app posts that version's preview URL onto the PR, and production is untouched
until the merge. Build logs live in the dashboard, not in the Actions tab.

This is why `apps/web/wrangler.jsonc` declares no `env` block — one worker, and the branch
decides the command. `make web:deploy` remains as a manual override that authenticates as you.

**What gets deployed is prerendered, not server-rendered.** `vite.config.ts` passes
`prerender: { enabled: true }` to `tanstackStart()`, so the build runs the server bundle once and
writes `dist/client/index.html` — which is the worker's assets directory, so Cloudflare serves
the page as a static file and the worker is never invoked for a normal view. It is still built
and still deployed: it answers whatever the assets do not match, which is what renders the 404.

That has a consequence worth knowing before you reach for one. **A server function or route
loader added to this app will run at build time, not per request** — its result gets baked into
the HTML. That is correct for this site, which has one route and imports all of its copy from
`src/content/*.json`, but the day the page genuinely needs request-dependent output, turning
prerendering off is the change to make, not working around it.

## Releases

`@airshiplabs/cli` is the only package published to npm. Everything else in the workspace is
private and gets **inlined into the CLI bundle** at build time, so the published tarball declares
no `@airship/*` dependency.

The overlay IIFEs and the editor fonts cannot be inlined — they are assets the server resolves at
runtime — so `apps/cli/scripts/vendor-assets.mjs` copies them into `dist/vendor/`, and
`packages/server/src/proxy.ts` falls back to that copy when `require.resolve` finds nothing.
**That fallback is the whole reason a published install works**; if the overlay ever 404s from
npm but not from source, start there.

Two ways to cut a release, and they never both publish:

```bash
make release              # local: bump, validate packaging, commit, tag — then
                          # `git push --follow-tags` fires release.yml
make release:ci BUMP=minor  # all-in-CI: publish.yml does the whole thing
make release DRY=1        # validate everything, write nothing
```

`publish.yml` pushes its tag with `GITHUB_TOKEN`, which by design does not trigger other
workflows — so `release.yml` stays dormant for CI-cut releases. Both need an `NPM_TOKEN` secret
on the repo.

## Design decisions

Conscious engineering choices, not oversights:

- **Diff rendering is a self-contained renderer**, not `@pierre/diffs` + shiki. Keeps the overlay
  IIFE small and dependency-light (no shiki in the browser bundle). The server still computes
  patches with `diff`.
- **Undo is content-restore first** (instant, from the before-state captured by the SDK
  `PreToolUse` hooks on Claude, or reconstructed from git on Codex). SDK `rewindFiles` is
  implemented (`core.rewindEdit`) as the SDK-native alternative on Claude; the two are not run
  concurrently. Codex has no native checkpointing, and `rewindEdit` says so rather than silently
  doing nothing.
- **Session persistence uses the SDK's own `persistSession`** plus Airship's `~/.airship/history`
  bundles (which record each `sessionId`), so resume survives a daemon restart — without a custom
  `SessionStore`. A `SessionStore` adapter (S3/Redis) is the path for multi-host hosted mode.
- **Deferred for now:** multi-element select, `startup()` pre-warm (a latency optimization that
  requires threading a warm handle through each edit), and the Vite/Next plugin wrappers plus
  hosted mode.

## `reference/`

`reference/` holds the original `spidey-sense`, `layrr`, `element-source`, and `diffity`
projects for context — Airship unifies the ideas behind the first two on a single core. It is
git-ignored and never built.
