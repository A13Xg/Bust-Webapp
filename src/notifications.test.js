import { describe, it, expect, vi } from 'vitest';

import { getNotificationPermission, requestNotificationPermission, sendBrowserNotification } from './notifications.js';

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
    const notificationApi = makeNotificationApi({ permission: 'default', requestPermission: vi.fn(async () => 'granted') });

    await expect(requestNotificationPermission(notificationApi)).resolves.toBe('granted');
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe('browser notifications', () => {
  it('sends a notification after permission is granted', async () => {
    const created = [];
    const notificationApi = makeNotificationApi({ permission: 'granted', onCreate: (title, options) => created.push({ title, options }) });

    await expect(sendBrowserNotification('Crew alert', { body: 'Incoming bust.' }, notificationApi)).resolves.toBe(true);
    expect(created).toEqual([{ title: 'Crew alert', options: { body: 'Incoming bust.' } }]);
  });

  it('does not send a notification when permission is denied', async () => {
    const onCreate = vi.fn();
    const notificationApi = makeNotificationApi({ permission: 'denied', onCreate });

    await expect(sendBrowserNotification('Crew alert', { body: 'Incoming bust.' }, notificationApi)).resolves.toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('does not try to request permission while handling a realtime event', async () => {
    const notificationApi = makeNotificationApi({ permission: 'default' });

    await expect(sendBrowserNotification('Crew alert', { body: 'Incoming bust.' }, notificationApi)).resolves.toBe(false);
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
  });
});