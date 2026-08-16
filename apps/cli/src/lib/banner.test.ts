import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { exposureBanner, warnBackendLimits } from "./banner";
import { setColorEnabled } from "./terminal";

/*
 * The launch warnings, which are the only thing standing between a user and a
 * flag that is being silently dropped.
 *
 * This file exists because there was no `banner.test.ts` when `warnBackendLimits`
 * was switched from reading `--model` to reading the resolved per-backend map.
 * Its one caller was never updated to pass that map, so the opencode warning read
 * `undefined` forever and could not fire — and `airship --agent opencode --model
 * sonnet`, which opencode cannot resolve and drops on the floor, launched clean.
 * Nothing failed, because nothing was looking.
 *
 * Every case runs against a repository this file builds, rather than against
 * `process.cwd()`. The git warning is unconditional now and `gitStatus` checks
 * for a commit identity, and a CI checkout has none — `actions/checkout` sets
 * no `user.name`/`user.email` — so asserting an empty stderr against the ambient
 * repo passed on a developer's machine and failed on every runner. What each
 * case is about is the flag warning, so the git half has to be a constant.
 */

/**
 * A repository `gitStatus` reports no error for: work tree, HEAD, identity.
 *
 * Minted here rather than in `beforeAll`, and `const`, so that it is a freshly
 * created temp directory from the first statement of this file onwards. The
 * teardown below is a recursive force-delete of whatever this names, and a
 * `let` assigned in a hook can be something else entirely if that hook throws
 * before reaching the assignment.
 */
const REPO = mkdtempSync(join(tmpdir(), "airship-banner-repo-"));

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Everything written to stderr while `run` executes. */
function stderrFrom(run: () => void): string {
  let out = "";
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      out += String(chunk);
      return true;
    });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return out;
}

beforeAll(() => {
  // `-b main` keeps `init.defaultBranch` advice off stderr, and the identity is
  // set locally so it outranks whatever the machine running this has — or does
  // not have, which is the case that broke.
  git(REPO, "init", "-q", "-b", "main");
  git(REPO, "config", "user.email", "test@example.com");
  git(REPO, "config", "user.name", "Test");
  git(REPO, "config", "commit.gpgsign", "false");
  writeFileSync(join(REPO, "file.txt"), "one\n");
  git(REPO, "add", "-A");
  // Without HEAD, `gitStatus` reports "no commits yet" and every case below
  // picks up a warning it is not about.
  git(REPO, "commit", "-q", "-m", "initial");
});

afterAll(() => {
  rmSync(REPO, { force: true, maxRetries: 3, recursive: true });
});

