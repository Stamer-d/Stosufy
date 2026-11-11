<script>
	/**
	 * Sparks, rings and confetti over the page, where things happen (screen coordinates):
	 * call `burst`, `ring` or `confetti` on it. Each one cleans up after itself.
	 */
	let particles = $state([]);
	let id = 0;

	const COLORS = ['#ffffff', '#ffe08a', '#ff9ed2', '#9be7ff', '#c4a6ff'];
	const CONFETTI = ['#ff66aa', '#66ccff', '#ffcc22', '#88da20', '#aa88ff', '#ffffff'];

	function add(list, life) {
		particles = [...particles, ...list];
		const ids = new Set(list.map((p) => p.id));
		setTimeout(() => (particles = particles.filter((p) => !ids.has(p.id))), life);
	}

	/** Sparks flying out from a point; `power` 0–1 for more and further */
	export function burst(x, y, { power = 1, color = null } = {}) {
		const count = Math.round(8 + power * 14);
		const list = [];
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
			const distance = (30 + Math.random() * 50) * (0.6 + power * 0.6);
			list.push({
				id: ++id,
				kind: 'spark',
				x,
				y,
				dx: Math.cos(angle) * distance,
				dy: Math.sin(angle) * distance,
				size: 3 + Math.random() * 4 * (0.5 + power),
				color: color ?? COLORS[Math.floor(Math.random() * COLORS.length)],
				duration: 450 + Math.random() * 300
			});
		}
		add(list, 900);
	}

	/** A ring spreading from a point */
	export function ring(x, y, { size = 90, color = 'white' } = {}) {
		add([{ id: ++id, kind: 'ring', x, y, size, color, duration: 550 }], 650);
	}

	/** Confetti raining over a box of the screen */
	export function confetti(rect, count = 120) {
		const list = [];
		for (let i = 0; i < count; i++) {
			const x = rect.left + Math.random() * rect.width;
			list.push({
				id: ++id,
				kind: 'confetti',
				x,
				y: rect.top - 20 - Math.random() * 60,
				dx: (Math.random() - 0.5) * 160,
				dy: rect.height * (0.7 + Math.random() * 0.5) + 80,
				rot: (Math.random() - 0.5) * 1440,
				size: 6 + Math.random() * 6,
				color: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
				duration: 1400 + Math.random() * 1200,
				delay: Math.random() * 400
			});
		}
		add(list, 3200);
	}
</script>

<div class="fixed inset-0 z-[100010] pointer-events-none overflow-hidden" aria-hidden="true">
	{#each particles as p (p.id)}
		{#if p.kind === 'spark'}
			<span
				class="spark absolute rounded-full"
				style="left: {p.x}px; top: {p.y}px; width: {p.size}px; height: {p.size}px; background: {p.color}; box-shadow: 0 0 8px {p.color}; --dx: {p.dx}px; --dy: {p.dy}px; animation-duration: {p.duration}ms"
			></span>
		{:else if p.kind === 'ring'}
			<span
				class="ring-wave absolute rounded-full"
				style="left: {p.x}px; top: {p.y}px; width: {p.size}px; height: {p.size}px; border-color: {p.color}; animation-duration: {p.duration}ms"
			></span>
		{:else}
			<span
				class="confetti absolute"
				style="left: {p.x}px; top: {p.y}px; width: {p.size}px; height: {p.size *
					0.45}px; background: {p.color}; --dx: {p.dx}px; --dy: {p.dy}px; --rot: {p.rot}deg; animation-duration: {p.duration}ms; animation-delay: {p.delay}ms"
			></span>
		{/if}
	{/each}
</div>

<style>
	.spark {
		transform: translate(-50%, -50%);
		animation: spark ease-out forwards;
	}
	@keyframes spark {
		from {
			transform: translate(-50%, -50%) scale(1);
			opacity: 1;
		}
		to {
			transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.2);
			opacity: 0;
		}
	}
	.ring-wave {
		border-width: 3px;
		border-style: solid;
		transform: translate(-50%, -50%) scale(0.2);
		animation: ring-wave ease-out forwards;
	}
	@keyframes ring-wave {
		from {
			transform: translate(-50%, -50%) scale(0.2);
			opacity: 0.9;
		}
		to {
			transform: translate(-50%, -50%) scale(1);
			opacity: 0;
			border-width: 1px;
		}
	}
	.confetti {
		opacity: 0;
		animation: confetti cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
	}
	@keyframes confetti {
		0% {
			opacity: 1;
			transform: translate(0, 0) rotate(0deg);
		}
		85% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy)) rotate(var(--rot));
		}
	}
</style>
