// Sharp covers, without waiting for them:
// - the player's big covers of the songs around the one playing, loaded ahead: a swipe or the
//   next song shows its sharp picture at once, not the small one first
// - the lock screen's cover: a sharp square cut from the song's background (osu!'s square is
//   only 300×300, blurry there)

import { writable, get } from 'svelte/store';
import type { MapSet } from '../lib/types';
import { bigCoverUrl } from './songs';

const MIRROR = 'https://catboy.best';

/** Big covers loaded (and decoded) already */
export const sharpReady = writable<Set<string>>(new Set());
/** Loading or loaded: the newest last (a few only: each is MBs of memory decoded) */
const kept = new Map<string, HTMLImageElement | null>();
const MOST = 6;

export function preloadSharp(songs: (MapSet | undefined)[]) {
	for (const song of songs) {
		if (!song) continue;
		const url = bigCoverUrl(song);
		if (kept.has(url)) {
			const image = kept.get(url)!;
			kept.delete(url);
			kept.set(url, image);
			continue;
		}
		const image = new Image();
		image.decoding = 'async';
		image.onload = () =>
			image
				.decode()
				.catch(() => {})
				.then(() => sharpReady.update((ready) => new Set(ready).add(url)));
		// (no background: the player falls back by itself, nothing to keep)
		image.onerror = () => kept.set(url, null);
		image.src = url;
		kept.set(url, image);
	}
	while (kept.size > MOST) {
		const oldest = kept.keys().next().value!;
		kept.delete(oldest);
		if (get(sharpReady).has(oldest))
			sharpReady.update((ready) => {
				const next = new Set(ready);
				next.delete(oldest);
				return next;
			});
	}
}

/** Sharp lock screen covers made already, by song (the next one is made ahead) */
const artworks = new Map<string, Promise<MediaImage[] | null>>();

/**
 * The lock screen's sharp cover for a song, alone: Safari picks among several by how near they
 * are to 512 px, and took osu!'s 300×300 square over a sharp 1024 one. As a data URL (iOS may
 * load it again later; a blob's URL would be gone by then).
 */
export function sharpArtwork(song: MapSet): Promise<MediaImage[] | null> {
	const map = song.beatmaps?.[0]?.id;
	if (!map) return Promise.resolve(null);
	const key = String(map);
	if (!artworks.has(key)) {
		artworks.set(key, makeArtwork(map));
		while (artworks.size > 4) artworks.delete(artworks.keys().next().value!);
	}
	return artworks.get(key)!;
}

async function makeArtwork(map: number | string): Promise<MediaImage[] | null> {
	try {
		// (the mirror hands out the background as it was uploaded, and lets it be read)
		const response = await fetch(`${MIRROR}/preview/background/${map}`);
		if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
		const bitmap = await createImageBitmap(await response.blob());
		const side = Math.min(bitmap.width, bitmap.height);
		// (smaller than osu!'s square: that one stays)
		if (side <= 300) return (void bitmap.close(), null);
		const size = Math.min(side, 1024);
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		canvas
			.getContext('2d')!
			.drawImage(
				bitmap,
				(bitmap.width - side) / 2,
				(bitmap.height - side) / 2,
				side,
				side,
				0,
				0,
				size,
				size
			);
		bitmap.close();
		return [
			{ src: canvas.toDataURL('image/jpeg', 0.9), sizes: `${size}x${size}`, type: 'image/jpeg' }
		];
	} catch {
		// (offline, or the mirror didn't answer: the small one stays)
		return null;
	}
}
