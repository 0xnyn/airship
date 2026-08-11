import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditPrompt } from "@airship/core";
import type { CreateJobRequest, ElementContext } from "@airship/protocol";
import { invalidateTokenCache } from "@airship/source/tokens";
import { describe, expect, it } from "vitest";
import { preparePromptInput } from "./prompt-input";

/** Build a throwaway project tree and return its root. */
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "airship-prompt-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  invalidateTokenCache();
  return root;
}

const APP_TSX = `export function App() {
  return (
    <main>
      <button className="btn btn-primary">Get Started</button>
      <span className="tag">New</span>
    </main>
  );
}
`;

const TOKENS_CSS = `:root {
  --pk-space-sm: 8px;
  --pk-space-md: 16px;
  --pk-radius-lg: 12px;
}
`;

/** A project with one component and one stylesheet, rooted for the scanner. */
function project(): string {
  return fixture({
    ".git": "",
    "src/App.tsx": APP_TSX,
    "src/tokens.css": TOKENS_CSS,
  });
}

function element(overrides: Partial<ElementContext> = {}): ElementContext {
  return {
    classes: ["btn", "btn-primary"],
    displayName: "Button",
    selector: ".btn.btn-primary",
    tagName: "button",
    textPreview: "Get Started",
    ...overrides,
  };
}

/** The location the browser reports: a real file and line, no context yet. */
const BUTTON_AT = { file: "src/App.tsx", line: 4 };

function request(overrides: Partial<CreateJobRequest> = {}): CreateJobRequest {
  return { prompt: "", ...overrides };
}

describe("preparePromptInput — source backfill", () => {
  it("attaches surrounding code to a style target", () => {
    const cwd = project();
    const input = preparePromptInput(
      cwd,
      request({
        visualChanges: [
          {
            changes: [{ from: "12px", property: "padding", to: "16px" }],
            element: element(),
            source: BUTTON_AT,
          },
        ],
      })
    );
    expect(input.visualChanges?.[0].source?.context).toContain(
      'className="btn btn-primary"'
    );
  });

  it("resolves all three locations on a move, not just the element", () => {
    // The two easiest to forget: an agent told to relocate JSX needs the new
    // parent and the anchor sibling as much as it needs the element itself.
    const cwd = project();
    const input = preparePromptInput(
      cwd,
      request({
        moveChanges: [
          {
            before: element({
              classes: ["tag"],
              displayName: "Tag",
              selector: ".tag",
              tagName: "span",
              textPreview: "New",
            }),
            beforeSource: { file: "src/App.tsx", line: 5 },
            element: element(),
            newParent: element({
              classes: [],
              displayName: undefined,
              selector: "main",
              tagName: "main",
              textPreview: "",
            }),
            newParentSource: { file: "src/App.tsx", line: 3 },
            source: BUTTON_AT,
          },
        ],
      })
    );
    const move = input.moveChanges?.[0];
    expect(move?.source?.context).toContain("Get Started");
    expect(move?.newParentSource?.context).toContain("<main>");
    expect(move?.beforeSource?.context).toContain('className="tag"');
  });

  it("backfills structural, text and attribute targets too", () => {
    const cwd = project();
    const input = preparePromptInput(
      cwd,
      request({
        attrChanges: [
          {
            changes: [{ attribute: "disabled", from: null, to: "true" }],
            element: element(),
            source: BUTTON_AT,
          },
        ],
        structuralChanges: [
          { element: element(), op: "duplicate", source: BUTTON_AT },
        ],
        textChanges: [
          {
            element: element(),
            from: "Get Started",
            source: BUTTON_AT,
            to: "Start now",
          },
        ],
      })
    );
    expect(input.structuralChanges?.[0].source?.context).toContain(
      "Get Started"
    );
    expect(input.textChanges?.[0].source?.context).toContain("Get Started");
    expect(input.attrChanges?.[0].source?.context).toContain("Get Started");
  });

  it("normalizes a root-relative path the dev server reported", () => {
    // Vite reports `/src/App.tsx`; `resolve(cwd, …)` would read that as
    // absolute and hand the agent a path outside the project.
    const cwd = project();
    const input = preparePromptInput(
      cwd,
      request({
        element: element(),
        source: { file: "/src/App.tsx", line: 4 },
      })
    );
    // Forward slashes, not `join`: this value is separator-independent by
    // design. It goes into the edit prompt, into the JSON an MCP tool returns
    // (where a backslash arrives doubled), and into the overlay as a label, so
    // the resolver normalizes it rather than emitting a native path.
    expect(input.source?.file).toBe("src/App.tsx");
    expect(input.source?.context).toContain("Get Started");
  });
});

