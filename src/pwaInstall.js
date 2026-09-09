/*
 * Platform detection for the install flow.
 *
 * Two helpers, both consumed by installBootstrap.js: one to decide whether the
 * app is already installed, one to pick between the native prompt (Chromium)
 * and the screenshot guide (iOS, which has no programmatic install path).
 *
 * This module used to also carry a "not now" snooze — INSTALL_DISMISS_KEY,
 * shouldShowInstallPrompt, markInstallPromptDismissed, clearInstallPromptDismissal
 * — and installCopy, which supplied the title/body/action text for a hand-rolled
 * overlay. Both went away with that overlay: install is now explicitly requested
 * via the Permissions dialog's checkbox rather than nagged on a timer, so there
 * is nothing to snooze, and the Lightbox shows only the screenshot, so there is
 * no copy to supply.
 */

export function isStandalone({
  matchMedia = globalThis.matchMedia,
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
} = {}) {
  const displayModeStandalone = Boolean(matchMedia?.('(display-mode: standalone)')?.matches);
  const iosStandalone = navigatorObject?.standalone === true;
  const fullscreen = Boolean(documentObject?.fullscreenElement);
  return displayModeStandalone || iosStandalone || fullscreen;
}

export function detectInstallPlatform(navigatorObject = globalThis.navigator) {
  const ua = String(navigatorObject?.userAgent || '');
  const platform = String(navigatorObject?.platform || '');
  const touchPoints = Number(navigatorObject?.maxTouchPoints || 0);
  // iPadOS reports a desktop-class UA, so touch points are what give it away.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobile/i.test(ua);
  const safari = ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const chrome = android && /Chrome|CriOS/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
  return { ios, android, mobile, safari, chrome };
}
