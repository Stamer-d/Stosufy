<script>
	import { TABLES, tableStyle } from '#lib/puzzle/table.ts';

	/**
	 * The table under a puzzle (behind everything): the picture blurred, or a colour
	 * @type {{ url: string }}
	 */
	let { url } = $props();

	let table = $derived(TABLES.find((t) => t.id === $tableStyle) ?? TABLES[0]);
</script>

<div
	class="absolute inset-0 overflow-hidden pointer-events-none transition-[background] duration-300"
	style="background: {table.css}"
>
	{#if table.id === 'picture'}
		<img src={url} alt="" class="size-full object-cover blur-2xl scale-110 opacity-25" />
	{:else}
		<!-- A soft light from above, like a lamp over the table -->
		<div
			class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,255,255,0.08),transparent_65%)]"
		></div>
	{/if}
</div>
