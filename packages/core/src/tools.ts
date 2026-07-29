/**
 * In-process MCP server exposing Airship's domain capabilities to Claude as native
 * tools (via the Agent SDK `tool()` / `createSdkMcpServer()` helpers).
 */

import type {
  AttrEditTarget,
  ElementContext,
  MoveEdit,
  SourceLocation,
  StructuralEdit,
  TextEditTarget,
  TokenScanResult,
  VisualEditTarget,
} from "@airship/protocol";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

/** Everything about the turn that Claude might want to re-read mid-edit. */
export interface McpContext {
  attrChanges?: AttrEditTarget[];
  element?: ElementContext;
  moveChanges?: MoveEdit[];
  source?: SourceLocation | null;
  structuralChanges?: StructuralEdit[];
  textChanges?: TextEditTarget[];
  tokens?: TokenScanResult;
  visualChanges?: VisualEditTarget[];
}

export function buildAirshipMcpServer(ctx: McpContext) {
  return createSdkMcpServer({
    name: "airship",
    tools: [
      tool(
        "get_element_context",
        "Return details about the UI element the user selected in the browser: its tag, classes, visible text, framework component name, resolved source file/line, and every direct-manipulation edit the user made in the design inspector — style changes (property: from → to, with the project design token each resolved to), HTML attribute changes, structural moves, deletes/duplicates and text edits. Call this whenever you need the selection details again.",
        {},
        () =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify(
                  {
                    attrChanges: ctx.attrChanges ?? null,
                    element: ctx.element ?? null,
                    moveChanges: ctx.moveChanges ?? null,
                    source: ctx.source ?? null,
                    structuralChanges: ctx.structuralChanges ?? null,
                    textChanges: ctx.textChanges ?? null,
                    visualChanges: ctx.visualChanges ?? null,
                  },
                  null,
                  2
                ),
                type: "text" as const,
              },
            ],
          }),
        { annotations: { readOnlyHint: true } }
      ),
      tool(
        "get_design_tokens",
        "Return the project's design tokens — the CSS custom properties and utility classes Airship found by scanning the project's stylesheets, each with its category, resolved value, and the file and line it is declared on. Use this to write the project's own token instead of a literal value, or to find and edit the scale itself.",
        {},
        () =>
          Promise.resolve({
            content: [
              {
                text: JSON.stringify(
                  ctx.tokens ?? { framework: "unknown", tokens: [] },
                  null,
                  2
                ),
                type: "text" as const,
              },
            ],
          }),
        { annotations: { readOnlyHint: true } }
      ),
    ],
    version: "0.0.0",
  });
}
