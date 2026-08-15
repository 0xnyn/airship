import {
  type AgentKind,
  type AttrEditTarget,
  EDIT_OUTPUT_JSON_SCHEMA,
  type ElementContext,
  type MoveEdit,
  type ReviewComment,
  type SourceLocation,
  type StructuralEdit,
  type StyleChange,
  type TextEditTarget,
  type TokenScanResult,
  type VisualEditTarget,
} from "@airship/protocol";
import {
  categoryForProperty,
  type TokenCategory,
} from "@airship/protocol/tokens";

/**
 * The agent's operating instructions, minus the one line that differs between
 * backends. Layered on top of the vendor's own base prompt in both cases: for
 * Claude as `systemPrompt.append` over the `claude_code` preset, for Codex as a
 * preamble on the first turn's text (that SDK exposes no system-prompt option).
 */
function buildSystemPrompt(selectionHint: string): string {
  return `You are Airship, an AI editor embedded in the user's running web app.

The user points at a UI element in their browser and either describes a change in plain language or tweaks it directly in a design inspector. Your job:
- Make the smallest, most targeted source edit that satisfies the request.
- Start from the file and line the user pointed at. ${selectionHint}
- Match the surrounding code's style and conventions. Never reformat or touch unrelated code.
- When you receive concrete style changes (property: from → to), translate them into idiomatic source edits: match the project's existing styling system (Tailwind utility classes, CSS/SCSS modules, inline styles, styled-components, etc.).
- A style change may name a design token in brackets. That token was resolved from the project's own stylesheets, so write it rather than the literal value — it is evidence, not a suggestion. A change marked as detached is the opposite instruction: write the literal value and do not substitute a token.
- When you receive a structural move (an element repositioned in the DOM tree), relocate that element's JSX to the new parent/position, preserving its props and children exactly — do not duplicate, restyle, or recreate it.
- Do not add dependencies or scaffolding unless the request truly requires it.
- Work autonomously: do not ask the user questions — apply the best reasonable edit.
- When done, return the structured result (a one-line summary, the files you changed, and up to 3 follow-up suggestions).`;
}

/** One field of the edit schema, worded from the schema itself. */
function fieldLine(
  name: keyof typeof EDIT_OUTPUT_JSON_SCHEMA.properties
): string {
  const prop = EDIT_OUTPUT_JSON_SCHEMA.properties[name];
  const kind = prop.type === "array" ? "array of strings" : prop.type;
  return `- "${name}" (${kind}): ${prop.description}`;
}

/**
 * The structured-output contract, spelled as a prompt instruction.
 *
 * OpenCode's `format` option is implemented as a forced tool call, which some
 * providers reject outright (see opencode.ts), so it cannot be relied on to
 * carry the contract — and when it is dropped, nothing else tells the model
 * what JSON to emit. The contract rides in the system prompt instead, and
 * airship's own extractor (`splitStructured`) lifts the block back out of the
 * prose.
 *
 * Derived from EDIT_OUTPUT_JSON_SCHEMA rather than restated, so a schema
 * change cannot leave this text describing fields that no longer exist. It
 * deliberately contains no filled-in example: a model that echoed an example
 * verbatim would hand the extractor a payload that parses.
 *
 * The three rules are load-bearing, not style: the extractor treats prose as
 * a strict prefix of the message, the schema is strict (one missing key loses
 * the whole payload, summary included), and plain questions produce no edit
 * yet still need the block.
 */
export function structuredOutputInstruction(): string {
  const fields = EDIT_OUTPUT_JSON_SCHEMA.required.map(fieldLine).join("\n");
  return `At the very end of your final message — after all prose, and exactly once — append a single JSON object wrapped in <structuredoutput></structuredoutput> tags, with exactly these keys:
${fields}

- Include every key every time; the object is rejected whole if one is missing.
- Emit the block even when nothing was edited (an empty array for "filesChanged").
- Never place the block mid-message or emit it twice; nothing may follow it.`;
}

