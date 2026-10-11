<script>
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { searchQuery } from '#lib/stores/search.ts';

	let input = $state(null);
	let onSearchPage = $derived(page.url.pathname === '/search');

	function update(value) {
		searchQuery.set(value);
		if (!onSearchPage) goto('/search', { reset: false });
	}

	function clear() {
		searchQuery.set('');
		input?.focus();
	}

	// Ctrl+K or Ctrl+F jumps into the search from anywhere
	function handleShortcut(event) {
		if ((event.ctrlKey || event.metaKey) && ['k', 'f'].includes(event.key.toLowerCase())) {
			event.preventDefault();
			input?.focus();
			input?.select();
		}
	}
</script>

<svelte:window onkeydown={handleShortcut} />

<div class="relative w-full max-w-md flex items-center">
	<span
		class="icon-[mingcute--search-line] absolute left-3 size-[18px] text-secondary-600 pointer-events-none"
	></span>
	<input
		bind:this={input}
		type="search"
		value={$searchQuery}
		placeholder="What do you want to listen to?"
		aria-label="Search beatmaps and your songs"
		class="w-full h-9 pl-10 pr-16 rounded-full bg-secondary-200 hover:bg-secondary-300 focus:bg-secondary-300 text-sm text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
		oninput={(e) => update(e.currentTarget.value)}
		onfocus={() => $searchQuery && !onSearchPage && goto('/search', { reset: false })}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				searchQuery.set('');
				e.currentTarget.blur();
			}
		}}
	/>
	{#if $searchQuery}
		<button
			aria-label="Clear search"
			class="absolute right-2 size-6 grid place-items-center rounded-full text-secondary-600 hover:text-white cursor-pointer"
			onclick={clear}
		>
			<span class="icon-[mingcute--close-line] size-4"></span>
		</button>
	{:else}
		<kbd
			class="absolute right-3 px-1.5 rounded text-[10px] font-semibold text-secondary-600 ring-1 ring-white/10 pointer-events-none"
			>Ctrl K</kbd
		>
	{/if}
</div>
