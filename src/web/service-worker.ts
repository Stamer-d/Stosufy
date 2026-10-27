/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The web app opens without a connection: its own files are kept, and the covers seen (the
// songs, the osu! and Stosufy servers' answers aren't: the app keeps what it needs of those
// itself)

import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const worker = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `stosufy-${version}`;
// (their paths are relative to where the app is, e.g. /Stosufy/ on GitHub Pages)
const OWN = [...immutable, ...assets].map(
	({ path }) => new URL(path, worker.registration.scope).pathname
);
/** The app's page (it's one page: each path opens it) */
const PAGE = new URL('index.html', worker.registration.scope).pathname;
/** The covers seen, kept across versions of the app */
const COVERS = 'stosufy-covers';
const MOST_COVERS = 1500;

worker.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) =>
				// (the page may not be there: a development server has none)
				Promise.all([cache.addAll(OWN), cache.add(PAGE).catch(() => {})])
			)
			.then(() => worker.skipWaiting())
	);
});

worker.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((key) => key !== CACHE && key !== COVERS).map((key) => caches.delete(key))
				)
			)
			.then(() => worker.clients.claim())
	);
});

/** A cover kept, else from osu! (and kept) */
async function cover(request: Request) {
	const cache = await caches.open(COVERS);
	const kept = await cache.match(request);
	if (kept) return kept;
	// Kept only if osu! lets the app read it (CORS): browsers count an image they can't look
	// into as megabytes of space, which would crowd out the downloaded songs
	const response = await fetch(request.url, { mode: 'cors' }).catch(() => null);
	if (!response?.ok) return fetch(request);
	await cache.put(request, response.clone());
	const keys = await cache.keys();
	if (keys.length > MOST_COVERS)
		await Promise.all(keys.slice(0, keys.length - MOST_COVERS).map((key) => cache.delete(key)));
	return response;
}

worker.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (event.request.method === 'GET' && url.hostname === 'assets.ppy.sh') {
		event.respondWith(cover(event.request));
		return;
	}
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
				// (the page asked again each time, not taken from the browser's cache: GitHub
				// Pages lets it be kept 10 minutes, a new version would wait that long)
				return await fetch(
					event.request,
					event.request.mode === 'navigate' ? { cache: 'no-cache' } : {}
				);
			} catch (error) {
				// Offline: a page of the app is the app (it's one page)
				const page =
					(await cache.match(url.pathname)) ??
					(event.request.mode === 'navigate' ? await cache.match(PAGE) : undefined);
				if (page) return page;
				throw error;
			}
		})()
	);
});
