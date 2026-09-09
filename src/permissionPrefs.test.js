import { describe, it, expect, vi } from 'vitest';

import {
  DONT_ASK_KEY,
  SESSION_SEEN_KEY,
  hasOptedOut,
  markSeenThisSession,
  seenThisSession,
  setOptedOut,
  shouldShowPermissionsDialog,
} from './permissionPrefs.js';

const store = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map,
  };
};

const hostile = () => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
});

describe('permission preferences', () => {
  it('shows the dialog on a device that has never answered', () => {
    expect(shouldShowPermissionsDialog({ local: store(), session: store() })).toBe(true);
  });

  it('respects an opt-out stored on this device', () => {
    const local = store({ [DONT_ASK_KEY]: '1' });
    expect(hasOptedOut(local)).toBe(true);
    expect(shouldShowPermissionsDialog({ local, session: store() })).toBe(false);
  });

  /*
   * The whole "different device" requirement rests on this: the opt-out lives
   * in per-device storage, so another device simply does not have it.
   */
  it('still asks on a different device even after opting out on this one', () => {
    const thisDevice = store();
    setOptedOut(true, thisDevice);
    expect(shouldShowPermissionsDialog({ local: thisDevice, session: store() })).toBe(false);

    const otherDevice = store();
    expect(shouldShowPermissionsDialog({ local: otherDevice, session: store() })).toBe(true);
  });

  it('does not reappear later in the same session', () => {
    const session = store();
    markSeenThisSession(session);
    expect(seenThisSession(session)).toBe(true);
    expect(shouldShowPermissionsDialog({ local: store(), session })).toBe(false);
  });

  it('clears the opt-out when it is turned back off', () => {
    const local = store({ [DONT_ASK_KEY]: '1' });
    setOptedOut(false, local);
    expect(hasOptedOut(local)).toBe(false);
  });

  it('writes the flags under stable keys', () => {
    const local = store();
    setOptedOut(true, local);
    expect(local.map.get(DONT_ASK_KEY)).toBe('1');

    const session = store();
    markSeenThisSession(session);
    expect(session.map.get(SESSION_SEEN_KEY)).toBe('1');
  });

  /* Private mode throws on access rather than returning null. Asking twice is
   * far better than crashing the app before it renders. */
  it('treats storage that throws as "no preference", without throwing', () => {
    expect(() => setOptedOut(true, hostile())).not.toThrow();
    expect(hasOptedOut(hostile())).toBe(false);
    expect(shouldShowPermissionsDialog({ local: hostile(), session: hostile() })).toBe(true);
  });

  /* A storage object with no methods, as opposed to `undefined`, which would
   * fall through to this environment's real localStorage. */
  it('survives a storage object that implements nothing', () => {
    expect(() => markSeenThisSession({})).not.toThrow();
    expect(() => setOptedOut(true, {})).not.toThrow();
    expect(hasOptedOut({})).toBe(false);
    expect(shouldShowPermissionsDialog({ local: {}, session: {} })).toBe(true);
  });
});

describe('opt-out flow as the dialog uses it', () => {
  it('only suppresses future sessions when the box was ticked', () => {
    const local = store();
    const session = store();

    // Accepted without ticking "don't ask again".
    setOptedOut(false, local);
    markSeenThisSession(session);
    expect(shouldShowPermissionsDialog({ local, session })).toBe(false); // this session
    expect(shouldShowPermissionsDialog({ local, session: store() })).toBe(true); // next session

    setOptedOut(true, local);
    expect(shouldShowPermissionsDialog({ local, session: store() })).toBe(false);
  });

  it('supports the documented full opt-out', () => {
    const local = store();
    setOptedOut(true, local);
    expect(shouldShowPermissionsDialog({ local, session: store() })).toBe(false);
    expect(vi.isMockFunction(local.getItem)).toBe(false);
  });
});
