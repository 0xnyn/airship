import type { Editor, GitHealth, JobDiffBundle } from "@airship/protocol";
import { firstHunkLine, renderDiff, selectedLineRange } from "../diff-view";
import { clear, cls, el } from "../dom";
import { icon } from "../icons";
import { createMenu, type MenuEntry } from "../popover-host";
import { disclosure } from "./disclosure";
import { renderMarkdown } from "./markdown";
import { type TimelineView, timelineView } from "./timeline";

/** Callbacks a finished assistant turn can offer. Omit any to hide its entry. */
export interface AssistantActions {
  /**
   * Whether git works, from the daemon.
   *
   * Present for the git-backed rows, which are shown greyed with the reason
   * rather than hidden: a Commit that is simply missing reads as a bug, and a
   * Commit that fails after the click has already cost the user the click.
   * Absent is treated as healthy, which is what an older daemon that never
   * sends `git:health` should look like.
   */
  git?: GitHealth;
  onBranch?: () => void;
  onComment?: (file: string, body: HTMLElement) => void;
  onCommit?: (push: boolean) => void;
  onCopyPath?: (file: string) => void;
  onCreatePr?: () => void;
  onFollowUp?: (text: string) => void;
  onOpenIn?: (editor: Editor, file: string, line?: number) => void;
  onUndo?: () => void;
}

/**
 * A single assistant turn. The timeline is append-only and never cleared for
 * the life of the turn — that is the whole point. The result slot below it is
 * what `fillAssistant` rewrites, so finishing a job no longer destroys the
 * record of how it got there.
 */
export interface AssistantTurn {
  /** Where `fillAssistant` writes. Safe to clear. */
  result: HTMLElement;
  root: HTMLElement;
  /** Live status pill; removed once the turn finishes. */
  status: HTMLElement;
  timeline: TimelineView;
}

export function userBubble(text: string): HTMLElement {
  return el("div", { class: `${cls("msg")} ${cls("msg-user")}` }, [
    el("div", { class: cls("msg-body"), text }),
  ]);
}

/** An assistant bubble: activity timeline, live status, then the result. */
export function assistantTurn(): AssistantTurn {
  const timeline = timelineView();
  const status = el("div", { class: cls("turn-status") }, [
    el("span", { class: cls("dot") }),
    el("span", { text: "Starting…" }),
  ]);
  const result = el("div", { class: cls("turn-result") });
  const root = el("div", { class: `${cls("msg")} ${cls("msg-assistant")}` }, [
    timeline.root,
    status,
    result,
  ]);
  return { result, root, status, timeline };
}

export function setTurnStatus(status: HTMLElement, text: string): void {
  clear(status);
  status.append(el("span", { class: cls("dot") }), el("span", { text }));
}

/**
 * Populate a turn's *result slot* with the finished job — markdown summary,
 * meta, diffs, follow-ups, and actions.
 *
 * `target` is the `.turn-result` node, not the bubble root: this function
 * clears what it is given, and pointing it at the root is what used to wipe the
 * streamed activity on every completion.
 */
export function fillAssistant(
  target: HTMLElement,
  bundle: JobDiffBundle,
  actions: AssistantActions
): void {
  clear(target);
  const bubble = target.parentElement ?? target;
  bubble.classList.remove(cls("msg-err"));
  if (bundle.status !== "done") {
    bubble.classList.add(cls("msg-err"));
    target.append(
      el("div", {
        class: cls("msg-body"),
        text: bundle.error || "Edit failed.",
      })
    );
    return;
  }

  target.append(
    el("div", {
      class: cls("msg-body"),
      html: renderMarkdown(bundle.summary || "Edit applied."),
    })
  );

  // The change counts always render; only the price is conditional. Codex
  // reports tokens but no cost, as does Claude under subscription auth, and
  // gating the whole line on a dollar figure silently dropped the file and
  // ±line counts along with it.
  const cost = bundle.usage?.costUsd;
  if (bundle.filesChanged || typeof cost === "number") {
    target.append(
      el("div", {
        class: cls("meta"),
        text:
          `${bundle.filesChanged} file(s) · +${bundle.additions} −${bundle.deletions}` +
          (typeof cost === "number" ? ` · $${cost.toFixed(4)}` : ""),
      })
    );
  }

  if (bundle.diffs?.length) {
    const diffs = el("div", { class: cls("diffs") });
    for (const d of bundle.diffs) {
      diffs.append(fileDiff(d, bundle, actions));
    }
    target.append(diffs);
  }

  if (hasTurnActions(actions)) {
    target.append(
      el("div", { class: cls("actions") }, [turnMenuButton(bundle, actions)])
    );
  }

  const { onFollowUp } = actions;
  if (bundle.followUps?.length && onFollowUp) {
    const follow = el("div", { class: cls("follow") });
    for (const f of bundle.followUps) {
      follow.append(
        el("button", { onClick: () => onFollowUp(f), type: "button" }, [
          icon("chev-right", "sm"),
          el("span", { text: f }),
        ])
      );
    }
    const n = bundle.followUps.length;
    target.append(
      collapsible(
        `${n} suggestion${n === 1 ? "" : "s"}`,
        follow,
        cls("follow-disc")
      )
    );
  }
}

