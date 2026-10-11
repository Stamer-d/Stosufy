<script>
	// Community playlists: the public playlists of everyone, to listen to and save
	import { goto } from '$app/navigation';
	import { keyStore } from '#lib/stores/auth.ts';
	import { user } from '#lib/stores/user.ts';
	import { getPublicPlaylists } from '#lib/api.ts';
	import { otherPlaylists, savedPlaylists, toggleSavedPlaylist } from '#lib/stores/playlist.ts';
	import PlaylistCover from '#lib/components/PlaylistCover.svelte';

	const PAGE = 30;
	/** @type {['popular' | 'new', string][]} */
	const SORTS = [
		['popular', 'Popular'],
		['new', 'New']
	];

	let search = $state('');
	/** @type {'popular' | 'new'} */
	let sort = $state('popular');
	let results = $state([]);
	let loading = $state(false);
	let error = $state('');
	let more = $state(false);
	let request = 0;

	async function load(reset = true) {
		const id = ++request;
		loading = true;
		error = '';
		try {
			const page = await getPublicPlaylists($keyStore.access_token, {
				search: search.trim(),
				sort,
				limit: PAGE,
				offset: reset ? 0 : results.length
			});
			if (id !== request) return;
			results = reset ? page : [...results, ...page];
			more = page.length === PAGE;
			otherPlaylists.update((all) => {
				const next = { ...all };
				for (const playlist of page) next[playlist.id] = playlist;
				return next;
			});
		} catch (e) {
			if (id === request) error = e.message ?? String(e);
		} finally {
			if (id === request) loading = false;
		}
	}

	// Search as you type, a moment after the last key
	let timer;
	$effect(() => {
		void search;
		void sort;
		if (!$keyStore.access_token) return;
		clearTimeout(timer);
		timer = setTimeout(() => load(true), search ? 300 : 0);
		return () => clearTimeout(timer);
	});

	const isMine = (playlist) => playlist.creator?.osuId === $user?.id;
	const isSaved = (playlist) => $savedPlaylists.some((p) => p.id == playlist.id);
</script>

<div class="px-6 pt-10 pb-12">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight">Community playlists</h1>
			<p class="mt-1 text-sm text-secondary-600">
				Public playlists of other Stosufy users. Make one of yours public in its details to share it
				here.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative flex items-center">
				<span
					class="icon-[mingcute--search-line] absolute left-3 size-4 text-secondary-600 pointer-events-none"
				></span>
				<input
					type="search"
					bind:value={search}
					placeholder="Search playlists or users"
					aria-label="Search playlists or users"
					class="w-64 h-9 pl-9 pr-3 rounded-full bg-white/[0.06] hover:bg-white/10 focus:bg-white/10 text-sm text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition [&::-webkit-search-cancel-button]:hidden"
				/>
			</div>
			<div class="flex p-1 rounded-full bg-white/[0.06]" role="group" aria-label="Sort">
				{#each SORTS as [value, label] (value)}
					<button
						aria-pressed={sort === value}
						class="h-7 px-3 rounded-full text-sm font-semibold cursor-pointer transition {sort ===
						value
							? 'bg-white text-black'
							: 'text-white/70 hover:text-white'}"
						onclick={() => (sort = value)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if error}
		<p class="mt-10 text-center text-secondary-600">{error}</p>
	{:else if !loading && !results.length}
		<div class="flex flex-col items-center gap-2 py-20 text-center">
			<span class="icon-[mingcute--earth-2-line] size-10 text-secondary-600"></span>
			<p class="text-lg font-semibold">
				{search.trim() ? `No public playlists match "${search.trim()}"` : 'No public playlists yet'}
			</p>
			<p class="text-sm text-secondary-600">Be the first: make one of yours public.</p>
		</div>
	{/if}

	<div class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
		{#each results as playlist (playlist.id)}
			{@const saved = isSaved(playlist)}
			<div class="group relative p-3 rounded-lg hover:bg-white/[0.06] transition">
				<button
					class="w-full text-start cursor-pointer"
					onclick={() => goto(`/playlist/${playlist.id}`)}
				>
					<PlaylistCover
						{playlist}
						class="w-full aspect-square rounded-md shadow-lg shadow-black/40"
						iconClass="size-12"
					/>
					<h3 class="mt-3 font-semibold truncate">{playlist.title}</h3>
					<p class="text-sm text-secondary-600 truncate">
						{isMine(playlist) ? 'You' : (playlist.creator?.username ?? 'Someone')} · {playlist.song_amount}
						{playlist.song_amount === 1 ? 'song' : 'songs'}
					</p>
					{#if playlist.saves}
						<p class="text-xs text-secondary-600">
							{playlist.saves}
							{playlist.saves === 1 ? 'save' : 'saves'}
						</p>
					{/if}
				</button>
				{#if !isMine(playlist)}
					<button
						title={saved ? 'Remove from your library' : 'Save to your library'}
						aria-label={saved
							? `Remove ${playlist.title} from your library`
							: `Save ${playlist.title} to your library`}
						aria-pressed={saved}
						class="absolute top-5 right-5 size-9 grid place-items-center rounded-full bg-black/60 backdrop-blur cursor-pointer transition {saved
							? 'text-primary-400'
							: 'text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}"
						onclick={() => toggleSavedPlaylist(playlist)}
					>
						<span
							class="{saved
								? 'icon-[mingcute--bookmark-fill]'
								: 'icon-[mingcute--bookmark-line]'} size-5"
						></span>
					</button>
				{/if}
			</div>
		{/each}
	</div>

	{#if loading}
		<div class="grid place-items-center py-10">
			<span class="size-8 icon-[svg-spinners--ring-resize] text-primary-400"></span>
		</div>
	{:else if more}
		<div class="flex justify-center pt-6">
			<button
				class="h-9 px-5 rounded-full text-sm font-semibold ring-1 ring-white/15 hover:bg-white/10 cursor-pointer transition"
				onclick={() => load(false)}
			>
				Show more
			</button>
		</div>
	{/if}
</div>