/**
 * The system prompt for a given backend.
 *
 * Only the selection-recall line differs. Claude gets an in-process MCP tool
 * for re-reading the selection; no other backend can host one (Codex's SDK
 * cannot, and OpenCode's MCP servers are config-declared subprocesses), so they
 * are told the details are inline rather than pointed at a tool that does not
 * exist.
 *
 * The test is on `claude` rather than on each backend that lacks the tool, so
 * that a backend added later defaults to the honest branch instead of silently
 * advertising a tool it does not have.
 *
 * OpenCode alone also carries the structured-output contract: Claude and
 * Codex constrain the decode natively (`outputFormat` / `outputSchema`), so
 * telling them about wrapper tags would only invite stray tags in prose.
 */
export function systemPrompt(agent: AgentKind): string {
  const base = buildSystemPrompt(
    agent === "claude"
      ? "If you need the selection details again, call the `get_element_context` tool."
      : "The full selection details are included in the instruction below — re-read them there if you need them again."
  );
  return agent === "opencode"
    ? `${base}\n\n${structuredOutputInstruction()}`
    : base;
}

/** @deprecated Prefer {@link systemPrompt}; retained as the Claude spelling. */
export const AIRSHIP_SYSTEM_PROMPT = systemPrompt("claude");

export interface EditPromptInput {
  /** Direct-manipulation HTML attribute edits, when present. */
  attrChanges?: AttrEditTarget[];
  /** Review feedback on the diff from a previous turn, when present. */
  comments?: ReviewComment[];
  element?: ElementContext;
  /** Direct-manipulation structural moves (drag-to-reposition), when present. */
  moveChanges?: MoveEdit[];
  prompt: string;
  source?: SourceLocation | null;
  /** Direct-manipulation deletes and duplicates, when present. */
  structuralChanges?: StructuralEdit[];
  /** In-place text edits, when present. */
  textChanges?: TextEditTarget[];
  /** The project's design tokens, scanned from its CSS by the server. */
  tokens?: TokenScanResult;
  /** Direct-manipulation style deltas from the design inspector, when present. */
  visualChanges?: VisualEditTarget[];
}

/** Builds the user-facing instruction sent to the agent for a single edit. */
export function buildEditPrompt(input: EditPromptInput): string {
  const hasVisual = (input.visualChanges?.length ?? 0) > 0;
  const hasMoves = (input.moveChanges?.length ?? 0) > 0;
  const hasStructure = (input.structuralChanges?.length ?? 0) > 0;
  const hasText = (input.textChanges?.length ?? 0) > 0;
  const hasAttrs = (input.attrChanges?.length ?? 0) > 0;
  const hasComments = (input.comments?.length ?? 0) > 0;
  // Comments are feedback on work already done, which is a different framing
  // from either a fresh instruction or a set of deltas to translate — so they
  // get their own prompt rather than a paragraph appended to one.
  if (
    hasComments &&
    !(hasVisual || hasMoves || hasStructure || hasText || hasAttrs)
  ) {
    return buildReviewPrompt(input);
  }
  if (hasVisual || hasMoves || hasStructure || hasText || hasAttrs) {
    return buildDirectManipPrompt(input, hasVisual, hasMoves);
  }
  return buildTextPrompt(input);
}

// ---------------------------------------------------------------------------
// Review — the user commented on the diff the agent just produced.
// ---------------------------------------------------------------------------

