/**
 * The one place a flag is described.
 *
 * Each spec feeds three consumers — citty's parser, the help renderer, and the
 * validators — so a flag cannot exist in the parser but be missing from help, or
 * drift out of alignment the way the old hand-padded help string did.
 *
 * citty is the parsing layer, not the validation layer. Three things it does not
 * do that a user notices immediately, and that we therefore do here:
 *
 *  - It accepts unknown flags silently (`--targt 3000` parses as `targt: true`
 *    with a stray `3000` positional), so `assertKnownFlags` rejects them.
 *  - It calls `node:util parseArgs` without `multiple`, so a repeated flag keeps
 *    only its last occurrence. `collectRepeated` reads those from rawArgs.
 *  - Its enum failures carry hardcoded ANSI, which would corrupt `--json`, so
 *    enums are declared as strings here and checked by `requireEnum`.
 */

import type { ArgsDef } from "citty";
import { CliError, didYouMean, EXIT } from "./errors";

export const AGENTS = ["claude", "codex", "opencode"] as const;
export const EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
/** The user-facing surface names. `canvas` is the protocol's `shell`. */
export const MODES = ["canvas", "inline"] as const;

/**
 * Help sections, rendered in this order. GLOBAL is last because it is the same
 * on every command and the reader is looking for the command's own flags first.
 */
export const GROUP_ORDER = [
  "CORE",
  "AGENT",
  "SANDBOX",
  "BACKEND",
  "GLOBAL",
] as const;

export type FlagGroup = (typeof GROUP_ORDER)[number];

export interface FlagSpec {
  alias?: string;
  /** Shown in help as `(default: …)`; the value itself is applied downstream. */
  defaultHint?: string;
  group: FlagGroup;
  /** One line, unwrapped — the renderer measures and wraps it to the terminal. */
  help: string;
  /** Placeholder after the flag name: `--target <port>`. */
  hint?: string;
  /** Repeatable; read from rawArgs rather than the parsed args. */
  multiple?: boolean;
  name: string;
  type: "boolean" | "string";
  values?: readonly string[];
}

export const FLAGS: readonly FlagSpec[] = [
  {
    alias: "t",
    group: "CORE",
    help: "Port your dev server is already running on. Detected from your package.json when omitted.",
    hint: "<port>",
    name: "target",
    type: "string",
  },
  {
    alias: "p",
    defaultHint: "target + 1",
    group: "CORE",
    help: "Port for the airship proxy.",
    hint: "<port>",
    name: "port",
    type: "string",
  },
  {
    defaultHint: "current directory",
    group: "CORE",
    help: "Project root for edits.",
    hint: "<dir>",
    name: "cwd",
    type: "string",
  },
  {
    defaultHint: "canvas",
    group: "CORE",
    help: "Editor surface. canvas puts your app on a pannable canvas, one live frame per device size; inline injects the editor into your own page. Switchable from the editor too.",
    hint: "<name>",
    name: "mode",
    type: "string",
    values: MODES,
  },
  {
    group: "CORE",
    help: "Start your dev server with this command and stop it when airship exits, instead of running it yourself in another terminal.",
    hint: "<command>",
    name: "exec",
    type: "string",
  },
  {
    group: "CORE",
    help: "Open the editor in your browser once it is listening.",
    name: "open",
    type: "boolean",
  },
  {
    defaultHint: "off",
    group: "CORE",
    help: "Keep your app's Content-Security-Policy on editor surfaces instead of stripping it. Framing headers (X-Frame-Options) are always stripped; a kept CSP can block the editor's own scripts.",
    name: "keep-csp",
    type: "boolean",
  },
  {
    alias: "a",
    defaultHint: "claude",
    group: "AGENT",
    // Comma-joined rather than `a|b|c`: the pipe form has no break point, so a
    // narrow terminal cannot wrap it and the line runs past the edge. The
    // pipe form still belongs in the placeholder, where it is short.
    help: `Coding agent: ${AGENTS.join(", ")}.`,
    hint: "<name>",
    name: "agent",
    type: "string",
    values: AGENTS,
  },
  {
    alias: "m",
    defaultHint: "the agent's own default",
    group: "AGENT",
    help: "Model id for whichever agent runs. Per-backend flags outrank it.",
    hint: "<id>",
    name: "model",
    type: "string",
  },
  {
    group: "AGENT",
    help: `Reasoning effort: ${EFFORTS.join(", ")}.`,
    hint: "<level>",
    name: "effort",
    type: "string",
    values: EFFORTS,
  },
  {
    defaultHint: "24",
    group: "AGENT",
    help: "Cap agent turns per edit (claude only).",
    hint: "<n>",
    name: "max-turns",
    type: "string",
  },
  {
    group: "AGENT",
    help: "Stop an edit if it exceeds this cost in USD (claude only).",
    hint: "<usd>",
    name: "max-budget",
    type: "string",
  },
  {
    group: "AGENT",
    help: "Auto-commit each accepted edit (Conventional Commits).",
    name: "commit",
    type: "boolean",
  },
  {
    defaultHint: "off",
    group: "SANDBOX",
    help: "Confine edits to the project directory and cut network access. See Sandboxing below.",
    name: "safe",
    type: "boolean",
  },
  {
    defaultHint: "--model, then the agent's own",
    group: "BACKEND",
    help: "Model for the claude backend. Takes an alias or a full id.",
    hint: "<id>",
    name: "claude-model",
    type: "string",
  },
  {
    defaultHint: "--model, then the agent's own",
    group: "BACKEND",
    help: "Model for the codex backend.",
    hint: "<id>",
    name: "codex-model",
    type: "string",
  },
  {
    defaultHint: "--model, then the agent's own",
    group: "BACKEND",
    help: "Model for the opencode backend. Needs the provider/model form.",
    hint: "<provider/model>",
    name: "opencode-model",
    type: "string",
  },
  {
    defaultHint: "bundled",
    group: "BACKEND",
    help: "Path to the `codex` binary.",
    hint: "<path>",
    name: "codex-path",
    type: "string",
  },
  {
    group: "BACKEND",
    help: "Extra `codex --config` pair; repeatable.",
    hint: "<k=v>",
    multiple: true,
    name: "codex-config",
    type: "string",
  },
  {
    defaultHint: "found on PATH",
    group: "BACKEND",
    help: "Path to the `opencode` binary.",
    hint: "<path>",
    name: "opencode-path",
    type: "string",
  },
  {
    group: "BACKEND",
    help: "Attach to a running `opencode serve` instead of starting one.",
    hint: "<url>",
    name: "opencode-url",
    type: "string",
  },
  {
    defaultHint: "its own",
    group: "BACKEND",
    help: "Run as a named opencode agent.",
    hint: "<name>",
    name: "opencode-agent",
    type: "string",
  },
  {
    group: "BACKEND",
    help: "JSON file merged into the opencode server config.",
    hint: "<file>",
    name: "opencode-config",
    type: "string",
  },
  {
    group: "GLOBAL",
    help: "Machine-readable JSON on stdout, no colour and no banner.",
    name: "json",
    type: "boolean",
  },
  {
    alias: "q",
    group: "GLOBAL",
    help: "Suppress the launch banner. Warnings still print.",
    name: "quiet",
    type: "boolean",
  },
  {
    group: "GLOBAL",
    help: "Print stack traces on failure.",
    name: "debug",
    type: "boolean",
  },
  {
    alias: "h",
    group: "GLOBAL",
    help: "Show this help.",
    name: "help",
    type: "boolean",
  },
  {
    alias: "v",
    group: "GLOBAL",
    help: "Print the version.",
    name: "version",
    type: "boolean",
  },
];

