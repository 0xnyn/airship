import { describe, expect, it } from "vitest";
import {
  bindUrl,
  buildAllowedHosts,
  denyResponse,
  isAllowedHost,
  normalizeHostname,
  originMatchesHost,
  parseHostHeader,
} from "./access";

const NONE: ReadonlySet<string> = new Set();

describe("parseHostHeader", () => {
  it("parses a plain host and port", () => {
    expect(parseHostHeader("localhost:3000")).toEqual({
      host: "localhost:3000",
      hostname: "localhost",
    });
  });

  it("parses a bracketed IPv6 literal", () => {
    expect(parseHostHeader("[::1]:4001")).toEqual({
      host: "[::1]:4001",
      hostname: "::1",
    });
  });

  it("drops a default port the way URL does", () => {
    expect(parseHostHeader("example.test:80")?.host).toBe("example.test");
  });

  for (const bad of [
    undefined,
    "",
    "evil.com@localhost:3000",
    "localhost/path",
    "localhost:3000/x",
    "local host",
    "host\r\nx: y",
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(parseHostHeader(bad)).toBeNull();
    });
  }
});

describe("originMatchesHost", () => {
  it("allows an absent Origin (curl, CLI, tests)", () => {
    expect(originMatchesHost(undefined, "localhost:3000")).toBe(true);
  });

  it("allows a matching origin", () => {
    expect(originMatchesHost("http://localhost:3000", "localhost:3000")).toBe(
      true
    );
  });

  it("cancels default ports through the origin's own scheme", () => {
    expect(originMatchesHost("http://localhost", "localhost:80")).toBe(true);
    expect(originMatchesHost("https://x.ngrok.io", "x.ngrok.io:443")).toBe(
      true
    );
    expect(originMatchesHost("https://x.ngrok.io", "x.ngrok.io")).toBe(true);
  });

  it("is case-insensitive and tolerates a trailing dot mismatch in case", () => {
    expect(originMatchesHost("http://LocalHost:3000", "localhost:3000")).toBe(
      true
    );
  });

  it("canonicalises IPv6 spellings through URL", () => {
    expect(originMatchesHost("http://[::1]:3000", "[::1]:3000")).toBe(true);
  });

  for (const [origin, host] of [
    ["http://evil.com", "localhost:3000"],
    ["null", "localhost:3000"],
    ["", "localhost:3000"],
    ["file:///x", "localhost:3000"],
    ["http://localhost:3000, http://evil.com", "localhost:3000"],
    ["http://localhost:3001", "localhost:3000"],
    ["http://evil.com@localhost:3000", "localhost:3000"],
  ] as const) {
    it(`denies origin ${JSON.stringify(origin)} against ${host}`, () => {
      expect(originMatchesHost(origin, host)).toBe(false);
    });
  }

  it("denies a comma-joined duplicate Origin arriving as an array", () => {
    expect(
      originMatchesHost(
        ["http://localhost:3000", "http://evil.com"],
        "localhost:3000"
      )
    ).toBe(false);
  });

  it("denies when the Host itself does not parse", () => {
    expect(originMatchesHost("http://localhost:3000", undefined)).toBe(false);
    expect(
      originMatchesHost("http://localhost:3000", "evil.com@localhost:3000")
    ).toBe(false);
  });
});

describe("isAllowedHost", () => {
  for (const name of [
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0",
    "192.168.1.5",
  ]) {
    it(`always allows ${name}`, () => {
      expect(isAllowedHost(name, NONE)).toBe(true);
    });
  }

  it("allows a bracketed IPv6 literal", () => {
    expect(isAllowedHost("[::1]", NONE)).toBe(true);
  });

  for (const name of ["evil.com", "evillocalhost", "127.1", "2130706433"]) {
    it(`denies ${name} with an empty allowlist`, () => {
      expect(isAllowedHost(name, NONE)).toBe(false);
    });
  }

  it("matches an allowlist entry exactly, case-insensitively", () => {
    const allowed = new Set(["myapp.test"]);
    expect(isAllowedHost("MyApp.Test", allowed)).toBe(true);
    expect(isAllowedHost("myapp.test.", allowed)).toBe(true);
  });

  it("never suffix-matches an allowlist entry", () => {
    const allowed = new Set(["myapp.test"]);
    expect(isAllowedHost("x.myapp.test", allowed)).toBe(false);
    expect(isAllowedHost("evilmyapp.test", allowed)).toBe(false);
  });
});

describe("buildAllowedHosts", () => {
  it("normalizes entries", () => {
    expect(buildAllowedHosts([" MyApp.Test. ", ""], undefined)).toEqual(
      new Set(["myapp.test"])
    );
  });

  it("adds a named bind host so airship serves its own URL", () => {
    expect(buildAllowedHosts([], "dev.local")).toEqual(new Set(["dev.local"]));
  });

  it("does not add an IP bind host — literals are always allowed anyway", () => {
    expect(buildAllowedHosts([], "0.0.0.0")).toEqual(new Set());
  });
});

describe("bindUrl", () => {
  it("presents loopback and wildcard binds as localhost", () => {
    expect(bindUrl("127.0.0.1", 4001)).toBe("http://localhost:4001");
    expect(bindUrl("0.0.0.0", 4001)).toBe("http://localhost:4001");
    expect(bindUrl("::", 4001)).toBe("http://localhost:4001");
    expect(bindUrl("localhost", 4001)).toBe("http://localhost:4001");
  });

  it("brackets an IPv6 literal", () => {
    expect(bindUrl("::1", 4001)).toBe("http://[::1]:4001");
  });

  it("keeps a name", () => {
    expect(bindUrl("dev.local", 4001)).toBe("http://dev.local:4001");
  });
});

describe("the IPv6 loopback round trip", () => {
  // --host ::1 → the printed URL → the Host header a browser then sends →
  // back through the parser and the allowlist. Each hop feeds the next; a
  // break anywhere strands the user who asked for the v6 stack.
  it("survives bind → url → Host header → allow", () => {
    const url = new URL(bindUrl("::1", 4001));
    expect(url.host).toBe("[::1]:4001");
    const parsed = parseHostHeader(url.host);
    expect(parsed).not.toBeNull();
    expect(isAllowedHost(parsed?.hostname ?? "", NONE)).toBe(true);
    expect(originMatchesHost(url.origin, url.host)).toBe(true);
  });
});

describe("normalizeHostname", () => {
  it("lowercases, unbrackets and strips one trailing dot", () => {
    expect(normalizeHostname("LOCALHOST.")).toBe("localhost");
    expect(normalizeHostname("[::1]")).toBe("::1");
  });
});

describe("denyResponse", () => {
  it("is a complete, well-terminated 403 that never echoes input", () => {
    const bytes = denyResponse("Forbidden host");
    expect(bytes.startsWith("HTTP/1.1 403 Forbidden\r\n")).toBe(true);
    expect(bytes).toContain("connection: close\r\n");
    expect(bytes).toContain("content-length: 15\r\n");
    expect(bytes.endsWith("\r\n\r\nForbidden host\n")).toBe(true);
  });
});