describe("preparePromptInput — the primary element", () => {
  it("prefers the explicit selection", () => {
    const cwd = project();
    const input = preparePromptInput(
      cwd,
      request({
        element: element({ displayName: "Selected" }),
        source: BUTTON_AT,
        textChanges: [
          {
            element: element({ displayName: "Retyped" }),
            from: "a",
            source: BUTTON_AT,
            to: "b",
          },
        ],
      })
    );
    expect(input.element?.displayName).toBe("Selected");
  });

  it("falls back down the delta chain when nothing is selected", () => {
    const cwd = project();
    const fallback = (overrides: Partial<CreateJobRequest>) =>
      preparePromptInput(cwd, request(overrides)).element?.displayName;

    expect(
      fallback({
        moveChanges: [
          {
            before: null,
            beforeSource: null,
            element: element({ displayName: "Moved" }),
            newParent: null,
            newParentSource: null,
            source: BUTTON_AT,
          },
        ],
      })
    ).toBe("Moved");
    expect(
      fallback({
        structuralChanges: [
          {
            element: element({ displayName: "Deleted" }),
            op: "delete",
            source: BUTTON_AT,
          },
        ],
      })
    ).toBe("Deleted");
    expect(
      fallback({
        attrChanges: [
          {
            changes: [{ attribute: "alt", from: null, to: "x" }],
            element: element({ displayName: "Retagged" }),
            source: BUTTON_AT,
          },
        ],
      })
    ).toBe("Retagged");
  });
});

describe("preparePromptInput — comments and tokens", () => {
  it("passes comments through untouched", () => {
    // A comment already carries a repo-relative path and a real line; the
    // element resolver has nothing to add and would only corrupt it.
    const cwd = project();
    const comments = [
      {
        body: "tighten this",
        file: "src/App.tsx",
        fromLine: 4,
        jobId: "job-1",
        snippet: "<button>",
        toLine: 4,
      },
    ];
    expect(preparePromptInput(cwd, request({ comments })).comments).toEqual(
      comments
    );
  });

  it("carries the project's scanned design scale", () => {
    const cwd = project();
    const names = preparePromptInput(cwd, request()).tokens?.tokens.map(
      (t) => t.name
    );
    expect(names).toContain("--pk-space-md");
  });
});

describe("the rendered prompt", () => {
  it("carries context and a token legend the browser could not know", () => {
    // The premise of the whole preview round trip: these two blocks exist only
    // because the daemon read the project off disk. If this ever passes against
    // a client-side re-derivation, the server hop was unnecessary.
    const cwd = project();
    const text = buildEditPrompt(
      preparePromptInput(
        cwd,
        request({
          visualChanges: [
            {
              changes: [{ from: "12px", property: "padding", to: "16px" }],
              element: element(),
              source: BUTTON_AT,
            },
          ],
        })
      )
    );
    expect(text).toContain("Source context:");
    expect(text).toContain("src/App.tsx:4");
    expect(text).toContain("--pk-space-md");
  });

  it("routes a comments-only turn to the review prompt", () => {
    const cwd = project();
    const text = buildEditPrompt(
      preparePromptInput(
        cwd,
        request({
          comments: [
            {
              body: "tighten this",
              file: "src/App.tsx",
              fromLine: 4,
              jobId: "job-1",
              snippet: "<button>",
              toLine: 4,
            },
          ],
        })
      )
    );
    expect(text).toContain("The user reviewed the edit you just made");
    expect(text).toContain("tighten this");
  });
});
