import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __AIRSHIP_VERSION__: JSON.stringify("0.0.0-test") },
  test: { include: ["src/**/*.test.ts"] },
});
