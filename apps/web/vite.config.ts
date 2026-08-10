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
//
// Prerendered, because nothing on this page depends on the request. There is one
// route, its copy is imported from content/*.json at build time, and there is not
// a server function or loader in the app — so SSR was rendering the same bytes on
// every hit. `prerender` runs that same server bundle once at build time and
// writes dist/client/index.html, which is already the worker's assets directory:
// Cloudflare serves it as a static file and the worker never wakes up for a normal
// page view. The worker is still built and still deployed — it is what answers
// paths the assets do not match, which is how the 404 keeps rendering.
export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({ prerender: { enabled: true } }),
    react(),
  ],
  server: { port: 5173 },
});