function buildReviewPrompt(input: EditPromptInput): string {
  const comments = input.comments ?? [];
  const lines: string[] = [];
  // Only claim continuity when the session really is the one that made the
  // edit. Resuming a different session and asserting "the edit you just made"
  // would send the agent looking for work it has no memory of.
  const sameSession = comments.every(
    (c) => !c.jobId || c.jobId === comments[0].jobId
  );

  lines.push(
    sameSession
      ? "The user reviewed the edit you just made and left comments on specific lines."
      : "The user left review comments on code from an earlier edit."
  );
  lines.push("Address each one with the smallest follow-up edit.");
  lines.push(
    "- The line numbers are from the file as that edit left it and may have moved; the snippet is the reliable way to find the code."
  );
  lines.push("- Change only what the comment asks for.");
  lines.push("");

  comments.forEach((c, i) => {
    let where = c.file;
    if (c.fromLine !== undefined) {
      where =
        c.fromLine === c.toLine
          ? `${c.file} line ${c.fromLine}`
          : `${c.file} lines ${c.fromLine}–${c.toLine}`;
    }
    lines.push(`Comment ${i + 1} — ${where}:`);
    if (c.snippet.trim()) {
      lines.push("```");
      for (const snippetLine of c.snippet.split("\n")) {
        lines.push(snippetLine);
      }
      lines.push("```");
    }
    lines.push(`  ${JSON.stringify(c.body)}`);
    lines.push("");
  });

  const note = input.prompt.trim();
  if (note) {
    lines.push(`Additional instruction from the user: ${JSON.stringify(note)}`);
    lines.push("");
  }
  lines.push("Apply the changes and save.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Text (chat) edit — the original "describe a change" flow.
// ---------------------------------------------------------------------------

function buildTextPrompt(input: EditPromptInput): string {
  const lines: string[] = [];
  lines.push(
    "The user is visually editing their web app and selected an element."
  );
  lines.push("");

  if (input.element) {
    appendElementBlock(lines, input.element, input.source);
  } else if (input.source?.file) {
    appendSourceBlock(lines, input.source);
  }

  lines.push("");
  lines.push(`User instruction: ${JSON.stringify(input.prompt)}`);
  lines.push("");
  lines.push(
    "Open the relevant source file, make the minimal edit needed, and save it."
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Direct-manipulation edit — translate concrete style deltas and/or structural
// moves made in the design inspector into idiomatic code.
// ---------------------------------------------------------------------------

function buildDirectManipPrompt(
  input: EditPromptInput,
  hasVisual: boolean,
  hasMoves: boolean
): string {
  const lines: string[] = [];
  lines.push(
    "The user edited their web app directly in a visual design inspector."
  );
  if (hasVisual && hasMoves) {
    lines.push(
      "Apply the style changes and structural moves below as the smallest idiomatic source edits."
    );
  } else if (hasMoves) {
    lines.push(
      "Reposition the element(s) below in the source to match their new place in the layout — the smallest idiomatic edit."
    );
  } else if (hasVisual) {
    lines.push(
      "Translate the following style changes into the smallest idiomatic source edits."
    );
  } else {
    lines.push(
      "Apply the changes below as the smallest idiomatic source edits."
    );
  }
  lines.push("");

  if (hasVisual) {
    appendStyleTargets(lines, input.visualChanges ?? [], input.tokens);
  }
  if (hasMoves) {
    appendMoveTargets(lines, input.moveChanges ?? []);
  }
  if (input.structuralChanges?.length) {
    appendStructuralTargets(lines, input.structuralChanges);
  }
  if (input.textChanges?.length) {
    appendTextTargets(lines, input.textChanges);
  }
  if (input.attrChanges?.length) {
    appendAttrTargets(lines, input.attrChanges);
  }

  const note = input.prompt.trim();
  if (note) {
    lines.push(`Additional instruction from the user: ${JSON.stringify(note)}`);
    lines.push("");
  }

  lines.push(
    "Open the relevant source files, apply the changes idiomatically, and save."
  );
  return lines.join("\n");
}

function appendStyleTargets(
  lines: string[],
  targets: VisualEditTarget[],
  tokens?: TokenScanResult
): void {
  lines.push(
    "Style changes — for each target apply every listed change (`property: from → to`):"
  );
  lines.push(
    "- Inspect the file to determine the project's styling system (Tailwind utility classes, CSS/SCSS modules, inline styles, styled-components, …) and edit in that same style."
  );
  lines.push(
    "- Where a change names a token, write that token rather than the literal value. The token is the project's own name for it, resolved from the project's CSS — it is not a guess."
  );
  lines.push(
    "- Change only what each target value requires; leave the rest untouched."
  );
  lines.push("");
  appendTokenLegend(lines, targets, tokens);

  targets.forEach((target, i) => {
    lines.push(
      `Target ${i + 1} — ${describeElement(target.element, target.source)}`
    );
    if (target.element.classes.length) {
      lines.push(`  Classes: ${target.element.classes.join(" ")}`);
    }
    if (target.element.textPreview) {
      lines.push(`  Text: ${JSON.stringify(target.element.textPreview)}`);
    }
    if (target.element.selector) {
      lines.push(`  Selector: ${target.element.selector}`);
    }
    appendScopeLine(lines, target);
    for (const change of target.changes) {
      lines.push(`  - ${renderChange(change)}`);
    }
    appendContext(lines, "Source context:", target.source);
    lines.push("");
  });
}

/**
 * One change line, carrying its token when the overlay resolved one.
 *
 * Three distinct cases, and the wording has to keep them apart. An exact token
 * is an instruction. A near token is a question — the user landed on 13px and
 * their scale has 12px, and only they know which they meant, so the agent is
 * told both and told to prefer the scale. An explicit detach is a standing
 * instruction *not* to reach for the scale, which without saying so would look
 * identical to "no token happened to match".
 */
export function renderChange(change: StyleChange): string {
  const base = `${change.property}: ${change.from} → ${change.to}`;
  if (change.hardcode) {
    return `${base}  [the user detached this from its token — write the literal value, do not substitute a token]`;
  }
  if (!change.token) {
    return base;
  }
  if (change.token.exact) {
    return `${base}  [token: ${change.token.name} — ${howToWrite(change.token)}]`;
  }
  return `${base}  [nearest token: ${change.token.name} = ${change.token.actual} — prefer it unless the exact value was deliberate]`;
}

/**
 * How a token is spelled at a call site, which is not the same job for both
 * kinds and cannot be left to inference.
 *
 * `to` now carries the token's *value*, because that is the only thing a
 * utility class can be previewed as — the overlay writes `16px` into the DOM
 * and names `.pt-4` alongside it. Saying only "write this token" next to a
 * value delta left the agent to work out from a leading dot whether it was
 * meant to add a class or emit a declaration, and the two produce very
 * different edits.
 */
function howToWrite(token: NonNullable<StyleChange["token"]>): string {
  return token.kind === "utility-class"
    ? "add this utility class to the element rather than writing the value"
    : "write this token instead of the literal value";
}

/** Which selector and interaction state a group of changes belongs to. */
function appendScopeLine(lines: string[], target: VisualEditTarget): void {
  if (!(target.scope || target.state)) {
    return;
  }
  if (target.scope && target.state) {
    lines.push(
      `  Apply to: \`${target.scope}${target.state}\` — the ${target.state} rule for that class, which affects every element carrying it, not just this one.`
    );
    return;
  }
  if (target.scope) {
    lines.push(
      `  Apply to: \`${target.scope}\` — the shared class, so this affects every element carrying it, not just this one.`
    );
    return;
  }
  lines.push(
    `  Apply to: this element's \`${target.state}\` state only — edit or add the ${target.state} rule, and leave its resting style alone.`
  );
}

/**
 * The slice of the project's scale that this turn's changes actually touch.
 *
 * Scoped rather than dumped: a design system runs to hundreds of tokens and
 * listing all of them would cost more context than the edit is worth, while
 * telling the agent nothing it needs. Only the categories being edited are
 * relevant, and only when there is more than one option in them.
 */
function appendTokenLegend(
  lines: string[],
  targets: VisualEditTarget[],
  tokens?: TokenScanResult
): void {
  if (!tokens?.tokens.length) {
    return;
  }
  const wanted = new Set<TokenCategory>();
  for (const target of targets) {
    for (const change of target.changes) {
      const category = categoryForProperty(change.property);
      if (category) {
        wanted.add(category);
      }
    }
  }
  if (wanted.size === 0) {
    return;
  }

  const shown: string[] = [];
  for (const category of wanted) {
    const inCategory = tokens.tokens
      .filter((t) => t.category === category)
      .slice(0, MAX_TOKENS_PER_CATEGORY);
    if (inCategory.length === 0) {
      continue;
    }
    const rendered = inCategory
      .map((t) => `${t.name} = ${t.values[""] ?? Object.values(t.values)[0]}`)
      .join(", ");
    shown.push(`  ${category}: ${rendered}`);
  }
  if (shown.length === 0) {
    return;
  }
  lines.push(
    `The project's ${tokens.framework === "unknown" ? "" : `${tokens.framework} `}design scale, for the properties being edited:`
  );
  lines.push(...shown);
  lines.push("");
}

/** Enough to show the shape of a scale without flooding the context window. */
const MAX_TOKENS_PER_CATEGORY = 24;

/**
 * HTML attribute edits.
 *
 * Past tense and separate from the style block on purpose: these are props on
 * the element in the JSX, not declarations in a stylesheet, and an agent told
 * to "apply a style change" of `alt` would go looking for CSS.
 */
function appendAttrTargets(lines: string[], targets: AttrEditTarget[]): void {
  lines.push(
    "Attribute changes — the user edited these HTML attributes in the inspector:"
  );
  lines.push(
    "- These are attributes/props on the element itself, not CSS. Edit the JSX attribute, not a stylesheet."
  );
  lines.push(
    "- A `to` of (removed) means delete the attribute — a boolean attribute switched off."
  );
  lines.push("");
  targets.forEach((target, i) => {
    lines.push(
      `Target ${i + 1} — ${describeElement(target.element, target.source)}`
    );
    if (target.element.classes.length) {
      lines.push(`  Classes: ${target.element.classes.join(" ")}`);
    }
    for (const change of target.changes) {
      const from =
        change.from === null ? "(unset)" : JSON.stringify(change.from);
      const to = change.to === null ? "(removed)" : JSON.stringify(change.to);
      lines.push(`  - ${change.attribute}: ${from} → ${to}`);
    }
    appendContext(lines, "Source context:", target.source);
    lines.push("");
  });
}

function appendMoveTargets(lines: string[], moves: MoveEdit[]): void {
  lines.push(
    "Structural moves — relocate each element's JSX to its new position in the tree:"
  );
  lines.push(
    "- Move the element node itself; preserve its props, children, and text exactly. Do not duplicate, restyle, or recreate it."
  );
  lines.push(
    "- Place it immediately before the given anchor sibling; if there is no anchor it becomes the new parent's last child."
  );
  lines.push(
    "- The element and its new parent may live in different files/components — edit both as needed."
  );
  lines.push(
    "- Make the minimal edit; don't reorder or touch unrelated siblings."
  );
  lines.push("");

  moves.forEach((m, i) => {
    lines.push(`Move ${i + 1} — ${describeElement(m.element, m.source)}`);
    if (m.element.classes.length) {
      lines.push(`  Classes: ${m.element.classes.join(" ")}`);
    }
    if (m.element.textPreview) {
      lines.push(`  Text: ${JSON.stringify(m.element.textPreview)}`);
    }
    lines.push(
      `  New parent: ${m.newParent ? describeElement(m.newParent, m.newParentSource) : "(unresolved)"}`
    );
    if (m.before) {
      lines.push(
        `  Insert before: ${describeElement(m.before, m.beforeSource)}`
      );
    } else {
      lines.push("  Insert as: last child of the new parent");
    }
    if (typeof m.toIndex === "number") {
      lines.push(`  New index among siblings: ${m.toIndex}`);
    }
    appendContext(lines, "Element source context:", m.source);
    appendContext(lines, "New-parent source context:", m.newParentSource);
    lines.push("");
  });
}

/**
 * Deletes and duplicates.
 *
 * The overlay has already applied these to the live DOM, so the wording is
 * deliberately "the user removed", not "remove" — the agent is catching the
 * source up to a page the user is already looking at, and knowing that is what
 * stops it from asking for confirmation or hedging.
 */
function appendStructuralTargets(
  lines: string[],
  edits: StructuralEdit[]
): void {
  lines.push(
    "Structural changes — the user removed or duplicated these elements in the live page; update the source to match:"
  );
  lines.push(
    "- For a delete: remove that element's JSX and anything that existed only to support it (an unused import, a now-dead handler)."
  );
  lines.push(
    "- For a duplicate: insert an identical sibling immediately after the original. If the two would differ only by content, prefer extracting a list/map over pasting a second copy."
  );
  lines.push("- Do not restyle or reformat the surrounding code.");
  lines.push("");

  edits.forEach((e, i) => {
    lines.push(
      `${i + 1}. ${e.op === "delete" ? "Delete" : "Duplicate"} — ${describeElement(e.element, e.source)}`
    );
    if (e.element.classes.length) {
      lines.push(`  Classes: ${e.element.classes.join(" ")}`);
    }
    if (e.element.textPreview) {
      lines.push(`  Text: ${JSON.stringify(e.element.textPreview)}`);
    }
    appendContext(lines, "Source context:", e.source);
    lines.push("");
  });
}

/**
 * In-place text edits.
 *
 * Both strings are sent, not a diff: the old text is how the agent locates the
 * literal in the source, which matters when one component renders in several
 * places and only one of them was edited.
 */
function appendTextTargets(lines: string[], edits: TextEditTarget[]): void {
  lines.push("Text changes — the user retyped this copy directly in the page:");
  lines.push(
    "- Replace the old string with the new one at its source. If the text comes from a prop, a constant or a translation key, change it at that origin rather than hard-coding it at the call site."
  );
  lines.push(
    "- Preserve any surrounding JSX expressions and whitespace exactly."
  );
  lines.push("");

  edits.forEach((e, i) => {
    lines.push(`${i + 1}. ${describeElement(e.element, e.source)}`);
    lines.push(`  From: ${JSON.stringify(e.from)}`);
    lines.push(`  To:   ${JSON.stringify(e.to)}`);
    appendContext(lines, "Source context:", e.source);
    lines.push("");
  });
}

function describeElement(
  element: ElementContext,
  source: SourceLocation | null | undefined
): string {
  const tag = `<${element.tagName}>`;
  const name = element.displayName ? ` · ${element.displayName}` : "";
  const loc = source?.file
    ? ` (${source.file}${source.line ? `:${source.line}` : ""})`
    : "";
  return `${tag}${name}${loc}`;
}

function appendContext(
  lines: string[],
  label: string,
  source: SourceLocation | null | undefined
): void {
  if (!source?.context) {
    return;
  }
  lines.push(`  ${label}`);
  lines.push("  ```");
  for (const ctxLine of source.context.split("\n")) {
    lines.push(`  ${ctxLine}`);
  }
  lines.push("  ```");
}

// ---------------------------------------------------------------------------
// Shared block helpers
// ---------------------------------------------------------------------------

function appendElementBlock(
  lines: string[],
  element: ElementContext,
  source?: SourceLocation | null
): void {
  lines.push("Selected element:");
  lines.push(`- Tag: <${element.tagName}>`);
  if (element.displayName) {
    lines.push(`- Component: ${element.displayName}`);
  }
  if (element.classes.length) {
    lines.push(`- Classes: ${element.classes.join(" ")}`);
  }
  if (element.textPreview) {
    lines.push(`- Text: ${JSON.stringify(element.textPreview)}`);
  }
  if (element.selector) {
    lines.push(`- Selector: ${element.selector}`);
  }
  if (source?.file) {
    appendSourceBlock(lines, source);
  }
}

function appendSourceBlock(lines: string[], source: SourceLocation): void {
  const loc = source.line ? `${source.file}:${source.line}` : source.file;
  lines.push(`- Source: ${loc}`);
  if (source.context) {
    lines.push("");
    lines.push("Source context:");
    lines.push("```");
    lines.push(source.context);
    lines.push("```");
  }
}
