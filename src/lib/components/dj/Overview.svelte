<script>
	// The whole song at a glance: click to jump there
	import { onMount } from 'svelte';

	let { deck, color = '#38bdf8', height = 34 } = $props();

	let canvas = $state();
	/** The waveform drawn once per song, the playhead on top each frame */
	let image = null;
	let imagePeaks = null;
	let imageWidth = 0;

	function render(w, h) {
		const peaks = deck.peaks;
		const off = document.createElement('canvas');
		off.width = w;
		off.height = h;
		const ctx = off.getContext('2d');
		const per = peaks.low.length / w;
		for (let x = 0; x < w; x++) {
			let l = 0,
				m = 0,
				hi = 0;
			for (let b = Math.floor(x * per); b < Math.floor((x + 1) * per); b++) {
				l = Math.max(l, peaks.low[b] ?? 0);
				m = Math.max(m, peaks.mid[b] ?? 0);
				hi = Math.max(hi, peaks.high[b] ?? 0);
			}
			const top = Math.max(l, m, hi) || 1;
			const amp = Math.min(h / 2, ((l + m + hi) / peaks.max) * h * 0.62);
			ctx.fillStyle = `rgb(${Math.round((255 * l) / top)}, ${Math.round((215 * m) / top)}, ${Math.round((255 * hi) / top)})`;
			ctx.fillRect(x, h / 2 - amp, 1, amp * 2);
		}
		return off;
	}

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
		const duration = state.duration;
		if (!duration) return;
		if (deck.peaks && (imagePeaks !== deck.peaks || imageWidth !== w)) {
			image = render(w, h);
			imagePeaks = deck.peaks;
			imageWidth = w;
		}
		const xOf = (t) => (t / duration) * w;
		for (const k of state.kiai) {
			ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
			ctx.fillRect(xOf(k.start), 0, xOf(k.end - k.start), h);
		}
		if (image && imagePeaks === deck.peaks) ctx.drawImage(image, 0, 0);
		const pos = deck.position();
		// Played part darker
		ctx.fillStyle = 'rgba(0,0,0,0.5)';
		ctx.fillRect(0, 0, xOf(pos), h);
		if (state.loop) {
			ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
			ctx.fillRect(
				xOf(state.loop.start),
				0,
				Math.max(dpr, xOf(state.loop.end - state.loop.start)),
				h
			);
		}
		ctx.fillStyle = '#f59e0b';
		ctx.fillRect(xOf(state.cue), 0, dpr, h);
		ctx.fillStyle = color;
		ctx.fillRect(xOf(pos) - dpr, 0, 2 * dpr, h);
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
</script>

<canvas
	bind:this={canvas}
	class="w-full block cursor-pointer rounded bg-black/40"
	style="height: {height}px"
	onpointerdown={(e) => {
		if (!deck.state.duration) return;
		const rect = canvas.getBoundingClientRect();
		deck.seek(((e.clientX - rect.left) / rect.width) * deck.state.duration);
	}}
></canvas>
