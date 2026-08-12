import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A throwaway self-signed certificate for the tests that stand up a TLS
 * listener.
 *
 * Generated per process rather than committed. A private key in git — even
 * one for `CN=localhost` that unlocks nothing — trips every secret scanner on
 * every pull request that carries it, and "it is a fixture" has to be said
 * again each time. `openssl` is on macOS, on every Linux, and on Windows via
 * Git for Windows and the GitHub runner image, so the price is one exec per
 * test file, cached for the rest of the process.
 *
 * Two days of validity is plenty: nothing verifies the chain (the probe and
 * the proxy both waive it for loopback dev servers), so the date only has to
 * cover the run.
 */
let cached: { cert: Buffer; key: Buffer } | undefined;

export function tlsFixture(): { cert: Buffer; key: Buffer } {
  if (cached) {
    return cached;
  }
  const dir = mkdtempSync(join(tmpdir(), "airship-tls-"));
  const cert = join(dir, "localhost.pem");
  const key = join(dir, "localhost-key.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-nodes",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (err) {
    throw new Error(
      "The TLS tests generate a throwaway certificate with `openssl`, which has to be on PATH.",
      { cause: err }
    );
  }
  cached = { cert: readFileSync(cert), key: readFileSync(key) };
  return cached;
}
