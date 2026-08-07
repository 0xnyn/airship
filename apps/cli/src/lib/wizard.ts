/**
 * The interactive launcher, and the prompts `init` reuses.
 *
 * Running `airship` bare used to print the whole help and exit 1 — a wall of
 * text as the answer to "what do I do". At a real terminal it now asks the three
 * questions that matter and launches.
 *
 * Every prompt is gated on a TTY at both ends by the caller. In a pipe or a CI
 * job there is nobody to answer, and a prompt there does not fail — it hangs,
 * which is the worst failure a CLI has.
 */

import { type AgentKind, checkAuth } from "@airship/server";
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
  safe: boolean;
  target: number;
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

export async function runWizard(cwd: string): Promise<WizardAnswers> {
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
  return { agent, mode, safe, target: Number(target) };
}

/** The message a non-interactive bare invocation gets instead of a prompt. */
export function noTtyError(): CliError {
  return new CliError("No dev server specified", {
    exitCode: EXIT.usage,
    hint: "Pass --target <port>, or run airship at a terminal to be asked.",
  });
}
