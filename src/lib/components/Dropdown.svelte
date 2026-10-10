<script>
	import { onMount, createEventDispatcher } from 'svelte';

	export let isOpen = false;
	export let menuClass = '';

	let dropdownContainer;

	const dispatch = createEventDispatcher();

	function handleClickOutside(event) {
		if (dropdownContainer && !dropdownContainer.contains(event.target)) {
			isOpen = false;
			dispatch('close');
		}
	}

	function toggleDropdown() {
		isOpen = !isOpen;
		dispatch(isOpen ? 'open' : 'close');
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});
</script>

<div class="relative inline-block" bind:this={dropdownContainer}>
	<div on:click={toggleDropdown} role="presentation" class="cursor-pointer">
		<slot name="trigger" />
	</div>

	{#if isOpen}
		<div
			class="absolute right-0 z-40 w-56 mt-1.5 origin-top-right bg-secondary-300 rounded-lg p-1.5 shadow-xl shadow-black/40 ring-1 ring-white/5 {menuClass}"
			role="menu"
			aria-orientation="vertical"
		>
			<slot name="menu">
				<div class="py-1 text-white text-sm">No Content provided</div>
			</slot>
		</div>
	{/if}
</div>
