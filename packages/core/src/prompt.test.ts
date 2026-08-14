import {
  EDIT_OUTPUT_JSON_SCHEMA,
  EditStructuredOutputSchema,
  type StyleChange,
} from "@airship/protocol";
import { describe, expect, it } from "vitest";
import {
  renderChange,
  structuredOutputInstruction,
  systemPrompt,
} from "./prompt";
import { splitStructured } from "./providers/opencode-events";

/*
 * The change line is the whole contract between the inspector and the agent for
 * a style edit, and the token clause is the part that is easy to get subtly
 * wrong: the same sentence has to serve a custom property, a utility class, a
 * near miss and an explicit detach, and each asks for a different edit.
 */

const base: StyleChange = {
  from: "12px",
  property: "padding-top",
  to: "16px",
};

describe("renderChange", () => {
  it("renders a bare delta when no token was resolved", () => {
    expect(renderChange(base)).toBe("padding-top: 12px → 16px");
  });

  it("tells the agent to write a custom property in place of the value", () => {
    const line = renderChange({
      ...base,
      token: { exact: true, kind: "css-var", name: "--pk-space-md" },
    });
    expect(line).toContain("[token: --pk-space-md");
    expect(line).toContain("write this token instead of the literal value");
  });

  it("tells the agent to add a utility class rather than write a value", () => {
    // The distinction that matters: a class is applied to the element, it is
    // not a value that can appear on the right of a declaration.
    const line = renderChange({
      ...base,
      token: { exact: true, kind: "utility-class", name: ".pt-4" },
    });
    expect(line).toContain("[token: .pt-4");
    expect(line).toContain("add this utility class to the element");
  });

  it("carries the value delta even when a class token is named", () => {
    // Regression: `to` used to be the token's *name*, so this line read
    // `padding-top: 12px → .pt-4`, which is not a value the agent can act on.
    expect(
      renderChange({
        ...base,
        token: { exact: true, kind: "utility-class", name: ".pt-4" },
      })
    ).toContain("padding-top: 12px → 16px");
  });

  it("phrases a near miss as a suggestion, not an instruction", () => {
    const line = renderChange({
      ...base,
      to: "13px",
      token: {
        actual: "12px",
        exact: false,
        kind: "css-var",
        name: "--pk-space-sm",
      },
    });
    expect(line).toContain("nearest token: --pk-space-sm = 12px");
    expect(line).toContain("unless the exact value was deliberate");
  });

  it("states a detach as a standing instruction", () => {
    const line = renderChange({ ...base, hardcode: true });
    expect(line).toContain("do not substitute a token");
  });

  it("lets a detach win over a token that slipped through", () => {
    // The change set drops the token on a hardcoded slot, so this should not be
    // reachable — the assertion is that the renderer does not contradict it if
    // it ever is.
    const line = renderChange({
      ...base,
      hardcode: true,
      token: { exact: true, kind: "css-var", name: "--pk-space-md" },
    });
    expect(line).not.toContain("--pk-space-md");
  });
});

/*
 * The structured-output contract rides the opencode system prompt because
 * opencode's `format` option cannot be relied on (its forced tool call is
 * rejected by thinking models). These assertions run against the schema, not
 * literals, so adding a field fails the test instead of silently drifting.
 */
describe("structured output contract", () => {
  it("rides the opencode system prompt and names every schema field", () => {
    const sys = systemPrompt("opencode");
    expect(sys).toContain("<structuredoutput>");
    for (const name of EDIT_OUTPUT_JSON_SCHEMA.required) {
      expect(sys).toContain(`"${name}"`);
    }
  });

  it("stays out of the claude and codex prompts", () => {
    // Both constrain the decode natively; wrapper-tag instructions there would
    // only invite stray tags in prose.
    expect(systemPrompt("claude")).not.toContain("<structuredoutput>");
    expect(systemPrompt("codex")).not.toContain("<structuredoutput>");
  });

  it("contains no filled-in example a model could echo", () => {
    // A model that echoed a complete example verbatim would hand the extractor
    // a payload that parses. The tags appear empty, side by side.
    expect(structuredOutputInstruction()).toContain(
      "<structuredoutput></structuredoutput>"
    );
  });

  it("round-trips a payload written as instructed through the extractor", () => {
    // Pins the prompt and the extractor together: if either side changes its
    // spelling of the wrapper, this breaks here instead of in production.
    const payload = {
      filesChanged: ["src/app.tsx"],
      followUps: ["Tighten the focus ring"],
      summary: "Rounded the card corners.",
    };
    const message = `All done — the card now uses the token.\n\n<structuredoutput>${JSON.stringify(payload)}</structuredoutput>`;
    const { payload: lifted, prose } = splitStructured(message);
    expect(prose).toBe("All done — the card now uses the token.\n\n");
    const parsed = EditStructuredOutputSchema.safeParse(
      JSON.parse(lifted ?? "null")
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });
});
