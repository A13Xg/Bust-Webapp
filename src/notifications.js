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