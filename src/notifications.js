export function getNotificationPermission(notificationApi = globalThis.Notification) {
  if (!notificationApi || typeof notificationApi.permission !== 'string') return 'unsupported';
  return notificationApi.permission;
}

export async function requestNotificationPermission(notificationApi = globalThis.Notification) {
  const permission = getNotificationPermission(notificationApi);
  if (permission === 'granted' || permission === 'denied' || permission === 'unsupported') return permission;
  if (typeof notificationApi?.requestPermission !== 'function') return 'unsupported';
  try {
    return await notificationApi.requestPermission();
  } catch {
    return 'denied';
  }
}

export async function sendBrowserNotification(title, options, notificationApi = globalThis.Notification) {
  const permission = getNotificationPermission(notificationApi);
  if (permission !== 'granted' || typeof notificationApi !== 'function') return false;
  try {
    new notificationApi(title, options);
    return true;
  } catch {
    return false;
  }
}

export function closePermissionPrompt(storage = globalThis.sessionStorage, onClose = () => {}) {
  try {
    storage?.setItem?.('bust_perm_prompted', '1');
  } catch {}
  onClose();
}

export function markSeenEvent(seenSet, eventId) {
  if (!seenSet || !eventId) return false;
  if (seenSet.has(eventId)) return false;
  seenSet.add(eventId);
  return true;
}

function base64UrlToUint8Array(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Missing VAPID public key');
  const padded = `${input}${'='.repeat((4 - (input.length % 4 || 4)) % 4)}`;
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function supportsWebPush(nav = globalThis.navigator, win = globalThis) {
  return Boolean(nav?.serviceWorker && win?.PushManager);
}

export async function registerPushServiceWorker(nav = globalThis.navigator, workerPath = '/sw.js') {
  if (!nav?.serviceWorker) return null;
  try {
    const registration = await nav.serviceWorker.register(workerPath);
    return registration;
  } catch {
    return null;
  }
}

export function toSerializablePushSubscription(subscription) {
  if (!subscription || typeof subscription.toJSON !== 'function') return null;
  const data = subscription.toJSON();
  if (!data?.endpoint || !data?.keys?.p256dh || !data?.keys?.auth) return null;
  return data;
}

export async function subscribeToWebPush({
  serviceWorkerRegistration,
  vapidPublicKey,
  userVisibleOnly = true,
} = {}) {
  if (!serviceWorkerRegistration?.pushManager) return null;
  const existing = await serviceWorkerRegistration.pushManager.getSubscription();
  if (existing) return toSerializablePushSubscription(existing);
  if (!vapidPublicKey) return null;
  const subscription = await serviceWorkerRegistration.pushManager.subscribe({
    userVisibleOnly,
    applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
  });
  return toSerializablePushSubscription(subscription);
}
