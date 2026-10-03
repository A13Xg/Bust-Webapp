const FRESH_MS = 5 * 60 * 1000;
let pending = null;
let current = null;
let generation = 0;

export function validCoords(value) {
  if (
    !value ||
    typeof value.lat !== 'number' ||
    typeof value.long !== 'number' ||
    !Number.isFinite(value.lat) ||
    !Number.isFinite(value.long) ||
    Math.abs(value.lat) > 90 ||
    Math.abs(value.long) > 180
  )
    return null;
  const at = Number(value.at);
  if (!Number.isFinite(at) || at <= 0 || at > Date.now() + 1000) return null;
  return {
    lat: value.lat,
    long: value.long,
    altitude: typeof value.altitude === 'number' && Number.isFinite(value.altitude) ? value.altitude : null,
    accuracy: typeof value.accuracy === 'number' && Number.isFinite(value.accuracy) ? value.accuracy : null,
    at,
  };
}

function nativePosition(geolocation) {
  if (pending) return pending;
  const requestGeneration = generation;
  let request;
  request = new Promise(resolve => {
    if (!geolocation?.getCurrentPosition) {
      resolve({ outcome: 'unsupported', coords: null });
      return;
    }
    try {
      geolocation.getCurrentPosition(
        position => {
          const coords = validCoords({
            lat: position.coords.latitude,
            long: position.coords.longitude,
            altitude: position.coords.altitude,
            accuracy: position.coords.accuracy,
            at: position.timestamp,
          });
          if (coords && requestGeneration === generation) current = coords;
          resolve({ outcome: coords ? 'granted' : 'unavailable', coords });
        },
        error =>
          resolve({
            outcome: error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable',
            coords: null,
          }),
        { timeout: 10000, maximumAge: 0 }
      );
    } catch {
      resolve({ outcome: 'unavailable', coords: null });
    }
  }).finally(() => {
    if (pending === request) pending = null;
  });
  pending = request;
  return pending;
}

export async function acquireLocation({
  timeoutMs = 10000,
  geolocation = globalThis.navigator?.geolocation,
  useCache = true,
} = {}) {
  if (useCache && current && Date.now() - current.at < FRESH_MS)
    return { outcome: 'granted', coords: current, cached: true };
  let timer;
  return Promise.race([
    nativePosition(geolocation),
    new Promise(resolve => {
      timer = setTimeout(() => resolve({ outcome: 'timeout', coords: null }), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function clearLocation() {
  current = null;
  pending = null;
  generation++;
}

export function newestOwnLocation(busts, userId) {
  for (const row of [...busts]
    .filter(b => b.user_id === userId)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))) {
    if (
      typeof row.lat === 'number' &&
      typeof row.long === 'number' &&
      Number.isFinite(row.lat) &&
      Number.isFinite(row.long) &&
      Math.abs(row.lat) <= 90 &&
      Math.abs(row.long) <= 180
    )
      return { lat: row.lat, long: row.long, altitude: null, at: null };
  }
  return null;
}
