<script>
	// Props
	export let value = 0; // Current value
	export let min = 0; // Minimum value
	export let max = 1; // Maximum value
	export let step = 0.01; // Step size
	export let disabled = false; // Disabled state

	// Create custom event dispatcher
	import { createEventDispatcher } from 'svelte';
	const dispatch = createEventDispatcher();

	function handleInput(event) {
		value = parseFloat(event.target.value);
		dispatch('input', value);
		dispatch('change', value);
	}

	$: percentage = ((value - min) / (max - min)) * 100;
</script>

<div class="range-container relative flex-1 h-1 bg-secondary-300 rounded group">
	<div>
		<div
			class="progress group-hover:bg-primary-200 bg-white absolute top-0 left-0 h-1 rounded"
			style="width: {percentage}%"
		></div>
	</div>
	<input
		type="range"
		class="slider cursor-pointer"
		{min}
		{max}
		{step}
		{disabled}
		bind:value
		on:input={handleInput}
	/>
</div>

<style>
	.slider {
		position: absolute;
		top: -6px;
		left: 0;
		width: 100%;
		height: 16px;
		z-index: 3;
		-webkit-appearance: none;
		appearance: none;
		margin: 0;
		padding: 0;
	}

	/* Thumb styling */
	.slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px; /* Slightly larger */
		height: 12px; /* Slightly larger */
		border-radius: 100%;
		background: white;
		opacity: 0;
		border: none;
		z-index: 10;
	}

	.slider::-moz-range-thumb {
		width: 12px; /* Slightly larger */
		height: 12px; /* Slightly larger */
		border-radius: 100%;
		background: white;
		opacity: 0;
		border: none;
		z-index: 10;
	}

	/* Show thumb on hover */
	.range-container:hover .slider::-webkit-slider-thumb {
		opacity: 1;
	}

	.range-container:hover .slider::-moz-range-thumb {
		opacity: 1;
	}
</style>