const BY_NAME = new Map(FLAGS.map((flag) => [flag.name, flag]));
const KEBAB_SEGMENT = /-([a-z])/g;
const LEADING_DASHES = /^--(no-)?/;

/** Flags every command accepts, so they are declared in exactly one place. */
export const GLOBAL_FLAGS: readonly string[] = FLAGS.filter(
  (flag) => flag.group === "GLOBAL"
).map((flag) => flag.name);

export function specFor(name: string): FlagSpec {
  const spec = BY_NAME.get(name);
  if (!spec) {
    throw new Error(`unknown flag spec: ${name}`);
  }
  return spec;
}

export function specsFor(names: readonly string[]): FlagSpec[] {
  return names.map(specFor);
}

/** Turn the named specs into the shape citty's `defineCommand` wants. */
export function argsFor(names: readonly string[]): ArgsDef {
  const out: ArgsDef = {};
  for (const spec of specsFor(names)) {
    out[spec.name] = {
      ...(spec.alias ? { alias: spec.alias } : {}),
      description: spec.help,
      type: spec.type,
      ...(spec.hint ? { valueHint: spec.hint } : {}),
    };
  }
  return out;
}

/** Every spelling of a flag the parser will accept, for the unknown-flag check. */
function knownTokens(specs: readonly FlagSpec[]): Set<string> {
  const known = new Set<string>();
  for (const spec of specs) {
    known.add(`--${spec.name}`);
    // citty aliases every flag to its camelCase form, so `--max-turns` and
    // `--maxTurns` both parse and both have to be recognised here.
    known.add(
      `--${spec.name.replace(KEBAB_SEGMENT, (_, c: string) => c.toUpperCase())}`
    );
    if (spec.type === "boolean") {
      known.add(`--no-${spec.name}`);
    }
    if (spec.alias) {
      known.add(`-${spec.alias}`);
    }
  }
  return known;
}

const SHORT_ALIASES = (specs: readonly FlagSpec[]): Set<string> =>
  new Set(specs.flatMap((spec) => (spec.alias ? [spec.alias] : [])));

