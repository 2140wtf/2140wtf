/**
 * 2140.wtf Service Worker
 *
 * Handles incoming Web Push notifications from the nostr-push server and
 * opens/focuses the app when the user taps a notification.
 */

// --- Push received ---

/**
 * Notification assets must stay same-origin. Even an HTTPS third-party icon
 * causes the browser to fetch that URL when showing a notification, leaking
 * the user's IP and notification timing to an untrusted host.
 */
function isSafeNotificationUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const parsed = new URL(value, self.location.origin);
    return parsed.origin === self.location.origin && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function safeNotificationTag(data) {
  const tag = data && typeof data.subscription_id === 'string'
    ? data.subscription_id
    : 'ditto-notification';
  return tag.slice(0, 100);
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: '2140.wtf', body: event.data.text() };
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : '2140.wtf';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 300) : '';
  const notificationIcon = isSafeNotificationUrl(payload.icon) ? payload.icon : '/icon-192.png';
  const notificationBadge = isSafeNotificationUrl(payload.badge) ? payload.badge : '/icon-192.png';

  const options = {
    body,
    icon: notificationIcon,
    badge: notificationBadge,
    // The click handler does not need the push payload. Do not persist
    // arbitrary server-controlled data in Notification.data.
    data: {},
    requireInteraction: false,
    tag: safeNotificationTag(payload.data),
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options),
  );
});

// --- Notification click ---

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing 2140.wtf tab if one is open
        for (const client of clientList) {
          if (new URL(client.url).origin === self.location.origin) {
            client.navigate('/notifications');
            return client.focus();
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow('/notifications');
      }),
  );
});

// --- Fetch / navigation ---

/**
 * Force navigation requests to bypass the browser cache.
 *
 * Vite builds use content-hashed filenames. When the app is rebuilt, an
 * old cached index.html may reference chunks that no longer exist, causing
 * "Failed to fetch dynamically imported module" errors. By handling
 * navigation requests network-first we ensure the browser always loads the
 * latest index.html and therefore the correct chunk URLs.
 */
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => fetch(event.request)),
    );
  }
});

// --- Activate immediately ---

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients.claim().then(() => {
      // Tell controlled clients that a new build is active. The page-level
      // controllerchange handler performs one safe reload; this message is
      // useful to embedded/native wrappers that cannot rely on that event.
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: '2140-sw-updated' });
      });
    }),
  );
});
