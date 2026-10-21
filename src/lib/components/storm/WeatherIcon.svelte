<script>
	// The weather as a picture that moves: the sun's rays turn, clouds drift, rain and snow fall,
	// lightning flashes, fog drifts by (still when `animated` is off, e.g. in long lists, or when
	// the computer asks for less motion)
	import { skyOf } from '#lib/weather.ts';

	/** @type {{ code: number, day?: boolean, size?: number, animated?: boolean, class?: string }} */
	let { code, day = true, size = 48, animated = true, class: className = '' } = $props();

	const id = $props.id();
	let sky = $derived(skyOf(code).sky);
	let label = $derived(skyOf(code).label);

	// What's in the picture
	let full = $derived(sky === 'clear');
	let small = $derived(['partly', 'showers', 'snow-showers'].includes(sky));
	let cloud = $derived(!full);
	let back = $derived(
		['cloudy', 'overcast', 'rain', 'heavy-rain', 'thunder', 'hail'].includes(sky)
	);
	let shade = $derived(
		['thunder', 'hail'].includes(sky)
			? 'storm'
			: ['overcast', 'rain', 'heavy-rain', 'sleet', 'drizzle'].includes(sky)
				? 'grey'
				: 'light'
	);
	const SHADES = {
		light: ['#ffffff', '#cbd5e1'],
		grey: ['#e2e8f0', '#7c8aa0'],
		storm: ['#a3aec0', '#3b4558']
	};
	let drops = $derived(
		sky === 'heavy-rain'
			? [21, 28, 35, 42]
			: ['rain', 'showers', 'thunder'].includes(sky)
				? [24, 32, 40]
				: sky === 'sleet'
					? [26, 40]
					: []
	);
	let drizzle = $derived(sky === 'drizzle' ? [24, 32, 40] : []);
	let flakes = $derived(
		['snow', 'snow-showers'].includes(sky) ? [23, 32, 41] : sky === 'sleet' ? [33] : []
	);
	let stones = $derived(sky === 'hail' ? [24, 32, 40] : []);
	let bolt = $derived(['thunder', 'hail'].includes(sky));
	let fog = $derived(sky === 'fog');
	// Rays of a sun at (cx, cy)
	const rays = (cx, cy, from, to) =>
		Array.from({ length: 8 }, (_, i) => {
			const a = (i * Math.PI) / 4;
			return {
				x1: cx + Math.cos(a) * from,
				y1: cy + Math.sin(a) * from,
				x2: cx + Math.cos(a) * to,
				y2: cy + Math.sin(a) * to
			};
		});
</script>

<svg
	viewBox="0 0 64 64"
	width={size}
	height={size}
	class="weather-icon shrink-0 overflow-visible {animated ? '' : 'still'} {className}"
	role="img"
	aria-label={label}
