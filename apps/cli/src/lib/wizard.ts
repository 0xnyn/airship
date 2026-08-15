/**
 * The interactive launcher, and the prompts `init` reuses.
 *
 * Running `airship` bare used to print the whole help and exit 1 — a wall of
 * text as the answer to "what do I do". At a real terminal it now asks the few
 * questions that matter and launches.
 *
 * What counts as "matters" differs by caller, which is what `WizardOptions` is
 * for: a bare launch settles only what it needs to start, while `init` is
 * writing a file meant to outlive the session and can afford to ask more.
 *
 * Every prompt is gated on a TTY at both ends by the caller. In a pipe or a CI
 * job there is nobody to answer, and a prompt there does not fail — it hangs,
 * which is the worst failure a CLI has.
 */

import {
  type AgentKind,
  checkAuth,
  listModels,
  type ModelProbeOptions,
} from "@airship/server";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { AGENTS, type MODES } from "./args";
import { detectTarget } from "./detect";
import { CliError, EXIT } from "./errors";
import { style } from "./terminal";

export interface WizardAnswers {
  agent: AgentKind;
  mode: (typeof MODES)[number];
  /** Absent means "whatever that backend picks", which is the common answer. */
  model?: string;
  safe: boolean;
  target: number;
}

export interface WizardOptions {
  /**
   * Ask which model, after the agent is chosen.
   *
   * Off by default, and the default is the point: a bare `airship` already asks
   * four questions before it launches, and a fifth paid on every start to
   * settle something most runs are happy to leave alone is a bad trade.
   * `airship init` turns it on, because that call is writing a file whose whole
   * purpose is to stop the flags being retyped.
   */
  askModel?: boolean;
  /**
   * Passed through to the model probe.
   *
   * The opencode probe *starts a server* — at `--opencode-path`, or against a
   * running one at `--opencode-url`, with `--opencode-config` applied. Called
   * without these it ignored every one of them, so a project that reaches
   * opencode any way but the default got a probe that asked the wrong thing and
   * then reported "not signed in" for it.
   */
  probe?: ModelProbeOptions;
}

/** Clack returns a symbol when the user hits Ctrl-C; treat it as an exit. */
function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(EXIT.interrupted);
  }
  return value;
}

const MAX_PORT = 65_535;

function validatePort(value: string | undefined): string | undefined {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return `A port is a whole number from 1 to ${MAX_PORT}.`;
  }
}

/**
 * Label each agent with whether it is actually usable.
 *
 * Offering a backend the user has not signed into, and only saying so after
 * they pick it and the launch fails, is the mistake this exists to avoid.
 */
async function agentOptions(): Promise<
  { hint: string; label: string; value: AgentKind }[]
> {
  return await Promise.all(
    AGENTS.map(async (agent) => {
      const auth = await checkAuth(agent as AgentKind);
      return {
        hint: auth.ok ? "ready" : "not available",
        label: agent,
        value: agent as AgentKind,
      };
    })
  );
}

/** The sentinel for "do not write a model", distinct from any real id. */
const MODEL_DEFAULT = "\u0000default";
/** The sentinel for "let me type one", distinct from any real id. */
const MODEL_CUSTOM = "\u0000custom";

/**
 * Which model, for the agent just chosen.
 *
 * Asks the backend rather than offering a list from memory, so what is on
 * screen is what that machine can actually run — `listModels` reports Claude's
 * account-scoped set and OpenCode's configured providers, and falls back to the
 * seed for Codex, which can enumerate nothing.
 *
 * Leaving it on the default is the first option and the likely answer, so it
 * costs one Enter. The escape hatch is last, for a model too new to be listed.
 */
async function askForModel(
  agent: AgentKind,
  cwd: string,
  opts: ModelProbeOptions = {}
): Promise<string | undefined> {
  const probe = spinner();
  probe.start(`Asking ${agent} which models it offers`);
  const group = await listModels(agent, cwd, opts);
  probe.stop(
    group.note
      ? `${agent}: ${group.note}`
      : `${agent} offers ${group.models.length} models`
  );

  const choice = unwrap(
    await select({
      message: "Which model?",
      options: [
        {
          hint: group.default ?? "whatever the backend picks",
          label: "default",
          value: MODEL_DEFAULT,
        },
        ...group.models.map((m) => ({
          hint: m.hint,
          label: m.label,
          value: m.id,
        })),
        { hint: "type an id", label: "something else…", value: MODEL_CUSTOM },
      ],
    })
  );

  if (choice === MODEL_DEFAULT) {
    return;
  }
  if (choice !== MODEL_CUSTOM) {
    return choice;
  }
  const typed = unwrap(
    await text({
      message: "Model id",
      placeholder:
        agent === "opencode" ? "anthropic/claude-sonnet-5" : "claude-opus-5",
      validate: (value) =>
        agent === "opencode" && value && !value.includes("/")
          ? "opencode needs the provider/model form, e.g. anthropic/claude-sonnet-5."
          : undefined,
    })
  );
  return typed?.trim() || undefined;
}

export async function runWizard(
  cwd: string,
  options: WizardOptions = {}
): Promise<WizardAnswers> {
  intro(style.magenta("◆ airship"));

  const probe = spinner();
  probe.start("Looking for your dev server");
  const detected = await detectTarget(cwd);
  const agents = await agentOptions();
  probe.stop(
    detected?.listening
      ? `Found a dev server on port ${detected.port}`
      : "No dev server running yet"
  );

  const target = unwrap(
    await text({
      defaultValue: detected ? String(detected.port) : undefined,
      message: "Which port is your dev server on?",
      placeholder: detected ? `${detected.port} — ${detected.reason}` : "3000",
      validate: validatePort,
    })
  );

  const agent = unwrap(
    await select({
      message: "Which agent should make the edits?",
      options: agents,
    })
  );

  // Straight after the agent, because the answer only means anything against
  // one: a model id is per backend, and asking before would have nothing to
  // list.
  const model = options.askModel
    ? await askForModel(agent, cwd, options.probe)
    : undefined;

  const mode = unwrap(
    await select({
      message: "Which surface?",
      options: [
        {
          hint: "one live frame per device size",
          label: "canvas",
          value: "canvas" as const,
        },
        {
          hint: "the editor inside your own page",
          label: "inline",
          value: "inline" as const,
        },
      ],
    })
  );

  const safe = unwrap(
    await confirm({
      initialValue: false,
      message: "Confine the agent to this project and cut network access?",
    })
  );

  outro(style.dim("Starting…"));
  return { agent, mode, model, safe, target: Number(target) };
}

/** The message a non-interactive bare invocation gets instead of a prompt. */
export function noTtyError(): CliError {
  return new CliError("No dev server specified", {
    exitCode: EXIT.usage,
    hint: "Pass --target <port>, or run airship at a terminal to be asked.",
  });
}
