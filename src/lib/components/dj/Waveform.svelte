<script>
	// A deck's scrolling waveform: lows red, mids green, highs blue, with the beat grid, the
	// kiai parts, the loop and the cues. Drag it to scrub (paused) or to push the tempo
	// (playing); scroll to zoom.
	import { onMount } from 'svelte';
	import { beatsIn } from '#lib/dj/grid.ts';
	import { songDrop } from '#lib/dj/library.ts';

	let { deck, color = '#38bdf8', height = 110 } = $props();

	const HOT_COLORS = [
		'#ef4444',
		'#f97316',
		'#eab308',
		'#22c55e',
		'#06b6d4',
		'#3b82f6',
		'#a855f7',
		'#ec4899'
	];
	let canvas = $state();
	/** Seconds shown */
	let span = $state(8);

	let drag = null;

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		const dpr = devicePixelRatio;
		const w = Math.round(canvas.clientWidth * dpr);
		const h = Math.round(canvas.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		ctx.clearRect(0, 0, w, h);
		const state = deck.state;
		const pos = deck.position();
		const pxPerSec = w / span;
		const center = w / 2;
		const xOf = (t) => center + (t - pos) * pxPerSec;
		const t0 = pos - span / 2;
		const t1 = pos + span / 2;

		// Kiai parts
		ctx.fillStyle = 'rgba(250, 204, 21, 0.07)';
		for (const k of state.kiai) {
			if (k.end < t0 || k.start > t1) continue;
			ctx.fillRect(xOf(k.start), 0, (k.end - k.start) * pxPerSec, h);
		}
		// The loop
		if (state.loop) {
			ctx.fillStyle = 'rgba(34, 197, 94, 0.16)';
			ctx.fillRect(xOf(state.loop.start), 0, (state.loop.end - state.loop.start) * pxPerSec, h);
		}

		// The beat grid
		for (const beat of beatsIn(deck.grid, t0, t1)) {
			const x = Math.round(xOf(beat.time)) + 0.5;
			ctx.fillStyle = beat.downbeat ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)';
			ctx.fillRect(x, 0, beat.downbeat ? 2 * dpr : dpr, h);
		}

		// The waveform
		const peaks = deck.peaks;
		const mid = h / 2;
		if (peaks) {
			const scale = (h * 0.48) / (peaks.max * 0.75);
			const step = Math.max(1, Math.floor(dpr));
			for (let x = 0; x < w; x += step) {
				const t = pos + (x - center) / pxPerSec;
				const from = Math.floor(t * peaks.rate);
				const to = Math.max(from + 1, Math.floor((t + step / pxPerSec) * peaks.rate));
				if (to <= 0 || from >= peaks.low.length) continue;
				let l = 0,
					m = 0,
					hi = 0;
				for (let b = Math.max(0, from); b < Math.min(peaks.low.length, to); b++) {
					l = Math.max(l, peaks.low[b]);
					m = Math.max(m, peaks.mid[b]);
					hi = Math.max(hi, peaks.high[b]);
				}
				const total = l + m + hi;
				if (total <= 0) continue;
				const top = Math.max(l, m, hi);
				const played = t < pos;
				const alpha = played ? 0.45 : 1;
				ctx.fillStyle = `rgba(${Math.round((255 * l) / top)}, ${Math.round((215 * m) / top)}, ${Math.round((255 * hi) / top)}, ${alpha})`;
				const amp = Math.min(mid, total * scale);
				ctx.fillRect(x, mid - amp, step, amp * 2);
			}
		} else if (state.loading) {
			ctx.fillStyle = 'rgba(255,255,255,0.08)';
			ctx.fillRect(0, mid - 1, w, 2);
		}

		// Cues
		const marker = (t, fill, label) => {
			const x = xOf(t);
			if (x < -20 || x > w + 20) return;
			ctx.fillStyle = fill;
			ctx.fillRect(x - dpr / 2, 0, dpr, h);
			ctx.beginPath();
			ctx.moveTo(x - 7 * dpr, 0);
			ctx.lineTo(x + 7 * dpr, 0);
			ctx.lineTo(x, 9 * dpr);
			ctx.fill();
			if (label) {
				ctx.font = `bold ${10 * dpr}px sans-serif`;
				ctx.fillText(label, x + 3 * dpr, h - 4 * dpr);
			}
		};
		if (state.song) marker(state.cue, '#f59e0b', '');
		state.hotCues.forEach((cue, i) => cue != null && marker(cue, HOT_COLORS[i], String(i + 1)));

		// Where it plays
		ctx.fillStyle = color;
		ctx.fillRect(center - dpr, 0, 2 * dpr, h);
	}

	onMount(() => {
		let frame;
		const loop = () => {
			draw();
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	});

	function down(event) {
		if (!deck.buffer) return;
		drag = { x: event.clientX, time: performance.now(), wasPlaying: deck.state.playing };
		event.currentTarget.setPointerCapture(event.pointerId);
	}
	function move(event) {
		if (!drag) return;
		const dx = event.clientX - drag.x;
		const seconds = (-dx / canvas.clientWidth) * span;
		if (drag.wasPlaying) {
			// Pushing it along or holding it back, like touching a record
			const dt = Math.max(1, performance.now() - drag.time) / 1000;
			deck.setBend(Math.max(-0.5, Math.min(0.5, seconds / dt / 4)));
		} else deck.seek(deck.position() + seconds);
		drag.x = event.clientX;
		drag.time = performance.now();
	}
	function up() {
		if (drag?.wasPlaying) deck.setBend(0);
		drag = null;
	}
</script>

<canvas
	bind:this={canvas}
	use:songDrop={(song) => deck.userLoad(song)}
	class="w-full block cursor-grab active:cursor-grabbing touch-none data-[dropping=true]:brightness-150"
	style="height: {height}px"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onwheel={(e) => {
		e.preventDefault();
		span = Math.max(2, Math.min(32, span * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
	}}
></canvas>
