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
import { keys } from "../keys/registry";
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
  // close the popover itself. Escape stays field-local for that reason; ⌘↵
  // does not, because `allowWhileTyping` is exactly the exemption that lets a
  // field's own submit through the registry, and going through it is what puts
  // the right chord on the hint below on every platform.
  field.addEventListener("keydown", (e) => {
    const ev = e as KeyboardEvent;
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeOpenPopover("escape");
    }
  });

  const content = el("div", { class: cls("comment-pop") }, [
    el("div", { class: cls("comment-where") }, [
      icon("tool-comment", "sm"),
      el("span", { text: where }),
    ]),
    field,
    el("div", { class: cls("comment-actions") }, [
      el("span", {
        class: cls("comment-hint"),
        text: `${keys.hint("comment.add") ?? ""} to add`,
      }),
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

  // Scoped to the popover's own content, so ⌘↵ here never reaches the
  // composer's Send — the two commands share a chord and are told apart by
  // scope, which is what `catalog.test.ts` licenses them on.
  const offSubmit = keys.bind({
    id: "comment.add",
    run: submit,
    within: content,
  });

  openPopover({
    anchor,
    className: "pop-comment",
    content,
    onClose: offSubmit,
    prefer: "below",
  });
  field.focus();
}
