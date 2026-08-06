/**
 * @airship/overlay/hook — installs bippy's React DevTools hook BEFORE the host
 * app's React renders, so React 19 captures owner-stack source metadata
 * (`fiber._debugStack`). Without this, `element-source` can resolve component
 * names (plain fiber traversal) but not file/line, and the picker shows
 * "source not resolved".
 *
 * The proxy injects this as a synchronous (non-`defer`) <head> script so it runs
 * during HTML parse, ahead of the app's deferred module entry. See
 * packages/server/src/proxy.ts (injectOverlay / serveAirshipAsset).
 */
import { instrument } from "bippy";

instrument({
  name: "airship",
  onCommitFiberRoot() {
    // No-op: we only need bippy's hook installed before React renders so owner
    // stacks are captured. Element source is resolved lazily on pick, not here.
  },
});
