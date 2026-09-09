/*
 * Asking for location and notification permission, and working out what
 * actually happened.
 *
 * The distinction that matters everywhere below is *recoverable* vs *final*:
 *
 *   - A browser only shows a permission prompt while the state is undecided.
 *     Once the user has explicitly denied, asking again resolves immediately
 *     with `denied` and shows nothing — a RETRY button there would be a button
 *     that visibly does nothing. Only site settings can undo it.
 *   - A prompt the user dismissed without choosing leaves the state undecided,
 *     so retrying genuinely re-prompts.
 *   - Geolocation can also fail for reasons that have nothing to do with
 *     permission (no fix, hardware off, slow GPS). Those are transient and
 *     worth retrying.
 *
 * So the UI offers RETRY exactly when `isRetryable` says so, and otherwise
 * shows a dead end with a pointer at site settings.
 */

export const GEO_TIMEOUT_MS = 15000;

/** Outcomes, roughly worst-to-best for display ordering. */
export const OUTCOME = {
  denied: 'denied',
  unsupported: 'unsupported',
  timeout: 'timeout',
  unavailable: 'unavailable',
  dismissed: 'dismissed',
  granted: 'granted',
};

/* GeolocationPositionError: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT */
export function classifyGeolocationError(error) {
  if (error?.code === 1) return OUTCOME.denied;
  if (error?.code === 3) return OUTCOME.timeout;
  return OUTCOME.unavailable;
}

/** `default` means the prompt was dismissed without a decision — still askable. */
export function classifyNotificationPermission(permission) {
  if (permission === 'granted') return OUTCOME.granted;
  if (permission === 'denied') return OUTCOME.denied;
  if (permission === 'unsupported') return OUTCOME.unsupported;
  return OUTCOME.dismissed;
}

/** Can asking again actually produce a different answer? */
export function isRetryable(outcome) {
  return outcome === OUTCOME.timeout || outcome === OUTCOME.unavailable || outcome === OUTCOME.dismissed;
}

export function isFailure(outcome) {
  return outcome !== OUTCOME.granted;
}

const LABELS = {
  granted: 'ENABLED',
  denied: 'BLOCKED',
  timeout: 'TIMED OUT',
  unavailable: 'UNAVAILABLE',
  dismissed: 'DISMISSED',
  unsupported: 'NOT SUPPORTED',
  pending: 'ASKING…',
  idle: 'WAITING',
};

export function outcomeLabel(outcome) {
  return LABELS[outcome] || String(outcome || '').toUpperCase();
}

export function outcomeHint(outcome) {
  if (outcome === OUTCOME.denied) return 'Blocked. Re-enable it in your browser’s site settings, then retry.';
  if (outcome === OUTCOME.timeout) return 'No fix yet. Move somewhere with a clearer signal and retry.';
  if (outcome === OUTCOME.unavailable) return 'Your device could not produce a position. Retry.';
  if (outcome === OUTCOME.dismissed) return 'The prompt was dismissed without an answer.';
  if (outcome === OUTCOME.unsupported) return 'This browser cannot do it.';
  return null;
}

/**
 * Ask for a position. Resolves — never rejects — so the caller can render an
 * outcome rather than handle an exception.
 */
export function requestLocation({ geolocation = globalThis.navigator?.geolocation, timeoutMs = GEO_TIMEOUT_MS } = {}) {
  if (!geolocation?.getCurrentPosition) return Promise.resolve({ outcome: OUTCOME.unsupported, coords: null });
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    /* Belt and braces: some browsers have historically ignored the `timeout`
     * option, which would leave the dialog stuck on ASKING… forever. */
    const timer = setTimeout(() => finish({ outcome: OUTCOME.timeout, coords: null }), timeoutMs + 500);
    geolocation.getCurrentPosition(
      position => {
        clearTimeout(timer);
        finish({
          outcome: OUTCOME.granted,
          coords: {
            lat: position.coords.latitude,
            long: position.coords.longitude,
            altitude: position.coords.altitude,
            at: Date.now(),
          },
        });
      },
      error => {
        clearTimeout(timer);
        finish({ outcome: classifyGeolocationError(error), coords: null });
      },
      { timeout: timeoutMs }
    );
  });
}

export const GEO_STORAGE_KEY = 'bust_geo';

export function storeCoords(coords, storage = globalThis.localStorage) {
  if (!coords) return;
  try {
    storage?.setItem?.(GEO_STORAGE_KEY, JSON.stringify(coords));
  } catch {}
}
