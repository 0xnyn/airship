/**
 * The merged token registry — one view over the server's static scan and the
 * frame's runtime scan.
 *
 * Merge rules, in one place because getting them subtly wrong is invisible:
 *
 * - **Static wins on conflict.** It carries the authored name, the file and the
 *   line; the runtime copy of the same token carries a resolved value and
 *   nothing else. Where both have a value we keep the static entry but adopt the
 *   runtime *value*, because the browser has followed `var()` chains through
 *   cascade layers and media queries that a text scan cannot.
 * - **Runtime-only tokens are kept.** That is the whole reason the runtime scan
 *   exists: CSS-in-JS declares tokens that never appear in a file.
 * - **Aliases collapse.** A design system that defines `--pk-radius-md: 8px` and
 *   re-exports it as `--radius-md: var(--pk-radius-md)` has one token with two
 *   names, and a picker offering both `8px` entries is just noise. The alias
 *   wins, because it is the name the application code actually writes.
 */
import {
  type DesignToken,
  emptyRegistry,
  isChannelTriple,
  normalizeTokenValue,
  propertiesForCategory,
  TOKEN_CATEGORIES,
  type TokenRegistry,
  type TokenScanResult,
} from "@airship/protocol/tokens";

/** The single token value, whichever shape the token uses to hold it. */
export function tokenValue(token: DesignToken, property?: string): string {
  if (property && token.values[property] !== undefined) {
    return token.values[property];
  }
  return token.values[""] ?? Object.values(token.values)[0] ?? "";
}

/**
 * What to write into the live DOM to show a token's effect.
 *
 * This is deliberately *not* "how the token is written in source". The name
 * reaches the agent on the `TokenRef` recorded alongside the change; this
 * function's only job is to produce something the browser will actually paint.
 *
 * Three cases, and the last two are each a bug that shipped:
 *
 * 1. **A utility class is not a value.** `style.setProperty("padding-top",
 *    ".p-4")` is silently dropped by the CSSOM, so picking a Tailwind token
 *    changed nothing on screen. Preview the value the class declares.
 *
 * 2. **A `var()` whose substitution is not a valid value takes the whole
 *    declaration down with it.** `var()` is valid at *parse* time whatever it
 *    contains, so the declaration wins the cascade and is then thrown out as
 *    "invalid at computed-value time" — which falls back to `unset`, i.e. to
 *    the inherited value for an inherited property and the initial value
 *    otherwise. Picking a colour token therefore left text looking unchanged
 *    (`color` inherits) and blanked a background to transparent
 *    (`background-color` does not) — which in turn deleted the fill row,
 *    because that row is gated on the background being non-transparent.
 *
 *    The fallback in `var(--x, literal)` covers the case where the custom
 *    property is not defined at all. It does **not** cover a property that is
 *    defined but holds something the target property cannot use — a channel
 *    triple (`--brand: 255 229 202`), which this vocabulary explicitly
 *    supports and categorises as a colour. Nothing rescues that declaration,
 *    so such a token is previewed as its normalised literal instead.
 *
 * 3. Everything else gets `var(--x, literal)`: the reference when it resolves,
 *    and the value the token stands for when it does not.
 */
export function tokenPreviewValue(
  token: DesignToken,
  property: string
): string {
  const raw = tokenValue(token, property);
  if (token.kind !== "css-var") {
    return raw;
  }
  const literal = normalizeTokenValue(raw);
  if (!literal) {
    // Nothing to fall back to. A bare reference is still the best guess, and
    // the change set carries the token name regardless.
    return `var(${token.name})`;
  }
  return isChannelTriple(raw.trim())
    ? literal
    : `var(${token.name}, ${literal})`;
}

let current: TokenRegistry = emptyRegistry();
const listeners = new Set<(registry: TokenRegistry) => void>();

/** The merged registry. Always safe to read; empty before the first scan. */
export function tokens(): TokenRegistry {
  return current;
}

