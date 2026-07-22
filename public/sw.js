/**
 * 2140.wtf Service Worker
 *
 * Handles incoming Web Push notifications from the nostr-push server and
 * opens/focuses the app when the user taps a notification.
 */

// --- Push received ---

function isSafeNotificationUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, self.location.origin);
    // Only allow same-origin assets or plain paths (no external icons that
    // could be used as a tracking / IP-leak vector by a compromised server).
    return parsed.origin === self.location.origin || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: '2140.wtf', body: event.data.text() };
  }

  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : '2140.wtf';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 300) : '';
  const icon = isSafeNotificationUrl(payload.icon) ? payload.icon : '/icon-192.png';
  const badge = isSafeNotificationUrl(payload.badge) ? payload.badge : '/icon-192.png';

  const options = {
    body,
    icon,
    badge,
    data: payload.data ?? {},
    requireInteraction: false,
    tag: payload.data?.subscription_id ?? 'ditto-notification',
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
  event.waitUntil(self.clients.claim());
});
