import { describe, expect, it } from 'vitest';

import { detectInstallPlatform, isStandalone } from './pwaInstall.js';

describe('PWA install platform detection', () => {
  it('detects iPhone Safari', () => {
    const platform = detectInstallPlatform({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(platform).toMatchObject({ ios: true, mobile: true, safari: true, android: false });
  });

  /* iPadOS reports a desktop-class UA; touch points are the only tell. Getting
   * this wrong sends an iPad down the Chromium branch, where beforeinstallprompt
   * never fires and the user is offered nothing at all. */
  it('detects iPadOS desktop-class user agents', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(platform.ios).toBe(true);
    expect(platform.mobile).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    });
    expect(platform.ios).toBe(false);
    expect(platform.mobile).toBe(false);
  });

  it('detects Android Chrome', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });
    expect(platform).toMatchObject({ android: true, mobile: true, chrome: true, ios: false });
  });

  /* An in-app browser on iOS cannot add to the Home Screen at all, so it must
   * not be reported as Safari. */
  it('does not report a third-party iOS browser as Safari', () => {
    const platform = detectInstallPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/132.0 Mobile/15E148',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });
    expect(platform.ios).toBe(true);
    expect(platform.safari).toBe(false);
  });

  it('survives a navigator with nothing on it', () => {
    expect(detectInstallPlatform({})).toMatchObject({ ios: false, android: false, mobile: false });
    expect(detectInstallPlatform(undefined)).toBeTruthy();
  });
});

describe('standalone detection', () => {
  it('is true when the display mode is standalone', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }), navigatorObject: {}, documentObject: {} })).toBe(true);
  });

  /* iOS exposes navigator.standalone rather than the display-mode query. */
  it('is true for an iOS home-screen launch', () => {
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigatorObject: { standalone: true }, documentObject: {} })
    ).toBe(true);
  });

  it('is false in an ordinary browser tab', () => {
    expect(
      isStandalone({ matchMedia: () => ({ matches: false }), navigatorObject: {}, documentObject: {} })
    ).toBe(false);
  });

  it('does not throw when matchMedia is unavailable', () => {
    expect(isStandalone({ matchMedia: undefined, navigatorObject: {}, documentObject: {} })).toBe(false);
  });
});