/**
 * Reject a flag this command does not have, with a suggestion when one is close.
 *
 * Worth doing by hand because the alternative is silence: citty's parser is
 * permissive, so a typo'd flag reaches the command as a stray boolean and the
 * run proceeds with the wrong settings.
 */
export function assertKnownFlags(
  rawArgs: readonly string[],
  names: readonly string[]
): void {
  const specs = specsFor(names);
  const known = knownTokens(specs);
  const shorts = SHORT_ALIASES(specs);
  // Compared bare and re-dashed in the message: measuring `targt` against
  // `--target` costs two edits of pure punctuation and pushes every real typo
  // past the threshold.
  const suggestions = specs.map((spec) => spec.name);

  for (const raw of rawArgs) {
    if (raw === "--") {
      // Everything after `--` is deliberately not ours to interpret.
      return;
    }
    if (!raw.startsWith("-") || raw === "-") {
      continue;
    }
    const token = raw.split("=")[0] ?? raw;

    if (known.has(token)) {
      continue;
    }
    if (!token.startsWith("--")) {
      // A single-dash token may be a bundle of short flags (`-tp`); it is only
      // unknown if some character in it is.
      const chars = [...token.slice(1)];
      const bad = chars.find((c) => !shorts.has(c));
      if (!bad) {
        continue;
      }
      throw new CliError(`Unknown flag -${bad}`, {
        exitCode: EXIT.usage,
        hint: "Run `airship --help` to see every flag.",
      });
    }

    throw new CliError(`Unknown flag ${token}`, {
      exitCode: EXIT.usage,
      hint:
        didYouMean(token.replace(LEADING_DASHES, ""), suggestions, "--") ??
        "Run `airship --help` to see every flag.",
    });
  }
}

/**
 * Read a repeatable flag straight from argv.
 *
 * citty hands us only the last occurrence, and silently dropping every earlier
 * `--codex-config` would change what the agent is configured with — the kind of
 * bug that only shows up as the model behaving oddly.
 */
export function collectRepeated(
  rawArgs: readonly string[],
  name: string
): string[] {
  const values: string[] = [];
  const long = `--${name}`;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const raw = rawArgs[i];
    if (raw === "--") {
      break;
    }
    if (raw === long) {
      const next = rawArgs[i + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new CliError(`${long} needs a value`, {
          exitCode: EXIT.usage,
          hint: `Pass it as ${long} key=value.`,
        });
      }
      values.push(next);
      // Skip the value we just consumed, so it is not re-read as a flag.
      i += 1;
    } else if (raw?.startsWith(`${long}=`)) {
      values.push(raw.slice(long.length + 1));
    }
  }
  return values;
}

export function requireEnum(value: string, name: string): string {
  const spec = specFor(name);
  const allowed = spec.values ?? [];
  if (allowed.includes(value)) {
    return value;
  }
  throw new CliError(`Invalid --${name} '${value}'`, {
    exitCode: EXIT.usage,
    hint:
      didYouMean(value, allowed, "") ?? `Use one of: ${allowed.join(", ")}.`,
  });
}

/**
 * An opencode model reference, which must name its provider.
 *
 * `modelRefFor` splits on the first slash and drops an id it cannot attribute,
 * so `--opencode-model sonnet` would be silently ignored and the turn would run
 * on the server's default — the user having explicitly asked for something else.
 *
 * A hard error is right *here* and wrong for `--model`, and the difference is
 * which backend the flag is aimed at. This one names opencode, so a bare id can
 * only be a mistake. `--model` applies to whichever agent the picker lands on,
 * where a bare id is correct for two of the three, so that one keeps the launch
 * warning in `banner.ts` instead.
 */
export function requireModelRef(value: string, name: string): string {
  const [provider, ...rest] = value.split("/");
  if (provider && rest.length > 0 && rest.every(Boolean)) {
    return value;
  }
  throw new CliError(`Invalid --${name} '${value}'`, {
    exitCode: EXIT.usage,
    hint: `opencode resolves a model through its provider, so it needs the provider/model form — try 'anthropic/${value}' or run \`opencode models\` to list what you have configured.`,
  });
}

const MAX_PORT = 65_535;

export function requirePort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new CliError(`Invalid --${name} '${value}'`, {
      exitCode: EXIT.usage,
      hint: `A port is a whole number from 1 to ${MAX_PORT}.`,
    });
  }
  return port;
}

export function requireInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(`Invalid --${name} '${value}'`, {
      exitCode: EXIT.usage,
      hint: "Expected a whole number of 1 or more.",
    });
  }
  return parsed;
}

/** `--max-budget` never had a NaN check, so `--max-budget lots` meant no cap. */
export function requireAmount(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`Invalid --${name} '${value}'`, {
      exitCode: EXIT.usage,
      hint: "Expected a positive amount in USD, e.g. --max-budget 2.50.",
    });
  }
  return parsed;
}
