<script>
	// The rain radar on a map: every frame's tiles kept as pictures (see radarTiles.ts), the
	// frame shown drawn on a canvas. The loop plays without flicker (each frame fades in over the
	// one before, so the rain flows instead of jumping), a moved map draws at once, and there
	// are no holes: a tile still loading shows the newest frame before it, or (just
	// zoomed) the same place from the zoom before, bigger or smaller, until it's there. Radar
	// errors are left out, tiles that couldn't be loaded are asked for again a little later.
	import { onMount } from 'svelte';
	import {
		loadTile,
		keepTiles,
		tileNow,
		pieceNow,
		radarPiece,
		isRadarError,
		RADAR_MAX_ZOOM
	} from '#lib/radarTiles.ts';

	/**
	 * @type {{
	 *   radar: { host: string, frames: { path: string, time: number }[], frame: number, opacity?: number } | null,
	 *   tiles: { x: number, y: number, z: number, left: number, top: number, size: number }[],
	 *   width: number,
	 *   height: number,
	 *   onready?: (paths: string[]) => void
	 * }}
	 */
	let { radar, tiles, width, height, onready = () => {} } = $props();

	// Two canvases: the next frame fades in on top of the one shown
	let canvasA = $state();
	let canvasB = $state();
	let front = 0;
	let shownIndex = -1;
	let shownView = '';
	let hideTimer = null;

	/** Grows as tiles come in: what's drawn and which frames are ready follow it */
	let version = $state(0);
	let retry = $state(0);
	let retryTimer = null;
	/** The pictures this map wants now (the others aren't loaded when their turn comes) */
	let wanted = new Set();
	const wants = (url) => wanted.has(url);
	/** Asked for, not here yet */
	const asked = new Set();
	// The frame shown, read without making the loading start over on every step
	let shownFrame = 0;
	$effect(() => {
		shownFrame = radar?.frame ?? 0;
	});

	// Loading: the frame shown first (from the middle out), then the others from the newest back
	$effect(() => {
		void retry;
		if (!radar?.frames.length || !tiles.length) {
			wanted = new Set();
			return;
		}
		const { host, frames } = radar;
		const shown = Math.min(shownFrame, frames.length - 1);
		const order = [
			shown,
			...frames.map((_, i) => frames.length - 1 - i).filter((i) => i !== shown)
		];
		const off = (t) => Math.hypot(t.left + t.size / 2 - width / 2, t.top + t.size / 2 - height / 2);
		const list = [...tiles].sort((a, b) => off(a) - off(b));
		const next = new Set();
		const urgent = new Set();
		for (const i of order)
			for (const t of list) {
				const { url } = radarPiece(host, frames[i].path, t.z, t.x, t.y);
				next.add(url);
				if (i === shown) urgent.add(url);
			}
		wanted = next;
		keepTiles(next);
		for (const url of next) {
			if (tileNow(url)) continue;
			const loading = loadTile(url, urgent.has(url), wants);
			if (asked.has(url)) continue;
			asked.add(url);
			loading.then((tile) => {
				asked.delete(url);
				version++;
				// Not loaded (the server was busy, no answer): once more a little later
				if (tile.failedAt && !retryTimer)
					retryTimer = setTimeout(() => {
						retryTimer = null;
						retry++;
					}, 61000);
			});
		}
	});

	// Which frames are (nearly) all here: nine in ten tiles (one the server refused shows the
	// frame before it until it comes)
	let readyKey = '';
	$effect(() => {
		void version;
		const list = tiles;
		const paths =
			radar?.frames.length && list.length
				? radar.frames
						.filter(
							(f) =>
								list.filter((t) => pieceNow(radar.host, f.path, t.z, t.x, t.y)).length >=
								list.length * 0.9
						)
						.map((f) => f.path)
				: [];
		const key = paths.join('|');
		if (key === readyKey) return;
		readyKey = key;
		onready(paths);
	});

	/**
	 * Draws a map tile's radar of a frame into a square of the screen; `part` is the part of
	 * it a smaller tile shows (1/n of it, ox and oy across). False where it isn't here.
	 */
	function paint(c, path, z, x, y, left, top, size, part = { n: 1, ox: 0, oy: 0 }) {
		const piece = pieceNow(radar.host, path, z, x, y);
		if (!piece) return false;
		// Here, nothing to show (or a radar error)
		if (!piece.tile.bitmap || isRadarError(radar.host, path, z, x, y)) return true;
		const quarter = piece.tile.bitmap.width / 2;
		const s = quarter / part.n;
		c.drawImage(
			piece.tile.bitmap,
			(piece.quarter & 1) * quarter + part.ox * s,
			(piece.quarter >> 1) * quarter + part.oy * s,
			s,
			s,
			left,
			top,
			size,
			size
		);
		return true;
	}

	let drawn = '';
	function draw() {
		if (!canvasA || !canvasB || !width || !height) return;
		const frames = radar?.frames ?? [];
		const index = radar ? Math.min(radar.frame, frames.length - 1) : -1;
		const first = tiles[0];
		const key = `${index}|${frames[index]?.path}|${first?.z}/${first?.x}/${first?.y}|${first?.left},${first?.top},${first?.size},${tiles.length}|${width},${height}|${version}`;
		if (key === drawn) return;
		drawn = key;
		// A new frame on the same view fades in; anything else is drawn where it shows
		const view = `${first?.z}/${first?.x}/${first?.y}|${first?.left},${first?.top},${first?.size}|${width},${height}`;
		const fade = index >= 0 && shownIndex >= 0 && index !== shownIndex && view === shownView;
		const canvases = [canvasA, canvasB];
		const target = fade ? 1 - front : front;
		const canvas = canvases[target];
		shownIndex = index;
		shownView = view;
		if (fade) {
			const old = canvases[front];
			canvas.style.zIndex = '1';
			old.style.zIndex = '0';
			canvas.style.opacity = '1';
			canvas.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
			clearTimeout(hideTimer);
			hideTimer = setTimeout(() => (old.style.opacity = '0'), 340);
			front = target;
		} else {
			canvas.style.opacity = '1';
			canvases[1 - front].style.opacity = '0';
		}
		const ratio = devicePixelRatio || 1;
		const w = Math.ceil(width * ratio);
		const h = Math.ceil(height * ratio);
		if (canvas.width !== w) canvas.width = w;
		if (canvas.height !== h) canvas.height = h;
		const c = canvas.getContext('2d');
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.clearRect(0, 0, w, h);
		if (index < 0) return;
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.imageSmoothingEnabled = true;
		c.imageSmoothingQuality = 'high';
		for (const t of tiles) {
			// This frame's tile, or (still loading) the newest one before it
			let done = false;
			for (let at = index; at >= 0 && !done; at--)
				done = paint(c, frames[at].path, t.z, t.x, t.y, t.left, t.top, t.size);
			if (done) continue;
			// Just zoomed in: the part of a bigger tile from a zoom before …
			for (let up = 1; up <= 3 && !done && t.z - up >= 1; up++) {
				const n = 2 ** up;
				const part = { n, ox: t.x % n, oy: t.y % n };
				for (let at = index; at >= 0 && !done; at--)
					done = paint(
						c,
						frames[at].path,
						t.z - up,
						t.x >> up,
						t.y >> up,
						t.left,
						t.top,
						t.size,
						part
					);
			}
			if (done || t.z >= RADAR_MAX_ZOOM) continue;
			// … or zoomed out: the four smaller ones from the zoom after
			const half = t.size / 2;
			for (const [dx, dy] of [
				[0, 0],
				[1, 0],
				[0, 1],
				[1, 1]
			])
				paint(
					c,
					frames[index].path,
					t.z + 1,
					2 * t.x + dx,
					2 * t.y + dy,
					t.left + dx * half,
					t.top + dy * half,
					half
				);
		}
	}

	onMount(() => {
		let frame = requestAnimationFrame(function loop() {
			draw();
			frame = requestAnimationFrame(loop);
		});
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(retryTimer);
			clearTimeout(hideTimer);
			// What's still waiting for this map isn't loaded
			wanted = new Set();
		};
	});
</script>

<div class="absolute inset-0 isolate pointer-events-none" style="opacity: {radar?.opacity ?? 0.85}">
	<canvas bind:this={canvasA} class="absolute inset-0 size-full"></canvas>
	<canvas bind:this={canvasB} class="absolute inset-0 size-full opacity-0"></canvas>
</div>
