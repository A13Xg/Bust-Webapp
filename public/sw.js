self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json?.() || {}; } catch {}
  const title = payload.title || 'BUST Reminder';
  const body = payload.body || 'Your cooldown ended. The silence is suspicious.';
  const tag = payload.tag || `bust-reminder-${Date.now()}`;
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data,
      icon: './favicon.png',
      badge: './favicon.png',
      renotify: false,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client);
      if (existing) return existing.focus();
      return self.clients.openWindow('./');
    })
  );
});
