/**
 * Ditto Service Worker
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
    payload = { title: 'Ditto', body: event.data.text() };
  }

  const title = typeof payload.title === 'string' ? payload.title.slice(0, 100) : 'Ditto';
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
        // Focus an existing Ditto tab if one is open
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

// --- Activate immediately ---

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
