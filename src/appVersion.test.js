import { describe, expect, it, vi } from 'vitest';
import {
  fetchBuildManifest,
  isStaleBuild,
  readServiceWorkerVersion,
  shouldCheckNow,
  UPDATE_CHECK_INTERVAL_MS,
} from './appVersion.js';

describe('isStaleBuild', () => {
  it('reports a mismatch as stale', () => {
    expect(isStaleBuild('abc123', { buildId: 'def456' })).toBe(true);
  });

  it('reports a match as current', () => {
    expect(isStaleBuild('abc123', { buildId: 'abc123' })).toBe(false);
  });

  // A rollback is a build change the user still needs to reload into. Build ids
  // are commit SHAs, so there is no ordering to compare — only equality.
  it('treats a rollback as an update', () => {
    expect(isStaleBuild('zzz999', { buildId: 'aaa111' })).toBe(true);
  });

  // A partial deploy, an HTML error page, or a captive portal must not nag the
  // user to reload into the build they are already running.
  it.each([
    ['null manifest', null],
    ['undefined manifest', undefined],
    ['empty object', {}],
    ['non-string buildId', { buildId: 42 }],
    ['empty buildId', { buildId: '' }],
  ])('never reports stale for %s', (_label, manifest) => {
    expect(isStaleBuild('abc123', manifest)).toBe(false);
  });

  // Unbuilt sources have no meaningful id; prompting a reload during `vite dev`
  // would fire on every save.
  it('never reports stale when running unbuilt sources', () => {
    expect(isStaleBuild('dev', { buildId: 'abc123' })).toBe(false);
    expect(isStaleBuild('', { buildId: 'abc123' })).toBe(false);
  });
});

describe('shouldCheckNow', () => {
  it('always allows the first check', () => {
    expect(shouldCheckNow(null, 1_000)).toBe(true);
  });

  it('blocks a second check inside the interval', () => {
    expect(shouldCheckNow(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
  });

  it('allows a check once the interval has elapsed', () => {
    expect(shouldCheckNow(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
  });

  // Otherwise a timezone change or an NTP correction wedges the check closed
  // until real time catches back up.
  it('recovers from a backwards clock jump', () => {
    expect(shouldCheckNow(9_000_000, 1_000)).toBe(true);
  });
});

describe('fetchBuildManifest', () => {
  // The whole point is learning what the server has NOW; a cached copy would
  // report the build the app already thinks it is running.
  it('bypasses the HTTP cache', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ buildId: 'x' }) }));
    await fetchBuildManifest('/version.json', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }));
  });

  it('returns null on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }));
    await expect(fetchBuildManifest('/version.json', fetchImpl)).resolves.toBeNull();
  });

  // Offline is the common case and must not surface as an error.
  it('returns null when the request throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchBuildManifest('/version.json', fetchImpl)).resolves.toBeNull();
  });

  it('returns null when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token <');
      },
    }));
    await expect(fetchBuildManifest('/version.json', fetchImpl)).resolves.toBeNull();
  });
});

describe('readServiceWorkerVersion', () => {
  it('resolves null when no worker controls the page', async () => {
    await expect(readServiceWorkerVersion({ serviceWorker: { controller: null } })).resolves.toBeNull();
  });

  // Called from a debug panel: a worker the browser already killed never
  // answers, and the panel must not hang waiting for it.
  it('resolves null rather than hanging when the worker never replies', async () => {
    const nav = { serviceWorker: { controller: { postMessage() {} } } };
    await expect(readServiceWorkerVersion(nav, 10)).resolves.toBeNull();
  });

  it('resolves the version the worker reports on the reply port', async () => {
    const nav = {
      serviceWorker: {
        controller: {
          postMessage(_message, [port]) {
            port.postMessage({ type: 'bust-sw-version', version: '2026-09-13.1' });
          },
        },
      },
    };
    await expect(readServiceWorkerVersion(nav, 500)).resolves.toBe('2026-09-13.1');
  });
});
