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
  //
  // Both `navigator.platform` and the UA are consulted, and they must stay in
  // step with detectPushPlatform() in notifications.js, which tests the UA
  // only. `navigator.platform` is deprecated and a browser that stops
  // populating it would split the two detectors: push would call an iPad iOS
  // and report `ios-needs-install`, while this function would call it desktop
  // and hand the user the ANDROID install guide — wrong instructions at exactly
  // the moment they are needed to unblock push.
  const desktopClassIpad = (platform === 'MacIntel' || /Macintosh/i.test(ua)) && touchPoints > 1;
  const ios = /iPhone|iPad|iPod/i.test(ua) || desktopClassIpad;
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobile/i.test(ua);
  const safari = ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const chrome = android && /Chrome|CriOS/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
  return { ios, android, mobile, safari, chrome };
}
