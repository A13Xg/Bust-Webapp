/*
 * BUST service worker — web push receiver.
 *
 * Deliberately NOT a caching/offline worker. Its only jobs are:
 *   - render pushes that arrive while the app is closed,
 *   - focus (or open) the app when one is tapped,
 *   - survive the browser silently rotating our push subscription,
 *   - render notifications on behalf of the open tab, because the
 *     `new Notification()` constructor is illegal on Android Chrome and absent
 *     inside iOS home-screen web apps.
 *
 * Bump SW_VERSION whenever this file changes so the update is obvious in logs.
 */
const SW_VERSION = '2026-09-07.1';

const scopeUrl = () => new URL(self.registration.scope);
const scoped = path => new URL(String(path).replace(/^\//, ''), scopeUrl()).toString();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function parsePushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch {
    try {
      const text = event.data.text();
      return text ? { body: text } : {};
    } catch {
      return {};
    }
  }
}

function buildNotification(payload) {
  const icon = payload.icon ? scoped(payload.icon) : scoped('icons/icon-192.png');
  // Android draws `badge` as a monochrome alpha mask in the status bar, so it
  // needs a dedicated single-colour asset — a full-colour icon renders as a blob.
  const badge = scoped('icons/badge-96.png');
  const tag = payload.tag || `bust-${payload.kind || 'event'}-${Date.now()}`;
  return [
    payload.title || 'BUST',
    {
      body: payload.body || 'Pressure event received.',
      tag,
      icon,
      badge,
      // Explicitly re-alert on a reused tag; without this Chrome silently
      // swallows the second notification in a tag group.
      renotify: payload.renotify !== false,
      // iOS ignores these; harmless elsewhere.
      vibrate: payload.vibrate || [40, 60, 90],
      timestamp: Number(payload.timestamp) || Date.now(),
      requireInteraction: false,
      data: { ...(payload.data || {}), url: payload.url || payload.data?.url || scoped('') },
    },
  ];
}

self.addEventListener('push', event => {
  const payload = parsePushPayload(event);
  const [title, options] = buildNotification(payload);
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Let any open tab react (bump the unread badge, refresh the feed).
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'bust-push', payload });
      }
    })()
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || scoped('');
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (client.url.startsWith(scopeUrl().toString()) && 'focus' in client) {
          client.postMessage({ type: 'bust-notification-click', data: event.notification.data || {} });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })()
  );
});

/*
 * Browsers rotate push subscriptions without warning (key rotation, storage
 * eviction, long inactivity). When that happens the old endpoint stops
 * delivering and nothing tells the app — the single most common cause of
 * "push worked once and then never again". Re-subscribe immediately and tell
 * any open tab to persist the new endpoint; if no tab is open, the app re-arms
 * on its next launch.
 */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;
      let subscription = null;
      try {
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      } catch {
        return;
      }
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: 'bust-push-resubscribed', subscription: subscription.toJSON() });
      }
    })()
  );
});

/* The open tab delegates local notifications here (see src/notifications.js). */
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'bust-show-notification') {
    const [title, options] = buildNotification(data.payload || {});
    event.waitUntil?.(self.registration.showNotification(title, options));
  }
  if (data.type === 'bust-sw-version') {
    event.source?.postMessage({ type: 'bust-sw-version', version: SW_VERSION });
  }
});
