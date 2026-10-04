const PATTERNS = { selection: 12, charge: [25, 45, 40], bust: [65, 35, 100], achievement: [20, 45, 35] };

let sessionPreference = null;

export function hapticsEnabled() {
  try {
    return sessionPreference ?? localStorage.getItem('bust_haptics') !== '0';
  } catch {
    return sessionPreference ?? true;
  }
}
export function setHapticsEnabled(enabled) {
  sessionPreference = Boolean(enabled);
  try {
    localStorage.setItem('bust_haptics', enabled ? '1' : '0');
  } catch {
    /* Session still works without storage. */
  }
  if (!enabled) stopHaptics();
}
export function stopHaptics() {
  try {
    navigator.vibrate?.(0);
  } catch {
    /* Feedback must never interrupt an action. */
  }
}
/** Best effort: unsupported browsers (including Safari) simply do nothing. */
export function haptic(kind) {
  try {
    if (
      !PATTERNS[kind] ||
      !hapticsEnabled() ||
      document.visibilityState === 'hidden' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      return false;
    return navigator.vibrate?.(PATTERNS[kind]) === true;
  } catch {
    return false;
  }
}
