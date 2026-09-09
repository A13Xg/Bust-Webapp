/*
 * "Don't ask me again" for the first-login Permissions dialog.
 *
 * Deliberately localStorage and nothing else. localStorage is scoped per origin
 * per device, which *is* the requested behaviour and needs no detection code:
 *
 *   - same device, different city  -> flag still present -> not re-asked
 *   - different device, same city  -> no flag there      -> re-asked
 *
 * So there is no IP lookup, no timezone check and no fingerprint here on
 * purpose. Storing this server-side against the account would break it, because
 * the preference would then follow the user onto every new device.
 *
 * Scope note: this flag governs the FIRST-LOGIN dialog only. The bust-time
 * re-ask deliberately ignores it — see PermissionGate in main.jsx.
 */

export const DONT_ASK_KEY = 'bust_perm_dont_ask';
/** Set once the dialog has been completed, so it does not reappear all session. */
export const SESSION_SEEN_KEY = 'bust_perm_prompted';

function read(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    // Private mode and blocked-cookie setups throw on access rather than
    // returning null. Treat that as "no preference stored".
    return null;
  }
}

export function hasOptedOut(storage = globalThis.localStorage) {
  return read(storage, DONT_ASK_KEY) === '1';
}

export function setOptedOut(value, storage = globalThis.localStorage) {
  try {
    if (value) storage?.setItem?.(DONT_ASK_KEY, '1');
    else storage?.removeItem?.(DONT_ASK_KEY);
  } catch {}
}

export function markSeenThisSession(storage = globalThis.sessionStorage) {
  try {
    storage?.setItem?.(SESSION_SEEN_KEY, '1');
  } catch {}
}

export function seenThisSession(storage = globalThis.sessionStorage) {
  return read(storage, SESSION_SEEN_KEY) === '1';
}

/**
 * Should the first-login dialog appear?
 *
 * `installed` suppresses it only in the sense that an installed app has no
 * install step to offer; permissions are still worth asking for, so it is not
 * a reason to skip on its own.
 */
export function shouldShowPermissionsDialog({
  local = globalThis.localStorage,
  session = globalThis.sessionStorage,
} = {}) {
  if (seenThisSession(session)) return false;
  if (hasOptedOut(local)) return false;
  return true;
}

/** Only skip the first-login dialog when both browser permissions are already on. */
export async function permissionsAlreadyGranted({
  notification = globalThis.Notification,
  permissions = globalThis.navigator?.permissions,
} = {}) {
  if (notification?.permission !== 'granted' || !permissions?.query) return false;
  try {
    const location = await permissions.query({ name: 'geolocation' });
    return location?.state === 'granted';
  } catch {
    return false;
  }
}
