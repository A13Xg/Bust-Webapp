/*
 * Install plumbing. No UI of its own — React renders the guide in a Lightbox.
 *
 * This stays a separate <script type="module">, loaded before main.jsx, for one
 * reason: Chromium fires `beforeinstallprompt` once, early, and never replays
 * it. Catching it after React mounts is a race we would sometimes lose, and
 * losing it silently downgrades native install to a screenshot.
 *
 * Because it is a separate entry point rather than an import of the app bundle,
 * it hands itself to React through `window.bustInstall`.
 */
import { detectInstallPlatform, isStandalone } from './pwaInstall.js';

const asset = path => (import.meta.env?.BASE_URL || '/') + String(path).replace(/^\//, '');

/* The guides you can actually follow, one screenshot per platform. */
const GUIDE = {
  ios: 'assets/images/iOS_webappGuide.png',
  android: 'assets/images/Android_webappGuide.png',
};

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
});

const bootPlatform = detectInstallPlatform();

/*
 * Per spec: the manual-instructions hook starts false everywhere, and the iOS
 * hook starts true only on iOS. iOS has no programmatic install path at all —
 * Apple has never implemented beforeinstallprompt — so there the guide is the
 * entire feature. On Android the native prompt leads and the guide is the
 * fallback for when it is unavailable or declined.
 */
export const installHooks = {
  manualInstructions: false,
  iosInstructions: Boolean(bootPlatform.ios),
};

export function guideFor(platform = detectInstallPlatform()) {
  return asset(platform.ios ? GUIDE.ios : GUIDE.android);
}

/**
 * Offer installation.
 *
 * Resolves to `{ outcome, guide }`. `guide` is non-null exactly when the caller
 * should show the screenshot. Must be called from a user gesture, because
 * `prompt()` requires one — it is invoked synchronously before the first await.
 */
async function showInstall() {
  const platform = detectInstallPlatform();
  if (isStandalone()) return { outcome: 'already-installed', guide: null };

  if (!platform.ios && deferredInstallPrompt) {
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        return { outcome: 'installed', guide: null };
      }
    } catch {
      // Fall through to the guide.
    }
  }

  if (platform.ios) installHooks.iosInstructions = true;
  else installHooks.manualInstructions = true;

  return { outcome: 'instructions', guide: guideFor(platform) };
}

const api = {
  hooks: installHooks,
  canNativeInstall: () => Boolean(deferredInstallPrompt),
  isInstalled: () => isStandalone(),
  guideFor,
  show: showInstall,
};

window.bustInstall = api;
export default api;
