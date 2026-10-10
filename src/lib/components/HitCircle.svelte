<script>
	/**
	 * Play button in the style of an osu! hit circle; while playing, an approach circle
	 * keeps closing in on it.
	 * @type {{ playing?: boolean, disabled?: boolean, size?: 'md' | 'lg', label?: string, onclick?: () => void }}
	 */
	let { playing = false, disabled = false, size = 'lg', label = '', onclick } = $props();
</script>

<button
	aria-label={label || (playing ? 'Pause' : 'Play')}
	{disabled}
	class="group relative grid place-items-center rounded-full bg-primary-300 text-white ring-[3px] ring-white shadow-lg shadow-black/40 cursor-pointer transition hover:scale-105 hover:bg-primary-400 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed {size ===
	'lg'
		? 'size-14'
		: 'size-11'}"
	{onclick}
>
	{#if playing}
		<span
			class="animate-approach absolute -inset-0.5 rounded-full border-2 border-white"
			style="animation: approach 1.1s ease-in infinite"
		></span>
	{/if}
	<span
		class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} {size === 'lg'
			? 'size-7'
			: 'size-5'}"
	></span>
</button>
