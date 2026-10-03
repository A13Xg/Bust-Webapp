import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/*
 * A build identity the running app can compare itself against.
 *
 * Two halves that must agree: `__BUILD_ID__` is compiled into the bundle, and
 * `version.json` is emitted beside it holding the same value. The app fetches
 * that file when it returns to the foreground; a mismatch means the page is
 * running an older build than the one deployed.
 *
 * This matters most on iOS, where a Home Screen PWA can keep the same document
 * alive for weeks and will happily run a months-old bundle — including an old
 * push registration path — with no visible sign that anything is stale.
 *
 * GITHUB_SHA when CI provides it, so the id is traceable to a commit; a
 * timestamp locally, which is enough to tell two dev builds apart.
 */
const buildId = process.env.GITHUB_SHA?.slice(0, 12) || `dev-${Date.now()}`;

function buildVersionManifest() {
  return {
    name: 'bust-build-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  base: process.env.GHPAGES_BASE || '/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react(), buildVersionManifest()],
});
