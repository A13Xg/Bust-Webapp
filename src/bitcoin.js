/*
 * Bitcoin spot price, stamped onto each bust alongside temperature, pressure
 * and tide.
 *
 * Two independent public endpoints, tried in order, because a bust must never
 * fail or stall on a market-data lookup — the price is decoration, the bust is
 * the record. Everything here returns null rather than throwing.
 */

const CACHE_KEY = 'bust_btc_price';
// The cooldown is two hours, so a short cache still gives each bust a fresh
// price while surviving a burst of retries or a double-mounted effect.
export const BTC_CACHE_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

export const BTC_SOURCES = [
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse: data => data?.bitcoin?.usd,
  },
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    parse: data => data?.data?.amount,
  },
];

/** Finite, positive, and inside a range that rules out a parse landing on garbage. */
export function isPlausibleBtcPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 100 && price < 100_000_000;
}

export function readCachedBtcPrice(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(CACHE_KEY) || 'null');
    if (!parsed || !isPlausibleBtcPrice(parsed.usd)) return null;
    if (!Number.isFinite(parsed.at) || now - parsed.at > BTC_CACHE_TTL_MS) return null;
    return Number(parsed.usd);
  } catch {
    return null;
  }
}

export function writeCachedBtcPrice(usd, storage = globalThis.localStorage, now = Date.now()) {
  if (!isPlausibleBtcPrice(usd)) return;
  try {
    storage?.setItem?.(CACHE_KEY, JSON.stringify({ usd: Number(usd), at: now }));
  } catch {
    // private mode / quota — the price is optional, so this is not worth reporting
  }
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response?.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Current BTC/USD, or null if every source is unreachable.
 * Never throws — callers stamp whatever comes back and move on.
 */
export async function fetchBitcoinPriceUsd({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now = Date.now(),
  useCache = true,
  timeoutMs = REQUEST_TIMEOUT_MS,
  sources = BTC_SOURCES,
} = {}) {
  if (useCache) {
    const cached = readCachedBtcPrice(storage, now);
    if (cached != null) return cached;
  }
  if (typeof fetchImpl !== 'function') return null;

  for (const source of sources) {
    const data = await fetchJson(source.url, fetchImpl, timeoutMs);
    if (data == null) continue;
    const raw = source.parse(data);
    if (!isPlausibleBtcPrice(raw)) continue;
    const usd = Math.round(Number(raw) * 100) / 100;
    writeCachedBtcPrice(usd, storage, now);
    return usd;
  }
  return null;
}

/* ------------------------------------------------------------------ display */

/** "$67,432" — whole dollars, because cents on a six-figure number are noise. */
export function formatBtcUsd(value) {
  const price = Number(value);
  if (!isPlausibleBtcPrice(price)) return null;
  return `$${Math.round(price).toLocaleString('en-US')}`;
}

/** Compact form for tight metric tiles: "$67.4k", "$1.05M". */
export function formatBtcCompact(value) {
  const price = Number(value);
  if (!isPlausibleBtcPrice(price)) return null;
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
  if (price >= 1_000) return `$${(price / 1_000).toFixed(1)}k`;
  return `$${Math.round(price)}`;
}

/** Percentage move from one bust's price to the next, or null if incomparable. */
export function btcChangePct(current, previous) {
  const now = Number(current);
  const before = Number(previous);
  if (!isPlausibleBtcPrice(now) || !isPlausibleBtcPrice(before)) return null;
  return ((now - before) / before) * 100;
}

export function formatBtcChange(current, previous) {
  const pct = btcChangePct(current, previous);
  if (pct == null) return null;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(Math.abs(pct) < 1 ? 2 : 1)}% since last`;
}

/** Satirical band label, in the spirit of pressureLabel(). */
export function btcMoodLabel(value) {
  const price = Number(value);
  if (!isPlausibleBtcPrice(price)) return null;
  if (price < 20_000) return 'Capitulation';
  if (price < 40_000) return 'Accumulation';
  if (price < 70_000) return 'Cautious';
  if (price < 100_000) return 'Euphoria';
  if (price < 250_000) return 'Six Figures';
  return 'Unhinged';
}
