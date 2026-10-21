<script>
	// The wind as it blows: thousands of specks drifting with it, each with a short trail that
	// fades, brighter and wider where it's stronger (like the wind maps of the weather apps).
	// The wind between the grid's points and hours is smooth (see weatherField.ts); a moved map
	// takes the specks with it, a zoom scatters them anew.
	import { onMount } from 'svelte';
	import { valuesAt, smooth, screenOnGrid } from '#lib/weatherField.ts';
	import { worldPixel } from '#lib/map.ts';

	/**
	 * @type {{
	 *   grid: import('#lib/weather.ts').WeatherGrid | null,
	 *   time: number,
	 *   lat: number, lon: number, zoom: number, width: number, height: number,
	 *   opacity?: number
	 * }}
	 */
	let { grid, time, lat, lon, zoom, width, height, opacity = 1 } = $props();

	let canvas = $state();

	/** Points of the wind's raster per grid point */
	const FACTOR = 4;
	/** Each speck's trail: its last positions */
	const TRAIL = 9;
	/** Pixels a frame (at 60 a second) per m/s of wind */
	const SPEED = 0.19;
	/** By wind speed (m/s): how strong a speck shows and how wide */
	const BANDS = [
		{ below: 3, alpha: 0.32, width: 0.9 },
		{ below: 7, alpha: 0.55, width: 1.1 },
		{ below: 12, alpha: 0.8, width: 1.3 },
		{ below: 18, alpha: 0.95, width: 1.6 },
		{ below: Infinity, alpha: 1, width: 2 }
	];

	// The wind now: smooth rasters of u and v (again as the time moves on)
	let wind = $derived.by(() => {
		if (!grid) return null;
		const u = valuesAt(grid, 'u', time);
		const v = valuesAt(grid, 'v', time);
		if (!u || !v) return null;
		return {
			u: smooth(u, grid.columns, grid.rows, FACTOR),
			v: smooth(v, grid.columns, grid.rows, FACTOR)
		};
	});
	// Where each of the screen's columns and rows is on it
	let place = $derived(
		grid && width && height
			? screenOnGrid(grid, { lat, lon, zoom, width, height }, 1, FACTOR)
			: null
	);
	let centre = $derived(worldPixel(lat, lon, zoom));

	let count = 0;
	let xs = new Float32Array(0);
	let ys = new Float32Array(0);
	let age = new Uint16Array(0);
	let life = new Uint16Array(0);
	let band = new Uint8Array(0);
	/** The specks of each band, this frame */
	let members = BANDS.map(() => new Uint32Array(0));
	let sizes = BANDS.map(() => 0);
	let head = 0;
	let seen = null;

	/** A speck somewhere new, its trail all at that point */
	function spawn(i, w, h) {
		const x = Math.random() * w;
		const y = Math.random() * h;
		for (let k = 0; k < TRAIL; k++) {
			xs[i * TRAIL + k] = x;
			ys[i * TRAIL + k] = y;
		}
		age[i] = 0;
		life[i] = 40 + Math.random() * 110;
	}

	function scatter(w, h) {
		count = Math.round(Math.min(5500, Math.max(600, (w * h) / 230)));
		xs = new Float32Array(count * TRAIL);
		ys = new Float32Array(count * TRAIL);
		age = new Uint16Array(count);
		life = new Uint16Array(count);
		band = new Uint8Array(count);
		members = BANDS.map(() => new Uint32Array(count));
		for (let i = 0; i < count; i++) {
			spawn(i, w, h);
			// Not all at the start of their lives
			age[i] = Math.random() * life[i];
		}
	}

	let last = 0;
	function step(now) {
		if (!canvas) return;
		const ratio = devicePixelRatio || 1;
		const w = width;
		const h = height;
		const cw = Math.ceil(w * ratio);
		const ch = Math.ceil(h * ratio);
		if (canvas.width !== cw) canvas.width = cw;
		if (canvas.height !== ch) canvas.height = ch;
		const c = canvas.getContext('2d');
		c.setTransform(1, 0, 0, 1, 0, 0);
		c.clearRect(0, 0, cw, ch);
		if (!wind || !place || !w || !h || place.width !== Math.ceil(w)) {
			seen = null;
			return;
		}
		// The map moved: the specks with it; zoomed or resized: anew
		const view = { x: centre.x, y: centre.y, zoom, w, h };
		if (!seen || seen.zoom !== view.zoom || seen.w !== w || seen.h !== h) scatter(w, h);
		else if (seen.x !== view.x || seen.y !== view.y) {
			const dx = seen.x - view.x;
			const dy = seen.y - view.y;
			for (let k = 0; k < xs.length; k++) {
				xs[k] += dx;
				ys[k] += dy;
			}
		}
		seen = view;

		const dt = last ? Math.min(3, (now - last) / 16.7) : 1;
		last = now;
		const previous = head;
		head = (head + 1) % TRAIL;
		const { u, v } = wind;
		const rc = u.columns;
		const columns = place.columns;
		const rows = place.rows;
		sizes = BANDS.map(() => 0);
		for (let i = 0; i < count; i++) {
			const at = i * TRAIL;
			const x = xs[at + previous];
			const y = ys[at + previous];
			const fx = x >= 0 && x < w ? columns[x | 0] : -1;
			const fy = y >= 0 && y < h ? rows[y | 0] : -1;
			if (++age[i] > life[i] || fx < 0 || fy < 0) {
				spawn(i, w, h);
				continue;
			}
			const x0 = Math.min(rc - 2, fx | 0);
			const y0 = Math.min(u.rows - 2, fy | 0);
			const tx = fx - x0;
			const ty = fy - y0;
			const k = y0 * rc + x0;
			const ue =
				(u.data[k] * (1 - tx) + u.data[k + 1] * tx) * (1 - ty) +
				(u.data[k + rc] * (1 - tx) + u.data[k + rc + 1] * tx) * ty;
			const ve =
				(v.data[k] * (1 - tx) + v.data[k + 1] * tx) * (1 - ty) +
				(v.data[k + rc] * (1 - tx) + v.data[k + rc + 1] * tx) * ty;
			const speed = Math.hypot(ue, ve);
			let b = 0;
			while (speed >= BANDS[b].below) b++;
			band[i] = b;
			members[b][sizes[b]++] = i;
			xs[at + head] = x + ue * SPEED * dt;
			ys[at + head] = y - ve * SPEED * dt;
		}

		// The trails, the oldest part faintest: one path per part and band
		c.setTransform(ratio, 0, 0, ratio, 0, 0);
		c.lineCap = 'round';
		for (let b = 0; b < BANDS.length; b++) {
			c.lineWidth = BANDS[b].width;
			for (let s = 1; s < TRAIL; s++) {
				const from = (head + s) % TRAIL;
				const to = (head + s + 1) % TRAIL;
				const fade = s / (TRAIL - 1);
				c.strokeStyle = `rgba(255, 255, 255, ${(BANDS[b].alpha * fade * fade * opacity).toFixed(3)})`;
				c.beginPath();
				const list = members[b];
				for (let m = 0; m < sizes[b]; m++) {
					const i = list[m];
					if (age[i] < TRAIL - s) continue;
					const at = i * TRAIL;
					c.moveTo(xs[at + from], ys[at + from]);
					c.lineTo(xs[at + to], ys[at + to]);
				}
				c.stroke();
			}
		}
	}

	onMount(() => {
		let frame = requestAnimationFrame(function loop(now) {
			step(now);
			frame = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<canvas bind:this={canvas} class="absolute inset-0 size-full pointer-events-none"></canvas>
