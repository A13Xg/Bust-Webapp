/*
 * Regression coverage for the failures that made push "work once, then never".
 *
 * Each block below pins a specific real-world breakage:
 *   - Android Chrome throwing on `new Notification()`
 *   - iOS exposing no push APIs until the app is installed to the Home Screen
 *   - a rotated VAPID key silently invalidating an existing subscription
 *   - the arming flow reporting success when nothing was actually stored
 *   - Apple invalidating an endpoint while still answering 201, which is
 *     invisible to every other check and needs the acknowledgement signal
 */
import { describe, it, expect, vi } from 'vitest';

import {
  base64UrlToUint8Array,
  detectPushPlatform,
  enablePushNotifications,
  pushBlockedReason,
  PUSH_REASON,
  showNotification,
  ROTATE_AFTER_UNACKED,
  shouldRotateEndpoint,
  subscribeToWebPush,
  subscriptionKeyMismatch,
  toSerializablePushSubscription,
  uint8ArrayToBase64Url,
} from './notifications.js';

function makeNotificationApi({ permission = 'default', requestPermission, onCreate } = {}) {
  function FakeNotification(title, options) {
    onCreate?.(title, options);
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = requestPermission || vi.fn(async () => FakeNotification.permission);
  return FakeNotification;
}

describe('local notification delivery path', () => {
  it('renders through the service worker registration, not the Notification constructor', async () => {
    const showNotificationSpy = vi.fn(async () => {});
    const nav = {
      serviceWorker: { getRegistration: async () => ({ active: {}, showNotification: showNotificationSpy }) },
    };
    const notificationApi = makeNotificationApi({ permission: 'granted' });

    await expect(
      showNotification('Crew alert', { body: 'Incoming.', tag: 'bust-1' }, { navigator: nav, notificationApi })
    ).resolves.toBe(true);
    expect(showNotificationSpy).toHaveBeenCalledTimes(1);
    expect(showNotificationSpy.mock.calls[0][0]).toBe('Crew alert');
    expect(showNotificationSpy.mock.calls[0][1].body).toBe('Incoming.');
  });

  it('falls back to the constructor only when no service worker exists', async () => {
    const created = [];
    const notificationApi = makeNotificationApi({
      permission: 'granted',
      onCreate: (title, options) => created.push({ title, options }),
    });
    await expect(
      showNotification('Crew alert', { body: 'Incoming.' }, { navigator: {}, notificationApi })
    ).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('survives an Android-style illegal-constructor throw without crashing the caller', async () => {
    function ThrowingNotification() {
      throw new TypeError('Illegal constructor');
    }
    ThrowingNotification.permission = 'granted';
    await expect(
      showNotification('Crew alert', { body: 'Incoming.' }, { navigator: {}, notificationApi: ThrowingNotification })
    ).resolves.toBe(false);
  });

  it('falls back to the constructor when the registration itself throws', async () => {
    const created = [];
    const nav = {
      serviceWorker: {
        getRegistration: async () => ({
          active: {},
          showNotification: async () => {
            throw new Error('nope');
          },
        }),
      },
    };
    const notificationApi = makeNotificationApi({
      permission: 'granted',
      onCreate: (title, options) => created.push({ title, options }),
    });
    await expect(showNotification('Crew alert', {}, { navigator: nav, notificationApi })).resolves.toBe(true);
    expect(created).toHaveLength(1);
  });

  it('never shows anything without permission', async () => {
    const showNotificationSpy = vi.fn(async () => {});
    const nav = {
      serviceWorker: { getRegistration: async () => ({ active: {}, showNotification: showNotificationSpy }) },
    };
    await expect(
      showNotification(
        'Crew alert',
        {},
        { navigator: nav, notificationApi: makeNotificationApi({ permission: 'default' }) }
      )
    ).resolves.toBe(false);
    expect(showNotificationSpy).not.toHaveBeenCalled();
  });
});

describe('platform detection', () => {
  it('tells an un-installed iPhone to add the app to the Home Screen', () => {
    const platform = detectPushPlatform(
      { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' },
      { matchMedia: () => ({ matches: false }) }
    );
    expect(platform.ios).toBe(true);
    expect(platform.standalone).toBe(false);
    expect(pushBlockedReason(platform)).toBe(PUSH_REASON.IOS_NEEDS_INSTALL);
  });

  it('clears an installed iOS web app with the full API surface', () => {
    const platform = detectPushPlatform(
      {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari',
        standalone: true,
        serviceWorker: {},
      },
      { matchMedia: () => ({ matches: true }), PushManager: function PushManager() {}, Notification: function N() {} }
    );
    expect(pushBlockedReason(platform)).toBeNull();
  });

  it('detects iPadOS despite its desktop user agent', () => {
    const platform = detectPushPlatform(
      { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', maxTouchPoints: 5 },
      {}
    );
    expect(platform.ios).toBe(true);
  });

  it('reports plain unsupported on a browser with no push APIs', () => {
    expect(pushBlockedReason(detectPushPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, {}))).toBe(
      PUSH_REASON.UNSUPPORTED
    );
  });
});

describe('subscription rotation', () => {
  const keyBytes = Uint8Array.from([1, 2, 3, 4, 5]);
  const keyB64 = uint8ArrayToBase64Url(keyBytes);

  it('round-trips a VAPID key through both encoders', () => {
    expect(Array.from(base64UrlToUint8Array(keyB64))).toEqual(Array.from(keyBytes));
  });

  it('reuses a subscription created with the same application server key', () => {
    expect(subscriptionKeyMismatch({ options: { applicationServerKey: keyBytes.buffer } }, keyB64)).toBe(false);
  });

  it('flags a subscription created with a rotated key', () => {
    expect(subscriptionKeyMismatch({ options: { applicationServerKey: Uint8Array.from([9, 9]).buffer } }, keyB64)).toBe(
      true
    );
  });

  it('keeps a subscription whose key the browser does not expose at all', () => {
    // No `options` object: nothing to judge, so do not destroy a working subscription.
    expect(subscriptionKeyMismatch({}, keyB64)).toBe(false);
    expect(subscriptionKeyMismatch({ options: { applicationServerKey: keyBytes.buffer } }, '')).toBe(false);
  });

  it('replaces a subscription that was created without any application server key', () => {
    // `options` present but empty means a keyless subscription. Every VAPID-signed
    // push to it is rejected with 403 forever, so it has to be re-created.
    expect(subscriptionKeyMismatch({ options: {} }, keyB64)).toBe(true);
    expect(subscriptionKeyMismatch({ options: { applicationServerKey: null } }, keyB64)).toBe(true);
  });

  it('reuses a healthy subscription instead of minting a new one', () => {
    const existing = { toJSON: () => ({ endpoint: 'https://push.existing', keys: { p256dh: 'a', auth: 'b' } }) };
    expect(toSerializablePushSubscription(existing)).toEqual({
      endpoint: 'https://push.existing',
      keys: { p256dh: 'a', auth: 'b' },
    });
  });

  // A subscription missing key material cannot be encrypted to. Returning it
  // anyway would store a row that fails on every send with no obvious cause.
  it('refuses to serialize a subscription with incomplete key material', () => {
    expect(toSerializablePushSubscription({ toJSON: () => ({ endpoint: 'x', keys: { p256dh: 'k1' } }) })).toBeNull();
    expect(toSerializablePushSubscription({ toJSON: () => ({ keys: { p256dh: 'a', auth: 'b' } }) })).toBeNull();
    expect(toSerializablePushSubscription(null)).toBeNull();
  });

  it('resubscribes when the stored key no longer matches the build', async () => {
    const unsubscribe = vi.fn(async () => true);
    const stale = { options: { applicationServerKey: Uint8Array.from([9, 9, 9]).buffer }, unsubscribe };
    const fresh = { toJSON: () => ({ endpoint: 'https://push.new', keys: { p256dh: 'a', auth: 'b' } }) };
    const registration = {
      pushManager: { getSubscription: vi.fn(async () => stale), subscribe: vi.fn(async () => fresh) },
    };

    await expect(
      subscribeToWebPush({ serviceWorkerRegistration: registration, vapidPublicKey: keyB64 })
    ).resolves.toEqual({ endpoint: 'https://push.new', keys: { p256dh: 'a', auth: 'b' } });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('arming push end to end', () => {
  const keyB64 = uint8ArrayToBase64Url(Uint8Array.from([1, 2, 3, 4]));
  const subscription = { toJSON: () => ({ endpoint: 'https://push.example', keys: { p256dh: 'a', auth: 'b' } }) };

  function harness({ permission = 'granted', vapid = keyB64, register } = {}) {
    const registration = {
      active: {},
      update: vi.fn(async () => {}),
      pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => subscription) },
    };
    const nav = {
      userAgent: 'test-agent',
      serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) },
    };
    const win = {
      PushManager: function PushManager() {},
      Notification: makeNotificationApi({ permission }),
      matchMedia: () => ({ matches: false }),
    };
    const backend = {
      webPushPublicKey: () => vapid,
      registerPushSubscription: register || vi.fn(async () => ({ ok: true })),
    };
    return { nav, win, backend, registration };
  }

  it('reports ok and forwards the subscription to the backend', async () => {
    const register = vi.fn(async () => ({ ok: true, test: { delivered: 1 } }));
    const { nav, win, backend } = harness({ register });
    const outcome = await enablePushNotifications({ backend, nav, win, sendTest: true });

    expect(outcome).toMatchObject({ ok: true, reason: PUSH_REASON.OK, endpoint: 'https://push.example' });
    expect(register).toHaveBeenCalledWith(
      { endpoint: 'https://push.example', keys: { p256dh: 'a', auth: 'b' } },
      { userAgent: 'test-agent', sendTest: true }
    );
    expect(outcome.server).toEqual({ ok: true, test: { delivered: 1 } });
  });

  it('does not claim success when the build has no VAPID key', async () => {
    const { nav, win, backend } = harness({ vapid: '' });
    await expect(enablePushNotifications({ backend, nav, win })).resolves.toMatchObject({
      ok: false,
      reason: PUSH_REASON.NO_VAPID_KEY,
    });
  });

  it('does not claim success when the server rejects the subscription', async () => {
    const { nav, win, backend } = harness({
      register: vi.fn(async () => {
        throw new Error('relation "push_subscriptions" does not exist');
      }),
    });
    const outcome = await enablePushNotifications({ backend, nav, win });
    expect(outcome).toMatchObject({ ok: false, reason: PUSH_REASON.REGISTER_FAILED });
    expect(outcome.detail).toContain('push_subscriptions');
  });

  it('surfaces a denied permission rather than failing silently', async () => {
    const { nav, win, backend } = harness({ permission: 'denied' });
    await expect(enablePushNotifications({ backend, nav, win })).resolves.toMatchObject({
      ok: false,
      reason: PUSH_REASON.PERMISSION_DENIED,
    });
  });

  it('never prompts when arming silently on load', async () => {
    const { nav, win, backend } = harness({ permission: 'default' });
    await expect(enablePushNotifications({ backend, nav, win, interactive: false })).resolves.toMatchObject({
      ok: false,
      reason: PUSH_REASON.PERMISSION_DISMISSED,
    });
    expect(win.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('reports the iOS install requirement instead of a generic failure', async () => {
    const backend = { webPushPublicKey: () => keyB64, registerPushSubscription: vi.fn() };
    const outcome = await enablePushNotifications({
      backend,
      nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari' },
      win: { matchMedia: () => ({ matches: false }) },
    });
    expect(outcome).toMatchObject({ ok: false, reason: PUSH_REASON.IOS_NEEDS_INSTALL });
    expect(backend.registerPushSubscription).not.toHaveBeenCalled();
  });
});

/*
 * The failure that cost this app iOS push entirely.
 *
 * Apple stops delivering to an invalidated Web Push endpoint but keeps
 * answering 201, so no 404/410 ever reaches the server. The browser is no help
 * either: getSubscription() still returns a PushSubscription whose VAPID key
 * matches, so subscriptionKeyMismatch() says "fine" and every launch
 * re-registers the same dead endpoint. Acknowledgements are the only evidence.
 */
describe('dead endpoint detection', () => {
  it('rotates once enough sends go unacknowledged', () => {
    expect(shouldRotateEndpoint({ unackedCount: ROTATE_AFTER_UNACKED, lastAckAt: null })).toBe(true);
  });

  it('holds below the threshold', () => {
    expect(shouldRotateEndpoint({ unackedCount: ROTATE_AFTER_UNACKED - 1, lastAckAt: null })).toBe(false);
  });

  // An endpoint that ever acknowledged has proved the whole chain works, so a
  // later run of silence is far more likely a device that is off than one that
  // is dead. Those are left to the server's much more conservative prune.
  it('never rotates an endpoint that has confirmed a delivery before', () => {
    expect(shouldRotateEndpoint({ unackedCount: 99, lastAckAt: '2026-09-13T00:00:00Z' })).toBe(false);
  });

  it('does nothing without health data', () => {
    expect(shouldRotateEndpoint(null)).toBe(false);
    expect(shouldRotateEndpoint(undefined)).toBe(false);
    expect(shouldRotateEndpoint({})).toBe(false);
  });

  it('discards a valid-looking subscription when forced', async () => {
    const unsubscribe = vi.fn(async () => true);
    const keyB64 = uint8ArrayToBase64Url(Uint8Array.from([1, 2, 3, 4]));
    // Same key as the build: every other check would keep this subscription.
    const ghost = { options: { applicationServerKey: Uint8Array.from([1, 2, 3, 4]).buffer }, unsubscribe };
    const fresh = { toJSON: () => ({ endpoint: 'https://push.fresh', keys: { p256dh: 'a', auth: 'b' } }) };
    const registration = {
      pushManager: { getSubscription: vi.fn(async () => ghost), subscribe: vi.fn(async () => fresh) },
    };

    await expect(
      subscribeToWebPush({ serviceWorkerRegistration: registration, vapidPublicKey: keyB64, forceRotate: true })
    ).resolves.toEqual({ endpoint: 'https://push.fresh', keys: { p256dh: 'a', auth: 'b' } });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-registers a fresh endpoint and names the one it replaces', async () => {
    const keyB64 = uint8ArrayToBase64Url(Uint8Array.from([1, 2, 3, 4]));
    const dead = { toJSON: () => ({ endpoint: 'https://push.dead', keys: { p256dh: 'a', auth: 'b' } }) };
    const fresh = { toJSON: () => ({ endpoint: 'https://push.fresh', keys: { p256dh: 'c', auth: 'd' } }) };
    let handedOut = 0;
    const registration = {
      active: {},
      update: vi.fn(async () => {}),
      pushManager: {
        getSubscription: vi.fn(async () => (handedOut === 0 ? null : { unsubscribe: vi.fn(async () => true) })),
        subscribe: vi.fn(async () => (handedOut++ === 0 ? dead : fresh)),
      },
    };
    const registerPushSubscription = vi
      .fn()
      // First call: server reports the endpoint has never been acknowledged.
      .mockResolvedValueOnce({ ok: true, health: { unackedCount: ROTATE_AFTER_UNACKED, lastAckAt: null } })
      .mockResolvedValueOnce({ ok: true, health: { unackedCount: 0, lastAckAt: null } });

    const outcome = await enablePushNotifications({
      backend: { webPushPublicKey: () => keyB64, registerPushSubscription },
      interactive: false,
      nav: {
        serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) },
        userAgent: 'test',
      },
      win: { Notification: makeNotificationApi({ permission: 'granted' }), PushManager: function () {} },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.rotated).toBe(true);
    expect(outcome.endpoint).toBe('https://push.fresh');
    expect(registerPushSubscription).toHaveBeenCalledTimes(2);
    // The server needs the old endpoint by name, or the ghost row survives and
    // keeps being sent to.
    expect(registerPushSubscription.mock.calls[1][1]).toMatchObject({ replacesEndpoint: 'https://push.dead' });
  });

  it('leaves a healthy endpoint alone', async () => {
    const keyB64 = uint8ArrayToBase64Url(Uint8Array.from([1, 2, 3, 4]));
    const live = { toJSON: () => ({ endpoint: 'https://push.live', keys: { p256dh: 'a', auth: 'b' } }) };
    const registration = {
      active: {},
      update: vi.fn(async () => {}),
      pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => live) },
    };
    const registerPushSubscription = vi.fn(async () => ({ ok: true, health: { unackedCount: 1, lastAckAt: null } }));

    const outcome = await enablePushNotifications({
      backend: { webPushPublicKey: () => keyB64, registerPushSubscription },
      interactive: false,
      nav: {
        serviceWorker: { register: vi.fn(async () => registration), getRegistration: vi.fn(async () => registration) },
        userAgent: 'test',
      },
      win: { Notification: makeNotificationApi({ permission: 'granted' }), PushManager: function () {} },
    });

    expect(outcome.rotated).toBe(false);
    expect(registerPushSubscription).toHaveBeenCalledTimes(1);
  });
});
