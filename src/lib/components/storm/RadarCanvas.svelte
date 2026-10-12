<script>
	// The rain radar on a map: every frame's tiles kept as pictures (see radarTiles.ts), the
	// frame shown drawn on a canvas. The loop plays without flicker, a moved map draws at once,
	// a tile still loading shows the newest frame before it (no holes), radar errors are left
	// out and tiles the server refused are asked for again a little later.
	import { onMount } from 'svelte';
	import { loadTile, tileNow, isRadarError } from '#lib/radarTiles.ts';

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

	let canvas = $state();
	const urlOf = (path, z, x, y) => `${radar.host}${path}/256/${z}/${x}/${y}/2/1_1.png`;

	/** Grows as tiles come in: what's drawn and which frames are ready follow it */
	let version = $state(0);
	let retry = $state(0);
	let retryTimer = null;
	let wanted = new Set();
	// The frame shown, read without making the loading start over on every step
	let shownFrame = 0;
	$effect(() => {
		shownFrame = radar?.frame ?? 0;
	});

	// Loading: the frame shown first, then the others from the newest back
	$effect(() => {
		void retry;
		if (!radar?.frames.length || !tiles.length) {
			wanted = new Set();
			return;
		}
		const list = tiles;
		const frames = radar.frames;
		const shown = Math.min(shownFrame, frames.length - 1);
		const order = [
			shown,
			...frames.map((_, i) => frames.length - 1 - i).filter((i) => i !== shown)
		];
		const next = new Set();
		for (const i of order) for (const t of list) next.add(urlOf(frames[i].path, t.z, t.x, t.y));
		wanted = next;
		for (const i of order)
			for (const t of list) {
				const url = urlOf(frames[i].path, t.z, t.x, t.y);
				if (tileNow(url)) continue;
				loadTile(url, i === shown, () => wanted.has(url)).then((tile) => {
					version++;
					// Refused (the server was busy): once more a little later
					if (tile.failedAt && !retryTimer)
						retryTimer = setTimeout(() => {
							retryTimer = null;
							retry++;
						}, 21000);
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
								list.filter((t) => tileNow(urlOf(f.path, t.z, t.x, t.y))).length >=
								list.length * 0.9
						)
						.map((f) => f.path)
				: [];
		const key = paths.join('|');
		if (key === readyKey) return;
		readyKey = key;
		onready(paths);
	});

	let drawn = '';
	function draw() {
		if (!canvas || !width || !height) return;
		const frames = radar?.frames ?? [];
		const index = radar ? Math.min(radar.frame, frames.length - 1) : -1;
		const first = tiles[0];
		const key = `${index}|${frames[index]?.path}|${first?.left},${first?.top},${first?.size},${tiles.length}|${width},${height}|${version}`;
		if (key === drawn) return;
		drawn = key;
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
			let tile = null;
			let at = index;
			for (; at >= 0; at--) {
				tile = tileNow(urlOf(frames[at].path, t.z, t.x, t.y));
				if (tile) break;
			}
			if (!tile?.bitmap) continue;
			const count = 2 ** t.z;
			const near = [];
			if (tile.heavy >= 0.08)
				for (const dx of [-1, 0, 1])
					for (const dy of [-1, 0, 1])
						if (dx || dy)
							near.push(
								tileNow(
									urlOf(
										frames[at].path,
										t.z,
										(((t.x + dx) % count) + count) % count,
										Math.max(0, Math.min(count - 1, t.y + dy))
									)
								)
							);
			if (isRadarError(tile, near)) continue;
			c.drawImage(tile.bitmap, t.left, t.top, t.size, t.size);
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
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="absolute inset-0 size-full pointer-events-none"
	style="opacity: {radar?.opacity ?? 0.85}"
></canvas>
