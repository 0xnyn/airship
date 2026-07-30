/**
 * The `--safe` screen for OpenCode.
 *
 * OpenCode has no OS sandbox, so this decision function *is* the sandbox: every
 * gated action is a live request that airship answers, and a wrong answer here
 * is not a rendering bug but an escape. Driven directly rather than through a
 * live server, because the interesting cases are the ones a cooperative model
 * never produces.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRunContext } from "../agent";
import { decidePermission, permissionRuleset } from "./opencode";
import type { OcPermissionAsked } from "./opencode-wire";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "airship-oc-perm-"));
  // `src/` has to exist: on macOS the temp root is reached through a symlink,
  // and a path whose parent does not exist yet cannot be canonicalized, so the
  // two spellings would not compare equal. Same reason `sandbox.test.ts`
  // creates it.
  mkdirSync(join(root, "src"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const ctxFor = (safe: boolean): AgentRunContext =>
  ({ input: { cwd: root, prompt: "", safe } }) as unknown as AgentRunContext;

const ask = (
  permission: string,
  metadata: Record<string, unknown>
): OcPermissionAsked => ({
  id: "per_1",
  metadata,
  permission,
  sessionID: "ses_1",
});

describe("permissionRuleset", () => {
  it("allows everything by name when unsandboxed", () => {
    const rules = permissionRuleset(false);
    expect(rules.every((r) => r.action === "allow")).toBe(true);
    // A single `*` rule is not enough — a run with only that still stopped to
    // ask about external_directory.
    expect(rules.map((r) => r.permission)).toContain("external_directory");
  });

  it("asks about edits and commands, and denies the network tools, under --safe", () => {
    const byName = new Map(
      permissionRuleset(true).map((r) => [r.permission, r.action])
    );
    expect(byName.get("edit")).toBe("ask");
    expect(byName.get("bash")).toBe("ask");
    expect(byName.get("webfetch")).toBe("deny");
    expect(byName.get("websearch")).toBe("deny");
    expect(byName.get("external_directory")).toBe("deny");
    expect(byName.get("read")).toBe("allow");
  });
});

describe("decidePermission", () => {
  it("allows an ordinary command", () => {
    expect(
      decidePermission(ask("bash", { command: "pnpm build" }), ctxFor(true))
    ).toEqual({ response: "once" });
  });

  it("refuses a destructive command", () => {
    const verdict = decidePermission(
      ask("bash", { command: "rm -rf /" }),
      ctxFor(true)
    );
    expect(verdict.response).toBe("reject");
    expect(verdict.reason).toContain("destructive");
  });

  it("allows an in-project edit and refuses one outside", () => {
    expect(
      decidePermission(
        ask("edit", { filePath: join(root, "src", "app.tsx") }),
        ctxFor(true)
      ).response
    ).toBe("once");
    expect(
      decidePermission(ask("edit", { filePath: "/etc/hosts" }), ctxFor(true))
        .response
    ).toBe("reject");
  });

  it("screens external_directory, which is what a /tmp command really trips", () => {
    // Verified against the live server: `rm -rf /tmp/...` raises
    // `external_directory` with the directories in metadata, not `bash`.
    const verdict = decidePermission(
      ask("external_directory", {
        command: "rm -rf /tmp/victim",
        directories: ["/tmp"],
      }),
      ctxFor(true)
    );
    expect(verdict.response).toBe("reject");
    expect(verdict.reason).toContain("/tmp");

    expect(
      decidePermission(
        ask("external_directory", { directories: [join(root, "sub")] }),
        ctxFor(true)
      ).response
    ).toBe("once");
  });

  it("refuses an unrecognised permission under --safe and allows it otherwise", () => {
    // The fallback is the load-bearing half: opencode gates permissions this
    // adapter has never heard of, and defaulting those to allow would turn each
    // one into a hole the moment it shipped.
    expect(
      decidePermission(ask("some_future_tool", {}), ctxFor(true)).response
    ).toBe("reject");
    expect(
      decidePermission(ask("some_future_tool", {}), ctxFor(false)).response
    ).toBe("once");
  });

  it("always returns an answer, whatever the shape of the request", () => {
    // An unanswered request blocks the turn indefinitely, so there is no path
    // through this function that declines to decide.
    for (const safe of [true, false]) {
      for (const name of ["bash", "edit", "external_directory", "mystery"]) {
        const verdict = decidePermission(ask(name, {}), ctxFor(safe));
        expect(["once", "reject"]).toContain(verdict.response);
      }
    }
  });
});
