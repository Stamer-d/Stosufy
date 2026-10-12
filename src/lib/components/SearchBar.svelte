<script>
	import { goto, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { searchQuery } from '#lib/stores/search.ts';
	import { currentKeybinds, keybindLabel } from '#lib/stores/keybinds.ts';

	let input = $state(null);
	let onSearchPage = $derived(page.url.pathname === '/search');
	// The page the search was opened from; leaving the search goes back there
	let returnTo = '/home';
	// The search of the search page in the history, so going back there shows it again
	let lastQuery = '';
	// Whether the search page was opened from the page before it in the history
	let openedHere = false;

	function update(value) {
		searchQuery.set(value);
		if (value && !onSearchPage) {
			returnTo = page.url.pathname + page.url.search;
			openedHere = true;
			goto('/search', { reset: false });
		} else if (!value && onSearchPage) {
			leave();
		}
	}

	/** Clears the search and returns to the page it was opened from */
	function leave() {
		searchQuery.set('');
		lastQuery = '';
		if (!onSearchPage) return;
		// Step back out of the search, so the history has no leftover entries; reached it
		// through the history instead: replace it with the page it was opened from
		if (openedHere) history.back();
		else goto(returnTo, { reset: false, replaceState: true });
		openedHere = false;
	}

	// Leaving the search page another way (sidebar, home, back) also ends the search, so the
	// field doesn't pull you back the next time it's clicked
	afterNavigate(({ to, type }) => {
		if (to?.url.pathname !== '/search' || type === 'popstate') openedHere = false;
		if (to?.url.pathname !== '/search' && $searchQuery) {
			lastQuery = $searchQuery;
			searchQuery.set('');
		} else if (to?.url.pathname === '/search' && !$searchQuery && lastQuery) {
			searchQuery.set(lastQuery);
		}
	});

	// The search shortcut (Ctrl+K by default) is in keybinds.ts
	let shortcut = $derived(keybindLabel($currentKeybinds.app.search));
</script>

<div class="relative w-full max-w-md flex items-center">
	<span
		class="icon-[mingcute--search-line] absolute left-3 size-[18px] text-secondary-600 pointer-events-none"
	></span>
	<input
		bind:this={input}
		type="search"
		data-search-input
		value={$searchQuery}
		placeholder="What do you want to listen to?"
		aria-label="Search beatmaps and your songs"
		class="w-full h-9 pl-10 pr-16 rounded-full bg-secondary-200 hover:bg-secondary-300 focus:bg-secondary-300 text-sm text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
		oninput={(e) => update(e.currentTarget.value)}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				leave();
				e.currentTarget.blur();
			}
		}}
	/>
	{#if $searchQuery}
		<button
			aria-label="Clear search"
			class="absolute right-2 size-6 grid place-items-center rounded-full text-secondary-600 hover:text-white cursor-pointer"
			onclick={leave}
		>
			<span class="icon-[mingcute--close-line] size-4"></span>
		</button>
	{:else if shortcut.length}
		<kbd
			class="max-md:hidden absolute right-3 px-1.5 rounded text-[10px] font-semibold text-secondary-600 ring-1 ring-white/10 pointer-events-none"
			>{shortcut.join(' ')}</kbd
		>
	{/if}
</div>
