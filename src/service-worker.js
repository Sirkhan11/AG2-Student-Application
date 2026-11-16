// @ts-nocheck - service worker code, the editor doesn't know these types
import { build, files, prerendered, version } from '$service-worker';

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files, ...prerendered];

// first time the app opens, save a copy of the pages and files on the phone
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

// when we push an update, get rid of the old saved copy so it's not out of date
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
});

// try the internet first, if there's no signal show the saved copy instead
// if that page wasn't saved, just fall back to the need help page so the student still gets help
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((saved) => saved || caches.match('/need-help'))
    )
  );
});