import { describe, it, expect, vi } from 'vitest';

import {
  closePermissionPrompt,
  getNotificationPermission,
  markSeenEvent,
  registerPushServiceWorker,
  requestNotificationPermission,
  sendBrowserNotification,
  subscribeToWebPush,
  supportsWebPush,
  toSerializablePushSubscription,
} from './notifications.js';

function makeNotificationApi({ permission = 'default', requestPermission, onCreate } = {}) {
  function FakeNotification(title, options) {
    onCreate?.(title, options);
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = requestPermission || vi.fn(async () => FakeNotification.permission);
  return FakeNotification;
}

describe('notification permissions', () => {
  it('reports unsupported when the Notification API is unavailable', () => {
    expect(getNotificationPermission(undefined)).toBe('unsupported');
  });

  it('keeps granted permission without re-requesting it', async () => {
    const notificationApi = makeNotificationApi({ permission: 'granted' });

    await expect(requestNotificationPermission(notificationApi)).resolves.toBe('granted');
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
  });

  it('requests permission when notifications are not yet enabled', async () => {
    const notificationApi = makeNotificationApi({
      permission: 'default',
      requestPermission: vi.fn(async () => 'granted'),
    });

    await expect(requestNotificationPermission(notificationApi)).resolves.toBe('granted');
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe('browser notifications', () => {
  it('sends a notification after permission is granted', async () => {
    const created = [];
    const notificationApi = makeNotificationApi({
      permission: 'granted',
      onCreate: (title, options) => created.push({ title, options }),
    });

    await expect(
      sendBrowserNotification('Crew alert', { body: 'Incoming bust.', tag: 'bust-1' }, notificationApi)
    ).resolves.toBe(true);
    expect(created).toEqual([{ title: 'Crew alert', options: { body: 'Incoming bust.', tag: 'bust-1' } }]);
  });

  it('does not send a notification when permission is denied', async () => {
    const onCreate = vi.fn();
    const notificationApi = makeNotificationApi({ permission: 'denied', onCreate });

    await expect(sendBrowserNotification('Crew alert', { body: 'Incoming bust.' }, notificationApi)).resolves.toBe(
      false
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not try to request permission while handling a realtime event', async () => {
    const notificationApi = makeNotificationApi({ permission: 'default' });

    await expect(sendBrowserNotification('Crew alert', { body: 'Incoming bust.' }, notificationApi)).resolves.toBe(
      false
    );
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
  });
});

describe('permission prompt close behavior', () => {
  it('marks the prompt as shown and closes without triggering a reload', () => {
    const storage = { setItem: vi.fn() };
    const close = vi.fn();
    const reload = vi.fn();
    const previousLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { ...previousLocation, reload },
    });

    closePermissionPrompt(storage, close);

    expect(storage.setItem).toHaveBeenCalledWith('bust_perm_prompted', '1');
    expect(close).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    Object.defineProperty(globalThis, 'location', { configurable: true, value: previousLocation });
  });
});

describe('realtime event deduplication', () => {
  it('marks only the first delivery of a stable event id as fresh', () => {
    const seen = new Set();
    expect(markSeenEvent(seen, 'created:b1')).toBe(true);
    expect(markSeenEvent(seen, 'created:b1')).toBe(false);
    expect(markSeenEvent(seen, 'updated:b1')).toBe(true);
  });
});

describe('web push registration', () => {
  it('detects when push prerequisites exist', () => {
    expect(supportsWebPush({ serviceWorker: {} }, { PushManager: function PushManager() {} })).toBe(true);
    expect(supportsWebPush({}, {})).toBe(false);
  });

  it('serializes subscriptions with endpoint and key material only', () => {
    const subscription = {
      toJSON: () => ({ endpoint: 'https://push.example', keys: { p256dh: 'k1', auth: 'k2' }, expirationTime: null }),
    };
    expect(toSerializablePushSubscription(subscription)).toEqual({
      endpoint: 'https://push.example',
      keys: { p256dh: 'k1', auth: 'k2' },
      expirationTime: null,
    });
    expect(toSerializablePushSubscription({ toJSON: () => ({ endpoint: 'x', keys: { p256dh: 'k1' } }) })).toBeNull();
  });

  it('registers a service worker when supported', async () => {
    const registration = { scope: '/' };
    const nav = { serviceWorker: { register: vi.fn(async () => registration) } };
    await expect(registerPushServiceWorker(nav, '/sw.js')).resolves.toBe(registration);
  });

  it('creates or reuses a push subscription', async () => {
    const existing = { toJSON: () => ({ endpoint: 'https://push.existing', keys: { p256dh: 'a', auth: 'b' } }) };
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => existing),
        subscribe: vi.fn(),
      },
    };
    await expect(subscribeToWebPush({ serviceWorkerRegistration: registration, vapidPublicKey: 'BEl6--' })).resolves.toEqual({
      endpoint: 'https://push.existing',
      keys: { p256dh: 'a', auth: 'b' },
    });
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });
});
