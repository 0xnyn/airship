/**
 * Help rendering.
 *
 * Columns are measured from the specs rather than typed by hand, which is what
 * the old help string could not do — it had drifted a character out of
 * alignment and nothing could notice. Padding is computed on the plain label and
 * colour applied to the visible content only, so ANSI never skews a column.
 */

import type { FlagSpec } from "./args";
import { GROUP_ORDER, specsFor } from "./args";
import { style } from "./terminal";

const MIN_WIDTH = 60;
const MAX_WIDTH = 100;
const INDENT = "  ";
/** Past this the description reads as a second column of noise, so it wraps. */
const MAX_GUTTER = 28;
const MIN_TEXT_WIDTH = 20;
const WHITESPACE = /\s+/;

function terminalWidth(): number {
  const columns = process.stdout.columns ?? 80;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns));
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(WHITESPACE).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

interface Row {
  /** Uncoloured, for measuring. */
  plain: string;
  /** Coloured, for printing. Same visible width as `plain`. */
  pretty: string;
  text: string;
}

function gutterFor(rows: readonly Row[]): number {
  const widest = Math.max(...rows.map((row) => row.plain.length));
  return Math.min(widest, MAX_GUTTER) + 2;
}

function renderRows(
  rows: readonly Row[],
  width: number,
  gutter: number
): string[] {
  const textWidth = Math.max(MIN_TEXT_WIDTH, width - gutter - INDENT.length);
  const out: string[] = [];

  for (const row of rows) {
    const body = wrap(row.text, textWidth);
    const continuation = `${INDENT}${" ".repeat(gutter)}`;
    if (row.plain.length > gutter - 2) {
      // Too wide to share a line — give the label its own rather than pushing
      // every other row's gutter out to match it.
      out.push(`${INDENT}${row.pretty}`);
      out.push(...body.map((line) => `${continuation}${line}`));
      continue;
    }
    const pad = " ".repeat(gutter - row.plain.length);
    out.push(`${INDENT}${row.pretty}${pad}${body[0] ?? ""}`);
    out.push(...body.slice(1).map((line) => `${continuation}${line}`));
  }
  return out;
}

/** `-t, --target <port>` — the four leading spaces keep long flags aligned. */
function flagRow(spec: FlagSpec): Row {
  const plainAlias = spec.alias ? `-${spec.alias}, ` : "    ";
  const prettyAlias = spec.alias ? `${style.cyan(`-${spec.alias}`)}, ` : "    ";
  const hint = spec.hint ? ` ${spec.hint}` : "";
  return {
    plain: `${plainAlias}--${spec.name}${hint}`,
    pretty: `${prettyAlias}${style.cyan(`--${spec.name}`)}${spec.hint ? ` ${style.dim(spec.hint)}` : ""}`,
    text: spec.defaultHint
      ? `${spec.help} (default: ${spec.defaultHint})`
      : spec.help,
  };
}

export interface HelpSection {
  body: string;
  title: string;
}

export interface CommandHelp {
  examples?: readonly { command: string; note?: string }[];
  /** Flag names, resolved against the registry. */
  flags: readonly string[];
  /** Trailing prose — Sandboxing, Backends. */
  sections?: readonly HelpSection[];
  subcommands?: readonly { name: string; summary: string }[];
  tagline: string;
  usage: readonly string[];
}

export function renderHelp(help: CommandHelp): string {
  const width = terminalWidth();
  const lines: string[] = ["", help.tagline, "", style.bold("USAGE")];

  for (const line of help.usage) {
    lines.push(`${INDENT}${style.dim("$")} ${line}`);
  }

  if (help.subcommands?.length) {
    const rows = help.subcommands.map((cmd) => ({
      plain: cmd.name,
      pretty: style.cyan(cmd.name),
      text: cmd.summary,
    }));
    lines.push(
      "",
      style.bold("COMMANDS"),
      ...renderRows(rows, width, gutterFor(rows))
    );
  }

  // One gutter across every group, so the eye tracks a single column down the
  // whole page instead of re-finding it at each heading.
  const specs = specsFor(help.flags);
  const gutter = gutterFor(specs.map(flagRow));
  for (const group of GROUP_ORDER) {
    const inGroup = specs.filter((spec) => spec.group === group);
    if (inGroup.length === 0) {
      continue;
    }
    lines.push(
      "",
      style.bold(`${group} FLAGS`),
      ...renderRows(inGroup.map(flagRow), width, gutter)
    );
  }

  if (help.examples?.length) {
    lines.push("", style.bold("EXAMPLES"));
    for (const example of help.examples) {
      if (example.note) {
        lines.push(`${INDENT}${style.dim(`# ${example.note}`)}`);
      }
      lines.push(`${INDENT}${style.dim("$")} ${example.command}`);
    }
  }

  for (const section of help.sections ?? []) {
    lines.push("", style.bold(section.title.toUpperCase()));
    const paragraphs = section.body.trim().split("\n\n");
    for (const [index, paragraph] of paragraphs.entries()) {
      lines.push(
        ...wrap(paragraph, width - INDENT.length).map(
          (line) => `${INDENT}${line}`
        )
      );
      if (index < paragraphs.length - 1) {
        lines.push("");
      }
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
