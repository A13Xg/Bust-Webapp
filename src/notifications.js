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
