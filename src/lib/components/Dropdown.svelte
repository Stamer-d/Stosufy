<script>
	/**
	 * A few buttons that open below their trigger (a popover, not an ARIA menu: they're plain
	 * buttons, reached with Tab); choosing one, a click outside or Escape closes it
	 * @type {{
	 *   isOpen?: boolean,
	 *   menuClass?: string,
	 *   trigger?: import('svelte').Snippet,
	 *   menu?: import('svelte').Snippet
	 * }}
	 */
	let { isOpen = $bindable(false), menuClass = '', trigger, menu } = $props();

	let dropdownContainer = $state();

	$effect(() => {
		const handleClickOutside = (event) => {
			if (dropdownContainer && !dropdownContainer.contains(event.target)) isOpen = false;
		};
		// (Escape closes it too)
		const handleKey = (event) => {
			if (isOpen && event.key === 'Escape') isOpen = false;
		};
		document.addEventListener('click', handleClickOutside);
		document.addEventListener('keydown', handleKey);
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKey);
		};
	});
</script>

<div class="relative inline-block" bind:this={dropdownContainer}>
	<div onclick={() => (isOpen = !isOpen)} role="presentation" class="cursor-pointer">
		{@render trigger?.()}
	</div>

	{#if isOpen}
		<!-- (closed once one of its buttons is clicked: they handle the keyboard themselves) -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<div
			class="absolute right-0 z-40 w-56 mt-1.5 origin-top-right bg-secondary-300 rounded-lg p-1.5 shadow-xl shadow-black/40 ring-1 ring-white/5 {menuClass}"
			role="group"
			onclick={(event) => {
				// Choosing an item closes the menu
				if (event.target instanceof Element && event.target.closest('button')) {
					isOpen = false;
				}
			}}
		>
			{#if menu}
				{@render menu()}
			{:else}
				<div class="py-1 text-white text-sm">No Content provided</div>
			{/if}
		</div>
	{/if}
</div>
