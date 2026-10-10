<script>
	/**
	 * A terminal window for the Linux style widgets.
	 * @type {{ title?: string, class?: string, children: import('svelte').Snippet }}
	 */
	let { title = '', class: className = '', children } = $props();
</script>

<div
	class="rounded-lg overflow-hidden bg-[#0d0d14]/85 backdrop-blur-sm ring-1 ring-white/15 shadow-xl shadow-black/40 font-mono text-[13px] leading-relaxed text-white/85 {className}"
>
	<div
		class="flex items-center justify-between h-6 px-2.5 bg-white/[0.06] border-b border-white/10 text-[11px] text-white/50"
	>
		<span>{title}</span>
		<span class="flex gap-1.5">
			<span class="size-2 rounded-full bg-white/20"></span>
			<span class="size-2 rounded-full bg-white/20"></span>
			<span class="size-2 rounded-full bg-primary-400"></span>
		</span>
	</div>
	<div class="p-3">
		{@render children()}
	</div>
</div>
