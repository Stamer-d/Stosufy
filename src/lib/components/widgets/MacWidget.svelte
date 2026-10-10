<script>
	/**
	 * A widget on the wallpaper, in the style of iOS / macOS widgets: fixed sizes,
	 * strongly rounded, frosted material.
	 * @type {{ size?: 'small' | 'medium' | 'auto', label?: string, icon?: string, class?: string, children: import('svelte').Snippet }}
	 */
	let { size = 'auto', label = '', icon = '', class: className = '', children } = $props();

	const SIZES = { small: 'size-40', medium: 'w-[21rem] h-40', auto: '' };
</script>

<div
	class="relative flex flex-col overflow-hidden rounded-[1.6rem] bg-black/30 backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/10 shadow-xl shadow-black/25 p-4 {SIZES[
		size
	]} {className}"
>
	{#if label}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			{#if icon}<span class="{icon} size-3.5"></span>{/if}
			{label}
		</p>
	{/if}
	{@render children()}
</div>