describe("warnBackendLimits", () => {
  beforeAll(() => {
    // Assertions match on characters, not on ANSI.
    setColorEnabled(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("a bare model id on opencode", () => {
    it("warns, naming the id and the form it needed", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({
          agent: "opencode",
          cwd: REPO,
          models: { opencode: "sonnet" },
        })
      );

      expect(out).toContain("sonnet");
      expect(out).toContain("provider/model");
      // The suggestion has to be actionable, not just a complaint.
      expect(out).toContain("anthropic/sonnet");
    });

    it("stays quiet once the id names its provider", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({
          agent: "opencode",
          cwd: REPO,
          models: { opencode: "anthropic/claude-sonnet-5" },
        })
      );

      expect(out).toBe("");
    });

    it("stays quiet on the backends that take a bare id", () => {
      for (const agent of ["claude", "codex"] as const) {
        const out = stderrFrom(() =>
          warnBackendLimits({
            agent,
            cwd: REPO,
            models: { [agent]: "sonnet" },
          })
        );

        expect(out).toBe("");
      }
    });

    it("reads the entry for the running backend, not another one", () => {
      // The map always carries all three, because `--model` fills every entry
      // it does not override. Warning off claude's copy while codex runs would
      // fire on every `airship --agent codex --model sonnet`.
      const out = stderrFrom(() =>
        warnBackendLimits({
          agent: "codex",
          cwd: REPO,
          models: {
            claude: "sonnet",
            codex: "gpt-5.3-codex",
            opencode: "sonnet",
          },
        })
      );

      expect(out).toBe("");
    });
  });

  describe("claude-only knobs", () => {
    it("warns that --max-budget is dropped elsewhere", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({ agent: "codex", cwd: REPO, maxBudgetUsd: 5 })
      );

      expect(out).toContain("--max-budget");
    });

    it("warns that --max-turns is dropped elsewhere", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({ agent: "opencode", cwd: REPO, maxTurns: 24 })
      );

      expect(out).toContain("--max-turns");
    });

    it("keeps both for claude itself", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({
          agent: "claude",
          cwd: REPO,
          maxBudgetUsd: 5,
          maxTurns: 24,
        })
      );

      expect(out).toBe("");
    });
  });

  describe("--effort", () => {
    it("warns that opencode has no reasoning-effort control", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({ agent: "opencode", cwd: REPO, effort: "high" })
      );

      expect(out).toContain("--effort");
      expect(out).toContain("--opencode-config");
    });

    it("stays quiet for the two backends that honour it", () => {
      for (const agent of ["claude", "codex"] as const) {
        const out = stderrFrom(() =>
          warnBackendLimits({ agent, cwd: REPO, effort: "high" })
        );

        expect(out).toBe("");
      }
    });
  });

  it("says nothing at all when every flag is one the backend honours", () => {
    const out = stderrFrom(() =>
      warnBackendLimits({
        agent: "claude",
        cwd: REPO,
        effort: "high",
        maxBudgetUsd: 5,
        maxTurns: 24,
        models: { claude: "opus" },
      })
    );

    expect(out).toBe("");
  });

  /*
   * Said once at launch, rather than discovered at the first click.
   *
   * Unconditional, unlike the rest of this file's warnings: whatever is wrong
   * with git breaks Commit and Create pull request on every backend. The
   * backend-specific half is the diff baseline, which only codex and opencode
   * reconstruct from HEAD.
   */
  describe("git", () => {
    const plain = mkdtempSync(join(tmpdir(), "airship-banner-nogit-"));

    afterAll(() => {
      rmSync(plain, { force: true, maxRetries: 3, recursive: true });
    });

    it("warns for a directory that is not a repository, naming it", () => {
      const out = stderrFrom(() =>
        warnBackendLimits({ agent: "claude", cwd: plain })
      );

      expect(out).toContain("not a git repository");
      expect(out).toContain(plain);
      expect(out).toContain("git init");
    });

    it("adds the baseline consequence only for a backend that has one", () => {
      const claude = stderrFrom(() =>
        warnBackendLimits({ agent: "claude", cwd: plain })
      );
      const codex = stderrFrom(() =>
        warnBackendLimits({ agent: "codex", cwd: plain })
      );

      expect(claude).not.toContain("diff baseline");
      expect(codex).toContain("diff baseline");
    });

    it("stays silent in a healthy repository", () => {
      expect(
        stderrFrom(() => warnBackendLimits({ agent: "claude", cwd: REPO }))
      ).toBe("");
    });

    /*
     * A work tree with a HEAD and no `user.email`/`user.name` — which is what
     * every CI checkout is, since `actions/checkout` configures neither. It is
     * a repository by every other measure, so it reads healthy right up to the
     * commit that fails, and it is the case that turned this file red on the
     * runner while passing on the machine that wrote it.
     */
    it("warns for a repository with no commit identity", () => {
      const anon = mkdtempSync(join(tmpdir(), "airship-banner-anon-"));
      // The identity is set only long enough to make the commit, then removed:
      // `gitStatus` wants a HEAD before it looks at the identity at all.
      git(anon, "init", "-q", "-b", "main");
      git(anon, "config", "user.email", "test@example.com");
      git(anon, "config", "user.name", "Test");
      git(anon, "config", "commit.gpgsign", "false");
      writeFileSync(join(anon, "file.txt"), "one\n");
      git(anon, "add", "-A");
      git(anon, "commit", "-q", "-m", "initial");
      git(anon, "config", "--unset", "user.email");
      git(anon, "config", "--unset", "user.name");

      // The developer's own global config must not decide this — with one, the
      // repo resolves an identity and the case passes vacuously.
      // `GIT_CONFIG_GLOBAL=/dev/null` is not portable; an empty file is.
      const empty = join(anon, ".gitconfig-empty");
      writeFileSync(empty, "");
      const priorGlobal = process.env.GIT_CONFIG_GLOBAL;
      const priorSystem = process.env.GIT_CONFIG_SYSTEM;
      process.env.GIT_CONFIG_GLOBAL = empty;
      process.env.GIT_CONFIG_SYSTEM = empty;
      try {
        const out = stderrFrom(() =>
          warnBackendLimits({ agent: "claude", cwd: anon })
        );

        expect(out).toContain("no commit identity");
        expect(out).toContain(anon);
        // The hint is the fix, and it is the whole reason this warns at launch
        // rather than at the first click on Commit.
        expect(out).toContain("git config --global user.email");
      } finally {
        // `delete`, not `= undefined`: assigning to `process.env` coerces, so
        // that would leave the literal string "undefined" behind as a path.
        if (priorGlobal === undefined) {
          delete process.env.GIT_CONFIG_GLOBAL;
        } else {
          process.env.GIT_CONFIG_GLOBAL = priorGlobal;
        }
        if (priorSystem === undefined) {
          delete process.env.GIT_CONFIG_SYSTEM;
        } else {
          process.env.GIT_CONFIG_SYSTEM = priorSystem;
        }
        rmSync(anon, { force: true, maxRetries: 3, recursive: true });
      }
    });
  });
});

describe("exposureBanner", () => {
  for (const host of ["127.0.0.1", "::1", "[::1]", "localhost"]) {
    it(`stays silent for the loopback bind ${host}`, () => {
      expect(exposureBanner(host)).toBe("");
    });
  }

  for (const host of ["0.0.0.0", "::", "192.168.1.5", "dev.local"]) {
    it(`warns for ${host}, naming the interface`, () => {
      const banner = exposureBanner(host);
      expect(banner).toContain(host);
      expect(banner).toContain("no authentication");
    });
  }
});
