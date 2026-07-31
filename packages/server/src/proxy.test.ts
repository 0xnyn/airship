import type http from "node:http";
import { AIRSHIP_SURFACE_COOKIE } from "@airship/protocol";
import { describe, expect, it } from "vitest";
import { resolveMode } from "./proxy";

/** Just enough of an IncomingMessage for `resolveMode`. */
function req(opts: {
  cookie?: string;
  dest?: string;
  url?: string;
}): http.IncomingMessage {
  return {
    headers: {
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.dest ? { "sec-fetch-dest": opts.dest } : {}),
    },
    url: opts.url ?? "/",
  } as unknown as http.IncomingMessage;
}

const cookie = (surface: string): string =>
  `${AIRSHIP_SURFACE_COOKIE}=${surface}`;

describe("resolveMode", () => {
  describe("an explicit ?__airship= always wins", () => {
    for (const mode of ["shell", "inline", "frame"] as const) {
      it(`serves ${mode} regardless of default, dest or cookie`, () => {
        const request = req({
          cookie: cookie("canvas"),
          dest: "empty",
          url: `/?__airship=${mode}`,
        });
        expect(resolveMode(request, "shell")).toBe(mode);
        expect(resolveMode(request, "inline")).toBe(mode);
      });
    }

    it("ignores a value that is not a mode", () => {
      expect(resolveMode(req({ url: "/?__airship=canvas" }), "shell")).toBe(
        "shell"
      );
    });
  });

  describe("a document navigation takes the default", () => {
    for (const dest of [undefined, "document"]) {
      it(`serves the canvas default for dest=${dest ?? "(absent)"}`, () => {
        expect(resolveMode(req({ dest }), "shell")).toBe("shell");
      });

      it(`serves the inline default for dest=${dest ?? "(absent)"}`, () => {
        expect(resolveMode(req({ dest }), "inline")).toBe("inline");
      });
    }
  });

  describe("the surface cookie outranks the launch default", () => {
    it("makes a canvas launch serve inline", () => {
      expect(resolveMode(req({ cookie: cookie("inline") }), "shell")).toBe(
        "inline"
      );
    });

    it("makes an inline launch serve the canvas", () => {
      expect(resolveMode(req({ cookie: cookie("canvas") }), "inline")).toBe(
        "shell"
      );
    });

    it("is found among other cookies", () => {
      const request = req({
        cookie: `theme=dark; ${cookie("inline")}; sid=abc`,
      });
      expect(resolveMode(request, "shell")).toBe("inline");
    });

    it("falls back to the default when the value is not a surface", () => {
      const request = req({ cookie: `${AIRSHIP_SURFACE_COOKIE}=shell` });
      expect(resolveMode(request, "shell")).toBe("shell");
    });

    it("never applies to a frame", () => {
      const request = req({ cookie: cookie("inline"), dest: "iframe" });
      expect(resolveMode(request, "shell")).toBe("frame");
    });

    it("never applies to an HTML partial", () => {
      const request = req({ cookie: cookie("canvas"), dest: "empty" });
      expect(resolveMode(request, "inline")).toBe("passthrough");
    });
  });

  describe("embedded destinations", () => {
    for (const dest of ["iframe", "embed", "object"]) {
      it(`promotes ${dest} to a frame under the canvas`, () => {
        expect(resolveMode(req({ dest }), "shell")).toBe("frame");
      });

      // The regression this guards: under inline there is no shell driving
      // frames, so an iframe in the document is the app's own — a video embed,
      // a payment form — and installing a frame agent in it would be injecting
      // the editor into a third party for no purpose.
      it(`leaves ${dest} untouched under inline`, () => {
        expect(resolveMode(req({ dest }), "inline")).toBe("passthrough");
      });
    }
  });

  describe("everything else passes through", () => {
    for (const dest of ["empty", "script", "style", "image"]) {
      it(`passes through dest=${dest}`, () => {
        expect(resolveMode(req({ dest }), "shell")).toBe("passthrough");
        expect(resolveMode(req({ dest }), "inline")).toBe("passthrough");
      });
    }
  });
});
