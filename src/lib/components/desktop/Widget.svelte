<script>
	/** A floating panel on the wallpaper. @type {{ class?: string, children: import('svelte').Snippet }} */
	let { class: className = '', children } = $props();
</script>

<div
	class="rounded-2xl bg-black/45 backdrop-blur-md ring-1 ring-white/10 shadow-xl shadow-black/30 {className}"
>
	{@render children()}
</div>
