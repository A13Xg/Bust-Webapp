import { describe, expect, it, vi } from 'vitest';

import {
  INSTALL_DISMISS_KEY,
  INSTALL_DISMISS_MS,
  clearInstallPromptDismissal,
  detectInstallPlatform,
  installCopy,
  isStandalone,
  markInstallPromptDismissed,
  shouldShowInstallPrompt,
} from './pwaInstall.js';

function storageStub(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn(key => values.delete(key)),
  };
}

describe('PWA install platform detection', () => {
  it('detects iPhone Safari', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(platform).toMatchObject({ ios: true, mobile: true, safari: true, android: false });
  });

  it('detects iPadOS desktop-class user agents', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(platform.ios).toBe(true);
    expect(platform.mobile).toBe(true);
  });

  it('detects Android Chrome', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    expect(platform).toMatchObject({ android: true, mobile: true, chrome: true, ios: false });
  });
});

describe('PWA install visibility', () => {
  it('never shows while running standalone', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }), navigatorObject: {}, documentObject: {} })).toBe(true);
    expect(shouldShowInstallPrompt({ installed: true, platform: { mobile: true } })).toBe(false);
  });

  it('does not show on desktop', () => {
    expect(shouldShowInstallPrompt({ installed: false, platform: { mobile: false } })).toBe(false);
  });

  it('respects the seven-day dismissal window', () => {
    const now = 1_000_000_000;
    const storage = storageStub({ [INSTALL_DISMISS_KEY]: String(now - INSTALL_DISMISS_MS + 1) });
    expect(shouldShowInstallPrompt({ installed: false, platform: { mobile: true }, storage, now })).toBe(false);
  });

  it('shows again after the dismissal window expires', () => {
    const now = 1_000_000_000;
    const storage = storageStub({ [INSTALL_DISMISS_KEY]: String(now - INSTALL_DISMISS_MS - 1) });
    expect(shouldShowInstallPrompt({ installed: false, platform: { mobile: true }, storage, now })).toBe(true);
  });

  it('handles storage failures without breaking onboarding', () => {
    const storage = { getItem: vi.fn(() => { throw new Error('blocked'); }) };
    expect(shouldShowInstallPrompt({ installed: false, platform: { mobile: true }, storage })).toBe(true);
  });
});

describe('PWA install persistence and copy', () => {
  it('stores and clears dismissals safely', () => {
    const storage = storageStub();
    markInstallPromptDismissed(storage, 1234);
    expect(storage.setItem).toHaveBeenCalledWith(INSTALL_DISMISS_KEY, '1234');
    clearInstallPromptDismissal(storage);
    expect(storage.removeItem).toHaveBeenCalledWith(INSTALL_DISMISS_KEY);
  });

  it('uses native install copy only when a prompt is available', () => {
    expect(installCopy({ android: true, mobile: true }, true).mode).toBe('native');
    expect(installCopy({ android: true, mobile: true }, false).mode).toBe('generic');
  });

  it('gives iOS Safari manual Home Screen instructions', () => {
    const copy = installCopy({ ios: true, safari: true, mobile: true }, false);
    expect(copy.mode).toBe('ios-instructions');
    expect(copy.body).toMatch(/Home Screen/i);
  });
});
