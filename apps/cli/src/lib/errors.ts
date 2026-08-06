/**
 * The CLI's error taxonomy.
 *
 * Every failure a user can cause is a `CliError` carrying the one thing a bare
 * message never does: what to do next. The old CLI printed a raw stack trace for
 * an unknown flag, which told the user nothing and looked like a crash.
 */

import { style } from "./terminal";

/**
 * Exit codes, fixed so scripts can branch on them.
 *
 * `usage` is 2 because that is what every getopt-descended tool returns for a
 * malformed command line, and `interrupted` is 130 (128 + SIGINT) because that
 * is what a shell reports when the user presses Ctrl-C.
 */
export const EXIT = {
  fail: 1,
  interrupted: 130,
  unknownCommand: 127,
  usage: 2,
} as const;

export class CliError extends Error {
  readonly exitCode: number;
  /** A concrete next action — a command to run, a flag to pass. */
  readonly hint?: string;

  constructor(
    message: string,
    opts: { cause?: unknown; exitCode?: number; hint?: string } = {}
  ) {
    super(
      message,
      opts.cause === undefined ? undefined : { cause: opts.cause }
    );
    this.name = "CliError";
    this.exitCode = opts.exitCode ?? EXIT.fail;
    this.hint = opts.hint;
  }
}

/**
 * Print a failure and return the code to exit with.
 *
 * Everything goes to stderr so a caller piping stdout gets a clean stream even
 * when the run dies. The stack is withheld unless asked for: for the errors
 * users actually hit it is noise, and for the ones they do not it is the first
 * thing `--debug` should hand them.
 */
export function reportError(
  err: unknown,
  opts: { debug?: boolean } = {}
): number {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${style.red(`✗ ${message}`)}\n`);

  if (err instanceof CliError && err.hint) {
    process.stderr.write(`${style.dim(`↳ ${err.hint}`)}\n`);
  }

  // An error we did not raise ourselves is a bug, not a user mistake, so say so
  // rather than letting it read like something they typed wrong.
  if (!(err instanceof CliError)) {
    process.stderr.write(
      `${style.dim("↳ This looks like a bug in airship. Re-run with --debug for the stack.")}\n`
    );
  }

  if (opts.debug && err instanceof Error && err.stack) {
    process.stderr.write(`\n${style.dim(err.stack)}\n`);
  }

  return err instanceof CliError ? err.exitCode : EXIT.fail;
}

function distance(a: string, b: string): number {
  // Single-row Levenshtein: only the previous row is ever needed, and these are
  // flag names, so the whole table would be wasted allocation.
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(
        (row[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/**
 * Scale the tolerance to the length of what was typed, so `--targt` matches
 * `--target` but a word that is simply not a flag gets no suggestion at all.
 * A confidently wrong "did you mean" is worse than none.
 */
function threshold(length: number): number {
  return Math.max(2, Math.floor(length / 3));
}

export function closest(
  input: string,
  candidates: readonly string[]
): string | undefined {
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const score = distance(input, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= threshold(input.length) ? best : undefined;
}

/** "Did you mean --target?", or nothing when no candidate is close enough. */
export function didYouMean(
  input: string,
  candidates: readonly string[],
  prefix = ""
): string | undefined {
  const match = closest(input, candidates);
  return match ? `Did you mean ${prefix}${match}?` : undefined;
}
