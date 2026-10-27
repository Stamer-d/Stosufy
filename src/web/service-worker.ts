/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The web app opens without a connection: its own files are kept (the songs, the osu! and
// Stosufy servers' answers aren't: the app keeps what it needs of those itself)

import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `stosufy-${version}`;
// (their paths are relative to where the app is, e.g. /Stosufy/ on GitHub Pages)
const OWN = [...immutable, ...assets].map(
	({ path }) => new URL(path, worker.registration.scope).pathname
);

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(OWN))
			.then(() => worker.skipWaiting())
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => worker.clients.claim())
	);
});

worker.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	// Only the app's own files (the songs and the servers go to the network as they are)
	if (event.request.method !== 'GET' || url.origin !== location.origin) return;
	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (OWN.includes(url.pathname)) {
				const kept = await cache.match(url.pathname);
				if (kept) return kept;
			}
			try {
				return await fetch(event.request);
			} catch (error) {
				// Offline: a page of the app is the app (it's one page)
				const page =
					(await cache.match(url.pathname)) ??
					(await cache.match(new URL('404.html', worker.registration.scope).pathname));
				if (page) return page;
				throw error;
			}
		})()
	);
});
