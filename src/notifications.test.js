import { describe, it, expect, vi } from 'vitest';

import {
  closePermissionPrompt,
  getNotificationPermission,
  markSeenEvent,
  requestNotificationPermission,
  sendBrowserNotification,
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
  /* The delivery paths themselves — service worker first, constructor fallback,
   * Android's illegal-constructor throw, and the permission gate — are covered
   * end to end in notificationsPush.test.js against showNotification(), which
   * cannot pass if sendBrowserNotification is broken. What is left here is the
   * one guarantee that file does not make. */
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
