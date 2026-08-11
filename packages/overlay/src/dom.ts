export const PREFIX = "__airship";

export function cls(name: string): string {
  return `${PREFIX}-${name}`;
}

type Attrs = Record<string, unknown>;
type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper. `class`, `text`, `html`, and `on*` handlers are special. */
export function el(
  tag: string,
  attrs: Attrs = {},
  children: Child[] = []
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === "class") {
      node.className = String(value);
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "html") {
      node.innerHTML = String(value);
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === undefined || child === null || child === false) {
      continue;
    }
    node.append(child as Node | string);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) {
    node.firstChild.remove();
  }
}

/**
 * A compact DevTools-style label for a DOM node — `tag.classA.classB`
 * (first two classes). Shared by the selection/hover badges and the tree/DOM
 * views so they read identically.
 */
/**
 * Last segment of a source path — a chip has no room for
 * `src/components/ui/Button.tsx`.
 *
 * Handles both separators. Diff paths arrive forward-slashed, but source
 * locations come from the framework's own metadata, which on Windows is
 * backslashed — and a `split("/")` on one of those returns the whole path, so
 * the chip renders the full `src\components\ui\Button.tsx` it was meant to
 * shorten.
 */
export function basename(path: string): string {
  return path.slice(
    Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1
  );
}

export function elementLabel(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const classes = Array.from(node.classList)
    .filter((c) => !c.startsWith(PREFIX))
    .slice(0, 2)
    .join(".");
  return classes ? `${tag}.${classes}` : tag;
}
