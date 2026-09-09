/*
 * Notification + Web Push plumbing.
 *
 * Two delivery paths exist and they are NOT interchangeable:
 *
 *  1. Local notifications — shown by this tab while the app is open. These MUST
 *     go through ServiceWorkerRegistration.showNotification(). The
 *     `new Notification()` constructor throws "Illegal constructor" on Android
 *     Chrome and does not exist at all inside an iOS home-screen PWA, so it is
 *     only ever used as a desktop fallback when no service worker is available.
 *
 *  2. Web push — delivered by the OS push service even when the app is closed.
 *     Requires a service worker, a PushManager subscription bound to our VAPID
 *     public key, and that subscription stored server-side.
 *
 * Every entry point below returns a structured result instead of swallowing the
 * failure, because a silently-null subscription is exactly how this feature
 * "worked once and then never again".
 */

export const PUSH_REASON = {
  OK: 'ok',
  UNSUPPORTED: 'unsupported',
  IOS_NEEDS_INSTALL: 'ios-needs-install',
  PERMISSION_DENIED: 'permission-denied',
  PERMISSION_DISMISSED: 'permission-dismissed',
  NO_SERVICE_WORKER: 'no-service-worker',
  NO_VAPID_KEY: 'no-vapid-key',
  SUBSCRIBE_FAILED: 'subscribe-failed',
  REGISTER_FAILED: 'register-failed',
};

export const PUSH_REASON_MESSAGE = {
  [PUSH_REASON.OK]: 'Push alerts are armed.',
  [PUSH_REASON.UNSUPPORTED]: 'This browser cannot receive push notifications.',
  [PUSH_REASON.IOS_NEEDS_INSTALL]:
    'On iPhone/iPad you must first add BUST to your Home Screen (Share → Add to Home Screen), then open it from there.',
  [PUSH_REASON.PERMISSION_DENIED]:
    'Notifications are blocked for this site. Re-enable them in your browser/OS site settings, then try again.',
  [PUSH_REASON.PERMISSION_DISMISSED]: 'Permission prompt was dismissed. Tap again to retry.',
  [PUSH_REASON.NO_SERVICE_WORKER]: 'The background worker failed to start, so push cannot be armed.',
  [PUSH_REASON.NO_VAPID_KEY]: 'This build is missing VITE_WEB_PUSH_PUBLIC_KEY, so push cannot be armed.',
  [PUSH_REASON.SUBSCRIBE_FAILED]: 'The browser refused to create a push subscription.',
  [PUSH_REASON.REGISTER_FAILED]: 'The server rejected the push subscription.',
};

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

/* ------------------------------------------------------------------ platform */

/** Feature/platform probe used to explain *why* push is unavailable. */
export function detectPushPlatform(nav = globalThis.navigator, win = globalThis) {
  const ua = String(nav?.userAgent || '');
  // iPadOS 13+ reports a desktop Safari UA, so fall back to touch-point sniffing.
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
  const android = /Android/.test(ua);
  const standalone = Boolean(
    nav?.standalone === true || win?.matchMedia?.('(display-mode: standalone)')?.matches === true
  );
  return {
    ios,
    android,
    standalone,
    hasNotification: typeof win?.Notification !== 'undefined',
    hasServiceWorker: Boolean(nav?.serviceWorker),
    hasPushManager: Boolean(win?.PushManager),
  };
}

export function supportsWebPush(nav = globalThis.navigator, win = globalThis) {
  return Boolean(nav?.serviceWorker && win?.PushManager);
}

/**
 * Why push cannot be armed right now, or null when it can be.
 * iOS only exposes Notification/PushManager inside an installed PWA, so a
 * missing API on iOS means "not installed yet" rather than "never supported".
 */
export function pushBlockedReason(platform = detectPushPlatform()) {
  if (platform.hasServiceWorker && platform.hasPushManager && platform.hasNotification) return null;
  if (platform.ios && !platform.standalone) return PUSH_REASON.IOS_NEEDS_INSTALL;
  return PUSH_REASON.UNSUPPORTED;
}

/* --------------------------------------------------------- local notification */

/** Raw `new Notification()` path. Desktop-only fallback; throws on Android Chrome. */
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

/**
 * Show a notification from the running tab, preferring the service worker.
 * Falls back to the Notification constructor only when no worker is available.
 */
export async function showNotification(title, options = {}, deps = {}) {
  const nav = deps.navigator ?? globalThis.navigator;
  const notificationApi = deps.notificationApi ?? globalThis.Notification;
  if (getNotificationPermission(notificationApi) !== 'granted') return false;

  const registration = await getActiveRegistration(nav);
  if (registration?.showNotification) {
    try {
      await registration.showNotification(title, withNotificationDefaults(options, deps.baseUrl));
      return true;
    } catch {
      // fall through to the constructor path
    }
  }
  return sendBrowserNotification(title, withNotificationDefaults(options, deps.baseUrl), notificationApi);
}

function withNotificationDefaults(options = {}, baseUrl = '/') {
  const icon = options.icon || `${baseUrl}icons/icon-192.png`;
  return {
    // Android renders `badge` as a monochrome alpha mask, so it gets its own
    // single-colour asset rather than the full-colour icon.
    badge: `${baseUrl}icons/badge-96.png`,
    icon,
    ...options,
    // `renotify` is invalid without a tag and makes Chrome throw.
    ...(options.tag ? {} : { renotify: undefined }),
  };
}

