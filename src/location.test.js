import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireLocation, clearLocation, newestOwnLocation, validCoords } from './location.js';

afterEach(() => {
  clearLocation();
  vi.useRealTimers();
});

describe('location acquisition', () => {
  it('shares an outstanding native request while each caller keeps its deadline', async () => {
    vi.useFakeTimers();
    const getCurrentPosition = vi.fn();
    const geolocation = { getCurrentPosition };
    const startup = acquireLocation({ geolocation, timeoutMs: 10000 });
    const bust = acquireLocation({ geolocation, timeoutMs: 5000 });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(bust).resolves.toMatchObject({ outcome: 'timeout' });
    getCurrentPosition.mock.calls[0][0]({
      timestamp: Date.now(),
      coords: { latitude: 0, longitude: 0, altitude: null, accuracy: 5 },
    });
    await expect(startup).resolves.toMatchObject({ outcome: 'granted', coords: { lat: 0, long: 0 } });
  });

  it('ignores invalid coordinates and selects the newest valid own prior bust', () => {
    expect(validCoords({ lat: null, long: 0, at: Date.now() })).toBeNull();
    expect(
      newestOwnLocation(
        [
          { user_id: 'other', timestamp: '2025-03-03', lat: 50, long: 60 },
          { user_id: 'me', timestamp: '2025-03-02', lat: null, long: null },
          { user_id: 'me', timestamp: '2025-03-01', lat: 0, long: 0 },
        ],
        'me'
      )
    ).toMatchObject({ lat: 0, long: 0 });
  });
});
