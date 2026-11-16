// @ts-nocheck - service worker code, the editor doesn't know these types
import { self } from '$app/service-worker';
import { version } from '$app/env';
import { immutable, assets } from '$app/manifest';
import { resolve } from '$app/paths';

// new name each time we update, so old copies don't get mixed up
const CACHE = `cache-${version}`;

// list of everything to save: the app's code, the static files, and the need help page
const ASSETS = [
  ...immutable.map((file) => resolve(file.path)),
  ...assets.map((file) => resolve(file.path)),
  '/need-help'
];

// first time the app opens, save a copy of all of it on the phone
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
// if that page wasn't saved, fall back to the need help page so the student still gets help
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((saved) => saved || caches.match('/need-help'))
    )
  );
});