async function getActiveRegistration(nav = globalThis.navigator) {
  if (!nav?.serviceWorker) return null;
  try {
    const existing = await nav.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    // `ready` never rejects; guard it so a worker that never activates cannot
    // hang the caller. The timer is cleared either way — this runs on every
    // notification and every silent re-arm, so a leaked timer per call adds up.
    let timer = null;
    try {
      return await Promise.race([
        nav.serviceWorker.ready,
        new Promise(resolve => {
          timer = setTimeout(() => resolve(existing || null), 4000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return null;
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

/* --------------------------------------------------------------- subscription */

export function base64UrlToUint8Array(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Missing VAPID public key');
  const padded = `${input}${'='.repeat((4 - (input.length % 4 || 4)) % 4)}`;
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function uint8ArrayToBase64Url(bytes) {
  if (!bytes) return '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function registerPushServiceWorker(nav = globalThis.navigator, workerPath = '/sw.js') {
  if (!nav?.serviceWorker) return null;
  try {
    // `updateViaCache: 'none'` stops a stale HTTP-cached sw.js from pinning an old
    // push handler forever — a classic "push stopped working after a deploy" cause.
    const registration = await nav.serviceWorker.register(workerPath, { updateViaCache: 'none' });
    try {
      await registration.update();
    } catch {}
    return registration;
  } catch {
    return null;
  }
}

/** Registers the worker and waits until it is actually active. */
export async function readyPushServiceWorker(nav = globalThis.navigator, workerPath = '/sw.js') {
  const registration = await registerPushServiceWorker(nav, workerPath);
  if (!registration) return null;
  if (registration.active) return registration;
  return (await getActiveRegistration(nav)) || registration;
}

export function toSerializablePushSubscription(subscription) {
  if (!subscription || typeof subscription.toJSON !== 'function') return null;
  const data = subscription.toJSON();
  if (!data?.endpoint || !data?.keys?.p256dh || !data?.keys?.auth) return null;
  return data;
}

/**
 * True when we can prove the existing subscription was created with a different
 * VAPID key. Rotating the key silently invalidates every old subscription, and
 * the browser will not tell you — it just stops delivering.
 */
export function subscriptionKeyMismatch(subscription, vapidPublicKey) {
  if (!vapidPublicKey) return false;
  const options = subscription?.options;
  // A browser that does not expose `options` gives us nothing to judge; keeping
  // a possibly-good subscription beats destroying it on a guess.
  if (!options) return false;
  const applied = options.applicationServerKey;
  // Exposed but empty means the subscription was created without a VAPID key.
  // Our sends are all VAPID-signed, so that endpoint will reject forever.
  if (!applied) return true;
  try {
    return uint8ArrayToBase64Url(applied) !== String(vapidPublicKey).trim();
  } catch {
    return false;
  }
}

export async function subscribeToWebPush({
  serviceWorkerRegistration,
  vapidPublicKey,
  userVisibleOnly = true,
} = {}) {
  if (!serviceWorkerRegistration?.pushManager) return null;
  const existing = await serviceWorkerRegistration.pushManager.getSubscription();
  if (existing) {
    if (!subscriptionKeyMismatch(existing, vapidPublicKey)) return toSerializablePushSubscription(existing);
    try {
      await existing.unsubscribe();
    } catch {}
  }
  if (!vapidPublicKey) return null;
  const subscription = await serviceWorkerRegistration.pushManager.subscribe({
    userVisibleOnly,
    applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
  });
  return toSerializablePushSubscription(subscription);
}

function result(reason, extra = {}) {
  return { ok: reason === PUSH_REASON.OK, reason, message: PUSH_REASON_MESSAGE[reason] || reason, ...extra };
}

/**
 * Full arm-push flow: permission → service worker → subscription → server.
 * `interactive: false` skips the permission prompt so it can run on every load
 * to self-heal a subscription the browser silently rotated or dropped.
 */
export async function enablePushNotifications({
  backend,
  workerPath = '/sw.js',
  interactive = true,
  sendTest = false,
  nav = globalThis.navigator,
  win = globalThis,
} = {}) {
  const platform = detectPushPlatform(nav, win);
  const blocked = pushBlockedReason(platform);
  if (blocked) return result(blocked, { permission: 'unsupported', platform });

  const notificationApi = win?.Notification;
  const current = getNotificationPermission(notificationApi);
  const permission = interactive ? await requestNotificationPermission(notificationApi) : current;
  if (permission === 'denied') return result(PUSH_REASON.PERMISSION_DENIED, { permission, platform });
  if (permission !== 'granted') return result(PUSH_REASON.PERMISSION_DISMISSED, { permission, platform });

  const registration = await readyPushServiceWorker(nav, workerPath);
  if (!registration) return result(PUSH_REASON.NO_SERVICE_WORKER, { permission, platform });

  const vapidPublicKey = backend?.webPushPublicKey?.() || '';
  if (!vapidPublicKey) return result(PUSH_REASON.NO_VAPID_KEY, { permission, platform, registration });

  let subscription = null;
  try {
    subscription = await subscribeToWebPush({ serviceWorkerRegistration: registration, vapidPublicKey });
  } catch (error) {
    return result(PUSH_REASON.SUBSCRIBE_FAILED, { permission, platform, detail: String(error?.message || error) });
  }
  if (!subscription) return result(PUSH_REASON.SUBSCRIBE_FAILED, { permission, platform });

  let server = null;
  try {
    server = await backend?.registerPushSubscription?.(subscription, {
      userAgent: nav?.userAgent || null,
      sendTest,
    });
  } catch (error) {
    return result(PUSH_REASON.REGISTER_FAILED, { permission, platform, detail: String(error?.message || error) });
  }
  return result(PUSH_REASON.OK, { permission, platform, endpoint: subscription.endpoint, subscription, server });
}
