import { beforeAll, describe, expect, it } from "vitest";
import { FLAGS, GROUP_ORDER } from "./args";
import { setColorEnabled } from "./terminal";
import { renderHelp } from "./usage";

/** Indent, a dashed label, then the gutter that precedes a description. */
const FLAG_ROW_GUTTER = /^ {2}(-|\s{4}--)\S.*? {2,}(?=\S)/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is the point
const ANSI = /\[/;

const HELP = {
  examples: [{ command: "airship --target 3000", note: "the usual case" }],
  flags: ["target", "port", "opencode-config", "safe", "help"],
  sections: [{ body: "Some prose.\n\nA second paragraph.", title: "Notes" }],
  subcommands: [{ name: "doctor", summary: "Check the environment." }],
  tagline: "airship — a tagline",
  usage: ["airship --target <port>"],
};

/**
 * Where the description starts on each flag row that has one, i.e. the column
 * every description is supposed to share.
 */
function descriptionColumns(text: string): number[] {
  const columns: number[] = [];
  for (const line of text.split("\n")) {
    const match = FLAG_ROW_GUTTER.exec(line);
    if (match) {
      columns.push(match[0].length);
    }
  }
  return columns;
}

describe("renderHelp", () => {
  beforeAll(() => {
    // Rendered with colour off so the assertions measure characters, not ANSI.
    setColorEnabled(false);
    process.stdout.columns = 80;
  });

  it("emits no ANSI when colour is off", () => {
    expect(renderHelp(HELP)).not.toMatch(ANSI);
  });

  // The defect the old hand-padded help string had shipped with, and which
  // nothing could detect: one flag a character too wide broke the column.
  it("aligns every description to one column", () => {
    const columns = descriptionColumns(renderHelp(HELP));
    expect(columns.length).toBeGreaterThan(1);
    expect(new Set(columns).size).toBe(1);
  });

  it("keeps that column across every group, not just within one", () => {
    const columns = descriptionColumns(
      renderHelp({ ...HELP, flags: FLAGS.map((flag) => flag.name) })
    );
    expect(columns.length).toBeGreaterThan(10);
    expect(new Set(columns).size).toBe(1);
  });

  it("never exceeds the terminal width", () => {
    const lines = renderHelp(HELP).split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      80
    );
  });

  it("renders every requested section", () => {
    const text = renderHelp(HELP);
    expect(text).toContain("USAGE");
    expect(text).toContain("COMMANDS");
    expect(text).toContain("EXAMPLES");
    expect(text).toContain("NOTES");
    expect(text).toContain("# the usual case");
    expect(text).toContain("doctor");
  });

  it("shows the default alongside the description", () => {
    expect(renderHelp(HELP)).toContain("(default:");
  });

  it("omits a group with no flags in this command", () => {
    // The fixture has core, sandbox, backend and global flags but no agent one.
    expect(renderHelp(HELP)).not.toContain("AGENT FLAGS");
    expect(renderHelp(HELP)).toContain("BACKEND FLAGS");
  });

  it("groups flags in the declared order", () => {
    const text = renderHelp({
      ...HELP,
      flags: FLAGS.map((flag) => flag.name),
    });
    const positions = GROUP_ORDER.map((group) =>
      text.indexOf(`${group} FLAGS`)
    );
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("stays within width at a narrow terminal", () => {
    process.stdout.columns = 60;
    const lines = renderHelp({
      ...HELP,
      flags: FLAGS.map((flag) => flag.name),
    }).split("\n");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      60
    );
    process.stdout.columns = 80;
  });
});

describe("the flag registry", () => {
  it("gives every flag a description", () => {
    expect(FLAGS.filter((flag) => !flag.help)).toEqual([]);
  });

  it("has no duplicate names", () => {
    const names = FLAGS.map((flag) => flag.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no duplicate short aliases", () => {
    const aliases = FLAGS.flatMap((flag) => flag.alias ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("gives every value-taking flag a placeholder", () => {
    const missing = FLAGS.filter(
      (flag) => flag.type === "string" && !flag.hint
    );
    expect(missing).toEqual([]);
  });
});
