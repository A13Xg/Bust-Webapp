import { describe, it, expect, vi } from 'vitest';

import {
  BTC_CACHE_TTL_MS,
  btcChangePct,
  btcMoodLabel,
  fetchBitcoinPriceUsd,
  formatBtcChange,
  formatBtcCompact,
  formatBtcUsd,
  isPlausibleBtcPrice,
  readCachedBtcPrice,
  writeCachedBtcPrice,
} from './bitcoin.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
  };
}

const ok = payload => ({ ok: true, json: async () => payload });

describe('price validation', () => {
  it('rejects anything that is not a believable spot price', () => {
    for (const bad of [null, undefined, '', 'abc', NaN, Infinity, 0, -5, 50, 1e9]) {
      expect(isPlausibleBtcPrice(bad)).toBe(false);
    }
    for (const good of [101, 67432.19, '95000', 999_999]) {
      expect(isPlausibleBtcPrice(good)).toBe(true);
    }
  });
});

describe('fetching', () => {
  it('uses the primary source and caches the result', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => ok({ bitcoin: { usd: 67432.187 } }));
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 })).resolves.toBe(67432.19);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCachedBtcPrice(storage, 1000)).toBe(67432.19);
  });

  it('falls back to the secondary source when the first one fails', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async url =>
      url.includes('coingecko') ? { ok: false, json: async () => ({}) } : ok({ data: { amount: '95000.00' } })
    );
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 })).resolves.toBe(95000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('skips a source that returns an implausible price rather than stamping garbage', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async url =>
      url.includes('coingecko') ? ok({ bitcoin: { usd: 0 } }) : ok({ data: { amount: '71000' } })
    );
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 })).resolves.toBe(71000);
  });

  it('returns null instead of throwing when every source is unreachable', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 })).resolves.toBeNull();
  });

  it('returns null when there is no fetch implementation at all', async () => {
    await expect(fetchBitcoinPriceUsd({ fetchImpl: null, storage: memoryStorage() })).resolves.toBeNull();
  });

  it('serves a fresh cache without hitting the network', async () => {
    const storage = memoryStorage();
    writeCachedBtcPrice(50000, storage, 1000);
    const fetchImpl = vi.fn();
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 + BTC_CACHE_TTL_MS - 1 })).resolves.toBe(50000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refetches once the cache has aged out', async () => {
    const storage = memoryStorage();
    writeCachedBtcPrice(50000, storage, 1000);
    const fetchImpl = vi.fn(async () => ok({ bitcoin: { usd: 61000 } }));
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage, now: 1000 + BTC_CACHE_TTL_MS + 1 })).resolves.toBe(61000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('survives a storage that throws in private mode', async () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const fetchImpl = vi.fn(async () => ok({ bitcoin: { usd: 42000 } }));
    await expect(fetchBitcoinPriceUsd({ fetchImpl, storage: hostile, now: 1 })).resolves.toBe(42000);
  });
});

describe('formatting', () => {
  it('formats whole dollars with separators', () => {
    expect(formatBtcUsd(67432.19)).toBe('$67,432');
    expect(formatBtcUsd(null)).toBeNull();
  });

  it('formats a compact value for tight tiles', () => {
    expect(formatBtcCompact(67432)).toBe('$67.4k');
    expect(formatBtcCompact(1_250_000)).toBe('$1.25M');
    expect(formatBtcCompact(950)).toBe('$950');
    expect(formatBtcCompact('nope')).toBeNull();
  });

  it('describes the move since the previous bust', () => {
    expect(btcChangePct(110000, 100000)).toBeCloseTo(10);
    expect(btcChangePct(110000, null)).toBeNull();
    // A sub-threshold value is not a believable spot price, so it is not comparable.
    expect(btcChangePct(110, 100)).toBeNull();
    expect(formatBtcChange(110000, 100000)).toBe('+10.0% since last');
    expect(formatBtcChange(99500, 100000)).toBe('-0.50% since last');
    expect(formatBtcChange(100000, null)).toBeNull();
  });

  it('bands the price into a mood', () => {
    expect(btcMoodLabel(15000)).toBe('Capitulation');
    expect(btcMoodLabel(35000)).toBe('Accumulation');
    expect(btcMoodLabel(65000)).toBe('Cautious');
    expect(btcMoodLabel(95000)).toBe('Euphoria');
    expect(btcMoodLabel(150000)).toBe('Six Figures');
    expect(btcMoodLabel(500000)).toBe('Unhinged');
    expect(btcMoodLabel(undefined)).toBeNull();
  });
});
