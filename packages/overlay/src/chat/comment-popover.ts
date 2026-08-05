/**
 * The little box you type a review comment into.
 *
 * A popover rather than the composer. Prefilling the composer would clobber
 * whatever the user was already typing and, worse, lose the anchor — the whole
 * point of a comment is that it points at specific lines, and a message in the
 * chat box points at nothing.
 */
import { cls, el } from "../dom";
import { icon } from "../icons";
import { closeOpenPopover, openPopover } from "../popover-host";

export interface CommentContext {
  file: string;
  fromLine?: number;
  toLine?: number;
}

export function openCommentPopover(
  anchor: HTMLElement,
  ctx: CommentContext,
  onSubmit: (body: string) => void
): void {
  let where = ctx.file;
  if (ctx.fromLine !== undefined) {
    where =
      ctx.fromLine === ctx.toLine
        ? `${ctx.file}:${ctx.fromLine}`
        : `${ctx.file}:${ctx.fromLine}–${ctx.toLine}`;
  }

  const field = el("textarea", {
    class: cls("comment-input"),
    placeholder: "What should change here?",
    rows: "3",
    spellcheck: "true",
  }) as HTMLTextAreaElement;

  const submit = (): void => {
    const body = field.value.trim();
    if (!body) {
      return;
    }
    closeOpenPopover("select");
    onSubmit(body);
  };

  // The popover host owns Escape for the shell, but a focused field swallows
  // the keydown before it ever reaches the document — so the field has to
  // close the popover itself. ⌘↵ submits, matching the composer.
  field.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeOpenPopover("escape");
      return;
    }
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      submit();
    }
  });

  const content = el("div", { class: cls("comment-pop") }, [
    el("div", { class: cls("comment-where") }, [
      icon("tool-comment", "sm"),
      el("span", { text: where }),
    ]),
    field,
    el("div", { class: cls("comment-actions") }, [
      el("span", { class: cls("comment-hint"), text: "⌘↵ to add" }),
      el(
        "button",
        {
          class: `${cls("action")} ${cls("primary")}`,
          onClick: submit,
          type: "button",
        },
        [el("span", { text: "Add" })]
      ),
    ]),
  ]);

  openPopover({ anchor, className: "pop-comment", content, prefer: "below" });
  field.focus();
}
