import { cls } from "../dom";

const TRAILING_NEWLINE = /\n$/;
/** The placeholder a fenced code block is parked under while lines are parsed. */
const FENCE_PLACEHOLDER = /^\[\[PKFENCE:(\d+)\]\]$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM = /^[-*]\s+(.*)$/;
const ORDERED_ITEM = /^\d+\.\s+(.*)$/;

/**
 * A tiny, dependency-free Markdown→HTML renderer for assistant messages.
 * Security: everything is HTML-escaped *before* the whitelist of inline/block
 * transforms is applied, and only a fixed set of safe tags is emitted — so agent
 * output can never inject markup into the host page.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline formatting on already-escaped text. */
function inline(text: string): string {
  let out = text.replace(
    /`([^`]+)`/g,
    (_m, c) => `<code class="${cls("md-code")}">${c}</code>`
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<![\w*])_([^_]+)_(?!\w)/g, "<em>$1</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, t, href) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer">${t}</a>`
  );
  return out;
}

export function renderMarkdown(src: string): string {
  // Pull fenced code blocks out first so inline rules never touch code. The
  // ASCII placeholder token cannot appear in real assistant text.
  const fences: string[] = [];
  const body = src.replace(
    /```[a-zA-Z0-9]*\n?([\s\S]*?)```/g,
    (_m, code: string) => {
      const c = escapeHtml(code.replace(TRAILING_NEWLINE, ""));
      fences.push(`<pre class="${cls("md-pre")}"><code>${c}</code></pre>`);
      return `[[PKFENCE:${fences.length - 1}]]`;
    }
  );

  const html: string[] = [];
  let list: { items: string[]; type: "ol" | "ul" } | null = null;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      html.push(
        `<p>${para.map((l) => inline(escapeHtml(l))).join("<br>")}</p>`
      );
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      const items = list.items
        .map((i) => `<li>${inline(escapeHtml(i))}</li>`)
        .join("");
      html.push(`<${list.type}>${items}</${list.type}>`);
      list = null;
    }
  };

  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    const fence = line.match(FENCE_PLACEHOLDER);
    if (fence) {
      flushPara();
      flushList();
      html.push(fences[Number(fence[1])]);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      flushList();
      const lvl = Math.min(6, heading[1].length + 3);
      html.push(`<h${lvl}>${inline(escapeHtml(heading[2]))}</h${lvl}>`);
      continue;
    }
    const ul = line.match(UNORDERED_ITEM);
    if (ul) {
      flushPara();
      if (list?.type !== "ul") {
        flushList();
        list = { items: [], type: "ul" };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = line.match(ORDERED_ITEM);
    if (ol) {
      flushPara();
      if (list?.type !== "ol") {
        flushList();
        list = { items: [], type: "ol" };
      }
      list.items.push(ol[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  // Restore any fence placeholders that ended up inline (rare).
  return html
    .join("")
    .replace(/\[\[PKFENCE:(\d+)\]\]/g, (_m, i) => fences[Number(i)] ?? "");
}
