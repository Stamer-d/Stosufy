<script>
	/**
	 * A menu that opens below its trigger; choosing an item (a button in it) closes it
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
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});
</script>

<div class="relative inline-block" bind:this={dropdownContainer}>
	<div onclick={() => (isOpen = !isOpen)} role="presentation" class="cursor-pointer">
		{@render trigger?.()}
	</div>

	{#if isOpen}
		<div
			class="absolute right-0 z-40 w-56 mt-1.5 origin-top-right bg-secondary-300 rounded-lg p-1.5 shadow-xl shadow-black/40 ring-1 ring-white/5 {menuClass}"
			role="menu"
			aria-orientation="vertical"
			tabindex="-1"
			onclick={(event) => {
				// Choosing an item closes the menu
				if (event.target instanceof Element && event.target.closest('button')) {
					isOpen = false;
				}
			}}
			onkeydown={() => {}}
		>
			{#if menu}
				{@render menu()}
			{:else}
				<div class="py-1 text-white text-sm">No Content provided</div>
			{/if}
		</div>
	{/if}
</div>
