/**
 * Terminal styling and capability detection.
 *
 * Colour is one global switch, set exactly once per run before anything prints.
 * The `style` helpers read that live switch and return the raw string when it is
 * off, so `--json` output and piped output stay byte-identical to what a test
 * asserts — no ANSI can leak into a value someone is about to parse.
 */

import pc from "picocolors";

let active = pc.createColors(false);
let enabled = false;

export function setColorEnabled(value: boolean): void {
  enabled = value;
  active = pc.createColors(value);
}

export function colorEnabled(): boolean {
  return enabled;
}

/**
 * Whether to colourize. `--json` and NO_COLOR force plain output, FORCE_COLOR
 * forces colour, and otherwise it takes a real TTY on stdout. Machine mode
 * outranks FORCE_COLOR deliberately: a caller parsing our stdout has a stronger
 * claim than an env var it probably did not set itself.
 */
export function shouldColor(opts: { json?: boolean } = {}): boolean {
  if (opts.json || process.env.NO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

/**
 * A real human at both ends. Gates every prompt: with this false we must print
 * and exit rather than ask, or a CI job hangs forever on an invisible question.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export const style = {
  bold: (s: string): string => active.bold(s),
  cyan: (s: string): string => active.cyan(s),
  dim: (s: string): string => active.dim(s),
  gray: (s: string): string => active.gray(s),
  green: (s: string): string => active.green(s),
  magenta: (s: string): string => active.magenta(s),
  red: (s: string): string => active.red(s),
  yellow: (s: string): string => active.yellow(s),
};

/** Chrome — banners, prompts, warnings, errors. Never stdout: that is data. */
export function note(text: string): void {
  process.stderr.write(text);
}

/** Data — the launch record, `--json` payloads, help. The parseable channel. */
export function out(text: string): void {
  process.stdout.write(text);
}
