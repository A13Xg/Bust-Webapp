import { describe, it, expect, vi } from 'vitest';

import {
  GEO_STORAGE_KEY,
  OUTCOME,
  classifyGeolocationError,
  classifyNotificationPermission,
  isRetryable,
  outcomeHint,
  outcomeLabel,
  requestLocation,
  storeCoords,
} from './permissionRequests.js';

describe('classifying permission outcomes', () => {
  it('maps the three geolocation error codes', () => {
    expect(classifyGeolocationError({ code: 1 })).toBe(OUTCOME.denied);
    expect(classifyGeolocationError({ code: 2 })).toBe(OUTCOME.unavailable);
    expect(classifyGeolocationError({ code: 3 })).toBe(OUTCOME.timeout);
  });

  it('treats an unrecognised or missing error as unavailable, not denied', () => {
    // Guessing "denied" would strand the user with no retry over a transient fault.
    expect(classifyGeolocationError(undefined)).toBe(OUTCOME.unavailable);
    expect(classifyGeolocationError({})).toBe(OUTCOME.unavailable);
  });

  it('reads a dismissed notification prompt as still askable', () => {
    expect(classifyNotificationPermission('granted')).toBe(OUTCOME.granted);
    expect(classifyNotificationPermission('denied')).toBe(OUTCOME.denied);
    expect(classifyNotificationPermission('default')).toBe(OUTCOME.dismissed);
    expect(classifyNotificationPermission('unsupported')).toBe(OUTCOME.unsupported);
  });

  /* The core rule: retry only where asking again can change the answer. */
  it('offers retry only for recoverable outcomes', () => {
    expect(isRetryable(OUTCOME.timeout)).toBe(true);
    expect(isRetryable(OUTCOME.unavailable)).toBe(true);
    expect(isRetryable(OUTCOME.dismissed)).toBe(true);

    expect(isRetryable(OUTCOME.denied)).toBe(false);
    expect(isRetryable(OUTCOME.unsupported)).toBe(false);
    expect(isRetryable(OUTCOME.granted)).toBe(false);
  });

  it('labels and explains every outcome it can produce', () => {
    for (const outcome of Object.values(OUTCOME)) {
      expect(outcomeLabel(outcome).length).toBeGreaterThan(0);
      if (outcome !== OUTCOME.granted) expect(outcomeHint(outcome)).toBeTruthy();
    }
    expect(outcomeHint(OUTCOME.granted)).toBeNull();
  });
});

describe('requestLocation', () => {
  it('resolves with coordinates when the position arrives', async () => {
    const geolocation = {
      getCurrentPosition: success => success({ coords: { latitude: 1.5, longitude: -2.5, altitude: 100 } }),
    };
    const result = await requestLocation({ geolocation });
    expect(result.outcome).toBe(OUTCOME.granted);
    expect(result.coords).toMatchObject({ lat: 1.5, long: -2.5, altitude: 100 });
  });

  it('resolves rather than rejects when the user denies', async () => {
    const geolocation = { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) };
    await expect(requestLocation({ geolocation })).resolves.toEqual({ outcome: OUTCOME.denied, coords: null });
  });

  it('reports an unsupported browser instead of throwing', async () => {
    await expect(requestLocation({ geolocation: undefined })).resolves.toEqual({
      outcome: OUTCOME.unsupported,
      coords: null,
    });
  });

  /* Some browsers have ignored the timeout option; without our own timer the
   * dialog would sit on ASKING… forever. */
  it('times out on its own when the browser never calls back', async () => {
    vi.useFakeTimers();
    try {
      const promise = requestLocation({ geolocation: { getCurrentPosition: () => {} }, timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toEqual({ outcome: OUTCOME.timeout, coords: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late callback that arrives after the timeout', async () => {
    vi.useFakeTimers();
    try {
      let late;
      const promise = requestLocation({
        geolocation: { getCurrentPosition: success => (late = success) },
        timeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(2000);
      late({ coords: { latitude: 9, longitude: 9, altitude: null } });
      await expect(promise).resolves.toEqual({ outcome: OUTCOME.timeout, coords: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('storeCoords', () => {
  it('writes coordinates under the key the rest of the app reads', () => {
    const setItem = vi.fn();
    storeCoords({ lat: 1, long: 2, altitude: null, at: 5 }, { setItem });
    expect(setItem).toHaveBeenCalledWith(GEO_STORAGE_KEY, JSON.stringify({ lat: 1, long: 2, altitude: null, at: 5 }));
  });

  it('survives storage that throws, and ignores a missing position', () => {
    expect(() =>
      storeCoords(
        { lat: 1 },
        {
          setItem: () => {
            throw new Error('blocked');
          },
        }
      )
    ).not.toThrow();
    expect(() => storeCoords(null, { setItem: vi.fn() })).not.toThrow();
  });
});
