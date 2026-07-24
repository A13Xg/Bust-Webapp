export const INSTALL_DISMISS_KEY = 'bust_pwa_install_dismissed_at';
export const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

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
  const ios = /iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobile/i.test(ua);
  const safari = ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const chrome = android && /Chrome|CriOS/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
  return { ios, android, mobile, safari, chrome };
}

export function shouldShowInstallPrompt({
  installed = isStandalone(),
  platform = detectInstallPlatform(),
  storage = globalThis.localStorage,
  now = Date.now(),
  dismissMs = INSTALL_DISMISS_MS,
} = {}) {
  if (installed || !platform.mobile) return false;
  try {
    const dismissedAt = Number(storage?.getItem?.(INSTALL_DISMISS_KEY));
    if (Number.isFinite(dismissedAt) && now - dismissedAt < dismissMs) return false;
  } catch {}
  return true;
}

export function markInstallPromptDismissed(storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage?.setItem?.(INSTALL_DISMISS_KEY, String(now));
  } catch {}
}

export function clearInstallPromptDismissal(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(INSTALL_DISMISS_KEY);
  } catch {}
}

export function installCopy(platform, canNativeInstall = false) {
  if (platform.ios) {
    return {
      title: 'Install BUST on iPhone',
      body: platform.safari
        ? 'Add BUST to your Home Screen so mobile notifications can work reliably when Safari is closed.'
        : 'Open this page in Safari, then add BUST to your Home Screen to enable reliable mobile notifications.',
      action: platform.safari ? 'Show me how' : 'Open in Safari',
      mode: platform.safari ? 'ios-instructions' : 'ios-browser-warning',
    };
  }
  if (platform.android && canNativeInstall) {
    return {
      title: 'Install the BUST app',
      body: 'Install BUST for faster access and reliable notifications while the browser is closed.',
      action: 'Install app',
      mode: 'native',
    };
  }
  return {
    title: 'Install BUST',
    body: 'Use your browser menu and choose “Install app” or “Add to Home screen.”',
    action: 'View instructions',
    mode: 'generic',
  };
}
