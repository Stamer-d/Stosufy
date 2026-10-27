<script>
	// The bars of the song playing. Three spans that grow by transform: the phone's graphics
	// chip moves them. (The animated SVG icon before made the browser paint the whole page
	// again every frame while a song played.)
	/** @type {{ class?: string, playing?: boolean }} */
	let { class: className = 'size-4', playing = true } = $props();
</script>

<span class="bars {className}" class:still={!playing} aria-hidden="true">
	<span></span><span></span><span></span>
</span>

<style>
	.bars {
		display: inline-flex;
		align-items: flex-end;
		justify-content: center;
		gap: 12%;
		color: var(--color-primary-500);
	}
	.bars span {
		width: 22%;
		height: 100%;
		border-radius: 1px;
		background: currentColor;
		transform-origin: bottom;
		animation: bar 0.9s ease-in-out infinite;
		will-change: transform;
	}
	.bars span:nth-child(2) {
		animation-delay: -0.3s;
	}
	.bars span:nth-child(3) {
		animation-delay: -0.6s;
	}
	.still span {
		animation: none;
		transform: scaleY(0.4);
	}
	@keyframes bar {
		0%,
		100% {
			transform: scaleY(0.3);
		}
		50% {
			transform: scaleY(1);
		}
	}
</style>