/**
 * A disclosure that renders its own chevron.
 *
 * `disclosure()` draws none — a timeline row's status dot is its affordance —
 * so anything used outside the timeline has to supply one or it reads as inert
 * text. `onToggle` fires once at construction, which is what seeds the glyph.
 */
function collapsible(
  label: string,
  body: HTMLElement,
  rootClass: string
): HTMLElement {
  const chev = el("span", { class: cls("disc-chev") });
  const d = disclosure({
    bodyClass: cls("disc-body"),
    class: rootClass,
    head: [chev, el("span", { text: label })],
    headClass: cls("disc-head"),
    onToggle: (open) =>
      chev.replaceChildren(icon(open ? "chev-down" : "chev-right", "xs")),
    open: false,
  });
  d.body.append(body);
  return d.root;
}

/**
 * One file's diff, folded shut.
 *
 * Every changed file used to render fully expanded, so a five-file edit buried
 * the rest of the turn — and the summary above it already says what happened.
 * The header carries the filename, the counts, and a ⋯ for the things you can
 * do to this specific file.
 */
function fileDiff(
  diff: JobDiffBundle["diffs"][number],
  bundle: JobDiffBundle,
  actions: AssistantActions
): HTMLElement {
  const chev = el("span", { class: cls("disc-chev") });
  const head: HTMLElement[] = [
    chev,
    el("span", { class: cls("diff-file"), text: diff.file }),
    el("span", {
      class: cls("diff-stat"),
      text: `+${diff.additions} −${diff.deletions}`,
    }),
  ];

  const d = disclosure({
    bodyClass: cls("diff-disc-body"),
    class: cls("diff"),
    head,
    headClass: cls("diff-head"),
    onToggle: (open) =>
      chev.replaceChildren(icon(open ? "chev-down" : "chev-right", "xs")),
    open: false,
  });

  const rendered = renderDiff(diff, { header: false });
  d.body.append(rendered);

  const entries = fileMenu(diff, bundle, actions, rendered);
  if (entries.length) {
    // Lives in the header but must not toggle it on the way through.
    const kebab = el(
      "button",
      {
        "aria-label": `Actions for ${diff.file}`,
        class: cls("diff-more"),
        "data-tip": "Actions for this file",
        onClick: (e: Event) => {
          e.stopPropagation();
          createMenu(fileMenu(diff, bundle, actions, rendered)).open(
            kebab as HTMLElement,
            "below"
          );
        },
        type: "button",
      },
      [icon("more", "sm")]
    );
    // Pressing the button collapses any text selection before `click` runs, so
    // the range a "comment on these lines" entry needs is latched here.
    kebab.addEventListener("pointerdown", () => {
      pendingSelection = selectedLineRange(rendered);
    });
    d.head.append(kebab);
  }
  return d.root;
}

/**
 * The line range latched on pointerdown, for the menu built on click.
 *
 * Module-level because only one menu can be opening at a time — the popover
 * host closes any other on open — and threading it through would mean every
 * diff owning state it only needs for the length of one click.
 */
let pendingSelection: ReturnType<typeof selectedLineRange> = null;

function fileMenu(
  diff: JobDiffBundle["diffs"][number],
  _bundle: JobDiffBundle,
  actions: AssistantActions,
  rendered: HTMLElement
): MenuEntry[] {
  const out: MenuEntry[] = [];
  const line = firstHunkLine(diff.patch);

  if (actions.onComment) {
    const range = pendingSelection;
    const { onComment } = actions;
    out.push({
      icon: "tool-comment",
      label: range
        ? `Comment on lines ${range.from}–${range.to}…`
        : "Comment on this change…",
      run: () => onComment(diff.file, rendered),
    });
  }
  const openIn = actions.onOpenIn;
  if (openIn) {
    if (out.length) {
      out.push({ separator: true });
    }
    out.push(
      { header: "Open" },
      {
        icon: "code",
        label: "Open in VS Code",
        run: () => openIn("vscode", diff.file, line),
      },
      {
        icon: "code",
        label: "Open in Cursor",
        run: () => openIn("cursor", diff.file, line),
      }
    );
  }
  const copyPath = actions.onCopyPath;
  if (copyPath) {
    out.push({
      icon: "clipboard",
      label: "Copy path",
      run: () => copyPath(diff.file),
    });
  }
  return out;
}

function hasTurnActions(actions: AssistantActions): boolean {
  return Boolean(
    actions.onUndo ||
      actions.onCommit ||
      actions.onBranch ||
      actions.onCreatePr ||
      actions.onOpenIn
  );
}

/**
 * One kebab for the whole turn.
 *
 * This was three always-visible icon buttons, and the set only grows — commit,
 * push, PR, open in two editors, copy path. Six glyphs under every message is
 * furniture; one is a place to look.
 */
