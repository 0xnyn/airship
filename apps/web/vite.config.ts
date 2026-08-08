import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Plugin order matters: tailwind first so it sees every generated module, then
// TanStack Start (which owns the document shell and the route tree), then the
// React transform. No devtools plugin on purpose — this app gets driven through
// airship's own overlay, and a second floating panel in the corner fights it for
// the same screen real estate.
//
// Port 5173; airship's overlay always takes TARGET + 1, so `make run` serves the
// editor on 5174. See the root Makefile.
export default defineConfig({
  plugins: [tailwindcss(), tanstackStart(), react()],
  server: { port: 5173 },
});