/** Subscribe to registry replacement. Returns an unsubscribe. */
export function onTokensChange(
  listener: (registry: TokenRegistry) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let staticScan: TokenScanResult | null = null;
let runtimeScan: TokenScanResult | null = null;

/** The server's file scan arrived. */
export function setStaticTokens(scan: TokenScanResult): void {
  staticScan = scan;
  rebuild();
}

/** A frame's CSSOM scan arrived. */
export function setRuntimeTokens(scan: TokenScanResult): void {
  runtimeScan = scan;
  rebuild();
}

function rebuild(): void {
  current = mergeScans(staticScan, runtimeScan);
  for (const listener of listeners) {
    listener(current);
  }
}

/** Exported for tests: the pure merge, with no module state involved. */
export function mergeScans(
  fromDisk: TokenScanResult | null,
  fromBrowser: TokenScanResult | null
): TokenRegistry {
  const byName = new Map<string, DesignToken>();

  for (const token of fromDisk?.tokens ?? []) {
    byName.set(token.name, token);
  }
  for (const token of fromBrowser?.tokens ?? []) {
    const existing = byName.get(token.name);
    if (!existing) {
      byName.set(token.name, token);
      continue;
    }
    // Keep the static entry's provenance, take the browser's resolved value.
    byName.set(token.name, {
      ...existing,
      values: token.values,
    });
  }

  const kept = collapseAliases([...byName.values()]);
  return index(
    kept,
    fromDisk?.framework ?? fromBrowser?.framework ?? "unknown"
  );
}

/**
 * Drop a primitive when an alias of it exists with the same value.
 *
 * Only exact aliases are collapsed (see `aliasOf`), and only when the values
 * still agree — if a theme has redefined one of them they are genuinely two
 * tokens and both stay.
 */
function collapseAliases(all: DesignToken[]): DesignToken[] {
  const byName = new Map(all.map((t) => [t.name, t]));
  const shadowed = new Set<string>();
  for (const token of all) {
    if (!token.aliasOf) {
      continue;
    }
    const primitive = byName.get(token.aliasOf);
    if (
      primitive &&
      normalizeTokenValue(tokenValue(primitive)) ===
        normalizeTokenValue(tokenValue(token))
    ) {
      shadowed.add(primitive.name);
    }
  }
  return all.filter((t) => !shadowed.has(t.name));
}

function index(all: DesignToken[], framework: TokenRegistry["framework"]) {
  const registry = emptyRegistry();
  registry.framework = framework;

  for (const token of all) {
    registry.byName[token.name] = token;
    registry.byCategory[token.category].push(token);

    for (const [property, value] of Object.entries(token.values)) {
      const normalized = normalizeTokenValue(value);
      // A custom property has no property of its own, so it is indexed under
      // every property in its category — that is what lets `--pk-space-md`
      // match a `padding-top` of 16px.
      const properties =
        property === "" ? propertiesForCategory(token.category) : [property];
      for (const p of properties) {
        const key = `${p}:${normalized}`;
        const bucket = registry.byValue[key];
        if (bucket) {
          bucket.push(token);
        } else {
          registry.byValue[key] = [token];
        }
      }
    }
  }

  for (const category of TOKEN_CATEGORIES) {
    registry.byCategory[category].sort(compareTokens);
  }
  return registry;
}

/**
 * Numeric scales sort by value, everything else by name. A spacing picker
 * listing 4, 8, 12, 16 is a scale; one listing them alphabetically as 12, 16, 4,
 * 8 is a list of strings that happen to be numbers.
 */
function compareTokens(a: DesignToken, b: DesignToken): number {
  const na = Number.parseFloat(tokenValue(a));
  const nb = Number.parseFloat(tokenValue(b));
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum && na !== nb) {
    return na - nb;
  }
  if (aNum !== bNum) {
    return aNum ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
