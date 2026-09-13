/*
 * Stale-install detection.
 *
 * THE PROBLEM
 *
 * An installed PWA is not a page you refresh. On iOS a Home Screen app can keep
 * one document alive indefinitely — the user "closes" it and it is only
 * suspended — so it can run a bundle from weeks ago with no visible sign. That
 * matters here beyond the usual reasons: the push registration path lives in
 * that bundle, so a stale install keeps re-registering its endpoint using
 * whatever logic shipped back then, and every push fix silently fails to reach
 * the device that needed it most.
 *
 * `sw.js` cannot solve this on its own. It calls `skipWaiting()` on install, so
 * a new worker takes over immediately while the PAGE carries on running the old
 * JavaScript — the worker version and the app version are independent, and only
 * a reload replaces the second.
 *
 * THE MECHANISM
 *
 * The build stamps `__BUILD_ID__` into the bundle and emits the same value into
 * `version.json` next to it (see vite.config.js). Fetching that file and
 * comparing is the whole check: equal means current, different means the server
 * has moved on. Deliberately an inequality test and not an ordering test —
 * build ids are commit SHAs, which have no order, and a rollback should prompt
 * a reload just as an upgrade does.
 */

/* global __BUILD_ID__ */

/** The build this bundle was produced by. `dev` when running unbuilt sources. */
export const CURRENT_BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** Minimum gap between update checks, so a tab flipping in and out is cheap. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Whether a fetched manifest describes a different build than this one.
 *
 * Unknown values never count as an update: a missing or malformed
 * `version.json` (a 404 on a partial deploy, an HTML error page, a captive
 * portal) must not nag the user to reload into the same build forever.
 *
 * @param {string} currentBuildId
 * @param {{ buildId?: string }|null|undefined} manifest
 * @returns {boolean}
 */
export function isStaleBuild(currentBuildId, manifest) {
  const latest = manifest?.buildId;
  if (typeof latest !== 'string' || !latest) return false;
  if (!currentBuildId || currentBuildId === 'dev') return false;
  return latest !== currentBuildId;
}

/**
 * Fetch the deployed build manifest.
 *
 * `cache: 'no-store'` is load-bearing: the whole point is to learn what the
 * server has now, and an HTTP-cached copy of version.json would report the
 * build the app already believes it is running.
 *
 * Returns null on any failure. Offline is the common case and is not news.
 *
 * @returns {Promise<{buildId?: string, builtAt?: string}|null>}
 */
export async function fetchBuildManifest(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return null;
  try {
    const response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
    if (!response?.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * One update check. Returns true when the caller should offer a reload.
 *
 * @param {{ url: string, currentBuildId?: string, fetchImpl?: typeof fetch }} options
 */
export async function checkForUpdate({ url, currentBuildId = CURRENT_BUILD_ID, fetchImpl } = {}) {
  const manifest = await fetchBuildManifest(url, fetchImpl);
  return isStaleBuild(currentBuildId, manifest);
}

/**
 * Rate limiter for the foreground check.
 *
 * `visibilitychange` fires far more often than a deploy happens, and on iOS it
 * fires on every app-switcher glance. Without this the app would hit the
 * network every time the user peeked at it.
 *
 * @param {number|null} lastCheckedAt epoch ms, or null if never
 * @param {number} now epoch ms
 * @param {number} intervalMs
 */
export function shouldCheckNow(lastCheckedAt, now = Date.now(), intervalMs = UPDATE_CHECK_INTERVAL_MS) {
  if (!lastCheckedAt) return true;
  // A clock that jumped backwards (timezone change, NTP correction) would
  // otherwise wedge this closed until real time caught up.
  if (now < lastCheckedAt) return true;
  return now - lastCheckedAt >= intervalMs;
}

/**
 * Ask the active service worker which version it is running.
 *
 * Diagnostic only — the app version above is what decides whether to prompt.
 * A worker can legitimately be newer than the page it controls, because
 * `skipWaiting()` lets it activate without the page reloading.
 *
 * @returns {Promise<string|null>}
 */
export function readServiceWorkerVersion(nav = globalThis.navigator, timeoutMs = 2000) {
  return new Promise(resolve => {
    const worker = nav?.serviceWorker?.controller;
    if (!worker || typeof MessageChannel !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // A worker the browser has killed never answers, and this is called from a
    // debug panel that must not hang on it.
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => finish(event.data?.version || null);
      worker.postMessage({ type: 'bust-sw-version' }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}
