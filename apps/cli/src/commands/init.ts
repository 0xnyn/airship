/**
 * `airship init` — write the config file so the flags stop being retyped.
 *
 * Shares the wizard's prompts, so the questions and their detection are asked
 * one way only. Writes JSON rather than a `.ts` module deliberately: the file is
 * read by the CLI before anything is compiled, and a config that needs a build
 * step to be read is a config that can break the tool that reads it.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import { defineCommand } from "citty";
import { argsFor, assertKnownFlags, GLOBAL_FLAGS } from "../lib/args";
import { asBoolean, CONFIG_FILENAME } from "../lib/config";
import { CliError, EXIT } from "../lib/errors";
import { resolveSettings } from "../lib/settings";
import {
  isInteractive,
  note,
  setColorEnabled,
  shouldColor,
  style,
} from "../lib/terminal";
import { runWizard } from "../lib/wizard";

export const INIT_FLAGS: readonly string[] = ["cwd", ...GLOBAL_FLAGS];

export const init = defineCommand({
  args: argsFor(INIT_FLAGS),
  meta: {
    description: `Create an ${CONFIG_FILENAME} for this project.`,
    name: "init",
  },
  run: async ({ args, rawArgs }) => {
    assertKnownFlags(rawArgs, INIT_FLAGS);
    const { cwd, settings } = resolveSettings({
      args,
      names: INIT_FLAGS,
      rawArgs,
    });
    setColorEnabled(shouldColor({ json: asBoolean(settings, "json") }));

    if (!isInteractive()) {
      throw new CliError("`airship init` needs a terminal", {
        exitCode: EXIT.usage,
        hint: `Write ${CONFIG_FILENAME} by hand instead — see \`airship --help\` for the settings it takes.`,
      });
    }

    const path = join(cwd, CONFIG_FILENAME);
    if (existsSync(path)) {
      const replace = await confirm({
        initialValue: false,
        message: `${CONFIG_FILENAME} already exists. Replace it?`,
      });
      if (isCancel(replace) || !replace) {
        throw new CliError("Left the existing config alone", {
          exitCode: EXIT.interrupted,
        });
      }
    }

    const answers = await runWizard(cwd);
    // Only the answers worth persisting. `safe: false` is the default, so
    // writing it would state a posture the user did not actually choose.
    const config: Record<string, unknown> = {
      agent: answers.agent,
      mode: answers.mode,
      target: answers.target,
    };
    if (answers.safe) {
      config.safe = true;
    }

    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    note(
      `\n  ${style.green("✓")} wrote ${style.cyan(relative(process.cwd(), path) || CONFIG_FILENAME)}\n` +
        `  ${style.dim("Run `airship` with no flags from now on.")}\n\n`
    );
  },
});