>
	<defs>
		<radialGradient id="{id}-glow">
			<stop offset="0%" stop-color="#fde047" stop-opacity="0.55" />
			<stop offset="100%" stop-color="#fde047" stop-opacity="0" />
		</radialGradient>
		<linearGradient id="{id}-sun" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#fef08a" />
			<stop offset="100%" stop-color="#f59e0b" />
		</linearGradient>
		<linearGradient id="{id}-moon" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0%" stop-color="#f8fafc" />
			<stop offset="100%" stop-color="#a5b4c8" />
		</linearGradient>
		<linearGradient id="{id}-cloud" gradientUnits="userSpaceOnUse" x1="0" y1="19" x2="0" y2="47">
			<stop offset="0%" stop-color={SHADES[shade][0]} />
			<stop offset="100%" stop-color={SHADES[shade][1]} />
		</linearGradient>
		<linearGradient id="{id}-back" gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="36">
			<stop offset="0%" stop-color={SHADES[shade === 'light' ? 'grey' : 'storm'][0]} />
			<stop offset="100%" stop-color={SHADES[shade === 'light' ? 'grey' : 'storm'][1]} />
		</linearGradient>
		<mask id="{id}-crescent">
			<rect width="64" height="64" fill="white" />
			<circle cx={full ? 39 : 29} cy={full ? 25 : 18} r={full ? 11 : 7.5} fill="black" />
		</mask>
	</defs>

	{#if full && day}
		<circle class="glow" cx="32" cy="32" r="26" fill="url(#{id}-glow)" />
		<g class="rays" stroke="#fbbf24" stroke-width="3" stroke-linecap="round">
			{#each rays(32, 32, 16, 22) as ray, i (i)}
				<line {...ray} />
			{/each}
		</g>
		<circle cx="32" cy="32" r="11.5" fill="url(#{id}-sun)" />
	{:else if full}
		<g mask="url(#{id}-crescent)">
			<circle cx="31" cy="32" r="14" fill="url(#{id}-moon)" />
		</g>
		<path class="star" d="M48 12l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#e2e8f0" />
		<path class="star late" d="M52 30l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" fill="#cbd5e1" />
	{:else if small && day}
		<circle class="glow small" cx="23" cy="23" r="17" fill="url(#{id}-glow)" />
		<g class="rays small" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round">
			{#each rays(23, 23, 11.5, 16) as ray, i (i)}
				<line {...ray} />
			{/each}
		</g>
		<circle cx="23" cy="23" r="8" fill="url(#{id}-sun)" />
	{:else if small}
		<g mask="url(#{id}-crescent)">
			<circle cx="23" cy="23" r="9.5" fill="url(#{id}-moon)" />
		</g>
	{/if}

	{#if back}
		<g class="drift back" fill="url(#{id}-back)" opacity="0.9">
			<g transform="translate(15 -9) scale(0.72)">
				<circle cx="24" cy="38" r="9" />
				<circle cx="34" cy="31" r="12" />
				<circle cx="44" cy="38" r="9" />
				<rect x="24" y="35" width="20" height="12" />
			</g>
		</g>
	{/if}

	{#if cloud}
		<g class="drift" fill="url(#{id}-cloud)">
			<g transform={small ? 'translate(5 4) scale(0.92)' : ''}>
				<circle cx="24" cy="38" r="9" />
				<circle cx="34" cy="31" r="12" />
				<circle cx="44" cy="38" r="9" />
				<rect x="24" y="35" width="20" height="12" />
			</g>
		</g>
	{/if}

	{#if bolt}
		<polygon
			class="bolt"
			points="35,43 27,55 32.5,55 29,63 40,50 34.5,50 38,43"
			fill="#facc15"
			stroke="#fde047"
			stroke-width="0.6"
			stroke-linejoin="round"
		/>
	{/if}

	{#each drops as x, i (i)}
		<line
			class="drop"
			style="animation-delay: {-i * 0.33}s"
			x1={x}
			y1="50"
			x2={x - 2}
			y2="56"
			stroke="#60a5fa"
			stroke-width="2.4"
			stroke-linecap="round"
		/>
	{/each}
	{#each drizzle as x, i (i)}
		<line
			class="drop slow"
			style="animation-delay: {-i * 0.5}s"
			x1={x}
			y1="51"
			x2={x - 1}
			y2="53.5"
			stroke="#93c5fd"
			stroke-width="2.2"
			stroke-linecap="round"
		/>
	{/each}
	{#each flakes as x, i (i)}
		<g
			class="flake"
			style="animation-delay: {-i * 0.8}s; transform-origin: {x}px 54px"
			stroke="#f8fafc"
			stroke-width="1.9"
			stroke-linecap="round"
		>
			<line x1={x - 3.5} y1="54" x2={x + 3.5} y2="54" />
			<line x1={x - 1.75} y1="51" x2={x + 1.75} y2="57" />
			<line x1={x - 1.75} y1="57" x2={x + 1.75} y2="51" />
		</g>
	{/each}
	{#each stones as x, i (i)}
		<circle
			class="stone"
			style="animation-delay: {-i * 0.27}s"
			cx={x}
			cy="54"
			r="2.2"
			fill="#e0f2fe"
		/>
	{/each}
	{#if fog}
		{#each [[50, 14, 46], [55, 20, 52], [60, 12, 42]] as [y, x1, x2], i (i)}
			<line
				class="fog"
				style="animation-delay: {-i * 1.3}s"
				{x1}
				y1={y}
				{x2}
				y2={y}
				stroke="#cbd5e1"
				stroke-width="3"
				stroke-linecap="round"
				opacity="0.85"
			/>
		{/each}
	{/if}
</svg>

<style>
	.rays {
		transform-origin: 32px 32px;
		animation: spin 24s linear infinite;
	}
	.rays.small {
		transform-origin: 23px 23px;
	}
	.glow {
		transform-origin: 32px 32px;
		animation: breathe 4s ease-in-out infinite;
	}
	.glow.small {
		transform-origin: 23px 23px;
	}
	.star {
		animation: twinkle 3s ease-in-out infinite;
	}
	.star.late {
		animation-delay: -1.5s;
	}
	.drift {
		animation: drift 7s ease-in-out infinite alternate;
	}
	.drift.back {
		animation-duration: 9s;
		animation-direction: alternate-reverse;
	}
	.drop {
		animation: fall 0.95s linear infinite;
	}
	.drop.slow {
		animation-duration: 1.5s;
	}
	.flake {
		animation: snow 2.4s linear infinite;
	}
	.stone {
		animation: hail 0.8s cubic-bezier(0.5, 0, 0.8, 0.6) infinite;
	}
	.bolt {
		animation: flash 3.2s linear infinite;
	}
	.fog {
		animation: haze 4s ease-in-out infinite alternate;
	}
	.still :global(*),
	.still {
		animation: none !important;
	}
	@media (prefers-reduced-motion: reduce) {
		.weather-icon :global(*),
		.weather-icon {
			animation: none !important;
		}
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes breathe {
		50% {
			transform: scale(1.12);
			opacity: 0.75;
		}
	}
	@keyframes twinkle {
		50% {
			opacity: 0.25;
			transform: scale(0.8);
		}
	}
	@keyframes drift {
		from {
			transform: translateX(-1.6px);
		}
		to {
			transform: translateX(1.6px);
		}
	}
	@keyframes fall {
		0% {
			transform: translate(1px, -4px);
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		100% {
			transform: translate(-2.5px, 8px);
			opacity: 0;
		}
	}
	@keyframes snow {
		0% {
			transform: translate(0, -4px) rotate(0deg);
			opacity: 0;
		}
		20% {
			opacity: 1;
		}
		100% {
			transform: translate(2px, 8px) rotate(120deg);
			opacity: 0;
		}
	}
	@keyframes hail {
		0% {
			transform: translateY(-5px);
			opacity: 0;
		}
		20% {
			opacity: 1;
		}
		100% {
			transform: translateY(8px);
			opacity: 0;
		}
	}
	@keyframes flash {
		0%,
		44%,
		52%,
		100% {
			opacity: 1;
		}
		46%,
		50% {
			opacity: 0.15;
		}
		48% {
			opacity: 1;
		}
	}
	@keyframes haze {
		from {
			transform: translateX(-3px);
		}
		to {
			transform: translateX(3px);
		}
	}
</style>
