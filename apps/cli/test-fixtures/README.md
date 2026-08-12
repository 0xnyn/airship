# Test fixtures

A self-signed certificate and key, used by `detect.test.ts` and
`serve.test.ts` to stand up throwaway TLS listeners on an ephemeral port —
which is the only way to test that the scheme probe can tell TLS from
plaintext.

This is not a credential. It is generated for `CN=localhost`, is committed
deliberately, and grants access to nothing. Regenerate with:

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout localhost-key.pem -out localhost.pem \
  -days 36500 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

The long expiry is deliberate: the probe waives verification, so an expired
fixture would still pass and the tests would keep working while quietly
testing something other than what they claim.
