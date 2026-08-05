import type { FileDiff } from "@airship/protocol";
import { cls, el } from "./dom";
import { ownerDocument } from "./realm";

/** One rendered line of a unified patch, carrying its real source position. */
export interface DiffLine {
  kind: "add" | "ctx" | "del" | "hunk";
  /** 1-based line in the file *after* the edit. Absent on deletions. */
  newLine?: number;
  /** 1-based line in the file *before* the edit. Absent on additions. */
  oldLine?: number;
  text: string;
}

/** A run of lines the user selected inside a rendered diff. */
export interface DiffSelection {
  from: number;
  text: string;
  to: number;
}

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` */
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Walk a unified patch, tracking real file line numbers.
 *
 * The numbers are the point: a comment pinned to "line 4 of the diff" is
 * useless to an agent, and the hunk header is the only place the true offsets
 * appear. Counts are optional in the format (`@@ -3 +3 @@` means one line), and
 * a created file starts at `-0,0`.
 */
export function parseUnifiedPatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const text of patch.split("\n")) {
    // `\ No newline at end of file` annotates the line above rather than being
    // one itself, and never carries a position.
    if (text.startsWith("\\")) {
      continue;
    }
    // The `Index:`/`===`/`---`/`+++` preamble names files the header already
    // shows. Only skipped *before* the first hunk: once inside one, a deleted
    // line reading `---` arrives as `----` and matches the same prefix, and
    // dropping it would shift every line number after it.
    if (
      !inHunk &&
      (text.startsWith("Index:") ||
        text.startsWith("===") ||
        text.startsWith("---") ||
        text.startsWith("+++"))
    ) {
      continue;
    }

    const hunk = HUNK_RE.exec(text);
    if (hunk) {
      inHunk = true;
      oldNo = Number.parseInt(hunk[1], 10);
      newNo = Number.parseInt(hunk[3], 10);
      out.push({ kind: "hunk", text });
      continue;
    }
    if (text.startsWith("+")) {
      out.push({ kind: "add", newLine: newNo, text });
      newNo += 1;
      continue;
    }
    if (text.startsWith("-")) {
      out.push({ kind: "del", oldLine: oldNo, text });
      oldNo += 1;
      continue;
    }
    // A context line advances both sides. Trailing empty strings from the
    // final newline are kept — they are real blank context.
    out.push({ kind: "ctx", newLine: newNo, oldLine: oldNo, text });
    newNo += 1;
    oldNo += 1;
  }
  return out;
}

/** The first line number the patch touches, for "open at the change". */
export function firstHunkLine(patch: string): number | undefined {
  for (const line of patch.split("\n")) {
    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      return Number.parseInt(hunk[3], 10);
    }
  }
}

/**
 * Render a single file's unified patch as colored lines.
 *
 * `header` is optional because the collapsed presentation puts the filename and
 * the +/− count in the disclosure's own header instead, and repeating it inside
 * the body reads as a mistake.
 */
export function renderDiff(
  diff: FileDiff,
  opts: { header?: boolean } = {}
): HTMLElement {
  const body = el("pre", { class: cls("diff-body") });
  for (const line of parseUnifiedPatch(diff.patch)) {
    const node = el("div", {
      class: `${cls("diff-line")} ${cls(`diff-${line.kind}`)}`,
      text: line.text,
    });
    // The anchors a comment pins itself to.
    if (line.newLine !== undefined) {
      node.dataset.new = String(line.newLine);
    }
    if (line.oldLine !== undefined) {
      node.dataset.old = String(line.oldLine);
    }
    body.append(node);
  }

  if (opts.header === false) {
    return el("div", { class: cls("diff-plain") }, [body]);
  }
  const header = el("div", { class: cls("diff-head") }, [
    el("span", { class: cls("diff-file"), text: diff.file }),
    el("span", {
      class: cls("diff-stat"),
      text: `+${diff.additions} −${diff.deletions}`,
    }),
  ]);
  return el("div", { class: cls("diff") }, [header, body]);
}

/**
 * The line range the user has selected inside `body`, if any.
 *
 * Both ends must be inside this diff — a selection that started in the prose
 * above and ran into the patch is not a comment on a range of code.
 *
 * Prefers post-edit line numbers, falling back to pre-edit ones so a selection
 * consisting only of deleted lines still resolves.
 */
export function selectedLineRange(body: HTMLElement): DiffSelection | null {
  const selection = ownerDocument(body)?.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const { anchorNode, focusNode } = selection;
  if (!(anchorNode && focusNode)) {
    return null;
  }
  if (!(body.contains(anchorNode) && body.contains(focusNode))) {
    return null;
  }

  const numbers: number[] = [];
  const texts: string[] = [];
  for (const line of Array.from(
    body.querySelectorAll<HTMLElement>(`.${cls("diff-line")}`)
  )) {
    if (!selection.containsNode(line, true)) {
      continue;
    }
    const raw = line.dataset.new ?? line.dataset.old;
    if (raw === undefined) {
      // A hunk header inside the selection contributes text but no position.
      continue;
    }
    numbers.push(Number.parseInt(raw, 10));
    texts.push(line.textContent ?? "");
  }
  if (numbers.length === 0) {
    return null;
  }
  return {
    from: Math.min(...numbers),
    text: texts.join("\n"),
    to: Math.max(...numbers),
  };
}