function turnMenuButton(
  bundle: JobDiffBundle,
  actions: AssistantActions
): HTMLElement {
  const btn = el(
    "button",
    {
      "aria-label": "Actions for this change",
      class: `${cls("action")} ${cls("action-icon")}`,
      "data-tip": "Actions",
      onClick: () =>
        createMenu(turnMenu(bundle, actions, btn)).open(btn, "above"),
      type: "button",
    },
    [icon("more", "sm")]
  );
  return btn;
}

/**
 * The "This change" rows: revert, commit, and open a pull request.
 *
 * Separate from `turnMenu` because all three carry an availability gate, and
 * there are two different gates. Revert does not need git at all — it rewrites
 * files from the before-state the turn captured — so it is greyed only when
 * this turn has files whose baseline was never captured, which is a fact the
 * bundle already carries. Commit and Create pull request do need git, equally
 * for every turn, so they read the daemon's health report.
 *
 * Greyed with a reason rather than hidden: a Commit that is simply missing
 * reads as a bug, and one that fails after the click has already cost the click.
 */
function changeRows(
  bundle: JobDiffBundle,
  actions: AssistantActions,
  anchor: HTMLElement
): MenuEntry[] {
  // The reason only, never the hint: `GitStatus.hint` is a command to run, sized
  // for a terminal, and a tooltip clamps at three lines. The banner and `airship
  // doctor` are where the fix gets spelled out.
  const gitBroken = actions.git && !actions.git.ok;
  const gitTip = gitBroken ? actions.git?.reason : undefined;
  const unrestorable = bundle.diffs?.some((d) => d.noBaseline) ?? false;

  const change: MenuEntry[] = [];
  if (actions.onUndo) {
    change.push({
      // No `hint`, and the label says "Revert" rather than "Undo".
      //
      // This row carried a `⌘Z` chip, which was not a stale glyph but a false
      // statement: `onUndo` here is `AirshipApp.undo(jobId)`, the *server-side*
      // revert of a finished job, while ⌘Z is `history.undo`, the local
      // direct-manipulation stack. `app.ts` says in as many words that the two
      // must never be wired together — and this menu was telling the user they
      // were. There is no chord for this, so it advertises none.
      disabled: unrestorable,
      icon: "rotate-ccw",
      label: "Revert this change",
      run: actions.onUndo,
      tip: unrestorable ? "No previous content to restore from" : undefined,
    });
  }
  const { onCommit } = actions;
  if (onCommit) {
    change.push(
      {
        disabled: gitBroken,
        icon: "version-current",
        label: "Commit to git",
        run: () => onCommit(false),
        tip: gitTip,
      },
      {
        disabled: gitBroken,
        icon: "version-merged",
        label: "Commit & push",
        run: () => onCommit(true),
        tip: gitTip,
      }
    );
  }
  const { onCreatePr } = actions;
  if (onCreatePr) {
    const files = bundle.diffs?.length ?? 0;
    change.push({
      disabled: gitBroken,
      icon: "version-branch",
      label: "Create pull request…",
      // Pushing is the only thing in this application that cannot be taken
      // back — everything else has Undo or Discard — so it takes a second
      // deliberate click. A second menu rather than a native confirm(): it
      // says exactly what will happen and looks like the rest of the editor.
      run: () =>
        createMenu([
          { header: "This cannot be undone" },
          {
            icon: "version-branch",
            label: `Commit ${files} file${files === 1 ? "" : "s"}, push & open PR`,
            run: onCreatePr,
          },
        ]).open(anchor, "above"),
      tip: gitTip,
    });
  }
  return change;
}

/** The turn kebab's contents, grouped. Exported for the same reason it is
 * separate: the shape of this menu is a product decision worth reading. */
export function turnMenu(
  bundle: JobDiffBundle,
  actions: AssistantActions,
  anchor: HTMLElement
): MenuEntry[] {
  const out: MenuEntry[] = [];
  const file = bundle.diffs?.[0]?.file ?? bundle.target?.source?.file;
  const line = bundle.diffs?.[0]
    ? firstHunkLine(bundle.diffs[0].patch)
    : (bundle.target?.source?.line ?? undefined);

  const change = changeRows(bundle, actions, anchor);
  if (change.length) {
    out.push({ header: "This change" }, ...change);
  }

  if (actions.onBranch) {
    if (out.length) {
      out.push({ separator: true });
    }
    // Deliberately not "Branch". This forks the agent's *session*, not git —
    // and sitting one line under "Create pull request" the git reading is the
    // one every user would take.
    out.push(
      { header: "Continue" },
      {
        icon: "version-branch",
        label: "Try again from here",
        run: actions.onBranch,
      }
    );
  }

  const openIn = actions.onOpenIn;
  if (openIn && file) {
    if (out.length) {
      out.push({ separator: true });
    }
    out.push(
      { header: "Open" },
      {
        icon: "code",
        label: "Open in VS Code",
        run: () => openIn("vscode", file, line),
      },
      {
        icon: "code",
        label: "Open in Cursor",
        run: () => openIn("cursor", file, line),
      }
    );
    if (actions.onCopyPath) {
      const copyPath = actions.onCopyPath;
      out.push({
        icon: "clipboard",
        label: "Copy path",
        run: () => copyPath(file),
      });
    }
  }
  return out;
}
