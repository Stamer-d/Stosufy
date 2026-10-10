<script>
	/** @type {{ playing?: boolean, disabled?: boolean, size?: 'md' | 'lg', label?: string, onclick?: () => void }} */
	let { playing = false, disabled = false, size = 'lg', label = '', onclick } = $props();
</script>

<button
	aria-label={label || (playing ? 'Pause' : 'Play')}
	{disabled}
	class="grid place-items-center rounded-full bg-primary-300 text-white shadow-lg shadow-black/30 cursor-pointer transition hover:scale-105 hover:bg-primary-400 disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed {size ===
	'lg'
		? 'size-14'
		: 'size-11'}"
	{onclick}
>
	<span
		class="{playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} {size === 'lg'
			? 'size-7'
			: 'size-5'}"
	></span>
</button>
