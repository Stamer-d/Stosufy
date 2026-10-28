<script>
	// The bars of the song playing: three bars of different heights, standing still (moving,
	// they had the screen drawn again 120 times a second as long as a song played: a warm
	// phone, a quick battery)
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
		transform: scaleY(0.55);
	}
	.bars span:nth-child(2) {
		transform: scaleY(1);
	}
	.bars span:nth-child(3) {
		transform: scaleY(0.75);
	}
	.still span {
		transform: scaleY(0.35);
	}
</style>
