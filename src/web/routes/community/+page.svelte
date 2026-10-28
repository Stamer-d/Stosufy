<script module>
	/** The first page of each order, as last shown */
	const kept = {};
</script>

<script>
	const base = __WEB_BASE__;
	// Community playlists, as in the desktop app: everyone's public playlists, the most saved
	// or the newest, to listen to and save to your library
	import { freshToken } from '../../shims/auth';
	import { getPublicPlaylists } from '../../../lib/api';
	import {
		otherPlaylists,
		savedPlaylists,
		toggleSavedPlaylist
	} from '../../../lib/stores/playlist';
	import { user } from '../../shims/user';
	import { offline } from '../../../lib/stores/network';
	import PlaylistCover from '../../../lib/components/PlaylistCover.svelte';
	import { nearView } from '../../visible';
	import Skeleton from '../../Skeleton.svelte';
	import { searchField } from '../../searchField';

	const PAGE = 30;
	const SORTS = [
		['popular', 'Popular'],
		['new', 'New']
	];

	let search = $state('');
	let sort = $state('popular');
	// (what was shown last time, right away when it's opened again; then osu!'s of now)
	let results = $state(kept.popular ?? []);
	let loading = $state(!$offline);
	let error = $state('');
	let more = $state(false);
	let request = 0;

	async function load(reset = true) {
		const id = ++request;
		loading = true;
		error = '';
		try {
			const page = await getPublicPlaylists(await freshToken(), {
				search: search.trim(),
				sort: sort === 'new' ? 'new' : 'popular',
				limit: PAGE,
				offset: reset ? 0 : results.length
			});
			if (id !== request) return;
			results = reset ? page : [...results, ...page];
			if (reset && !search.trim()) kept[sort] = page;
			more = page.length === PAGE;
			otherPlaylists.update((all) => {
				const next = { ...all };
				for (const playlist of page) next[playlist.id] = playlist;
				return next;
			});
		} catch (e) {
			if (id === request) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (id === request) loading = false;
		}
	}

	// Search as you type, a moment after the last key
	$effect(() => {
		const words = search;
		void sort;
		if ($offline) return;
		const timer = setTimeout(() => load(true), words ? 350 : 0);
		return () => clearTimeout(timer);
	});

	const isMine = (playlist) => !!$user?.id && playlist.creator?.osuId === $user.id;
	const isSaved = (playlist) => $savedPlaylists.some((p) => p.id == playlist.id);
</script>

<header class="px-4 pt-5 pb-3">
	<h1 class="text-2xl font-bold tracking-tight">Community playlists</h1>
	<p class="mt-1 text-sm text-secondary-600">
		Public playlists of other Stosufy users. Make one of yours public in the desktop app to share it
		here.
	</p>
	<label
		class="mt-4 flex items-center gap-3 h-11 px-4 rounded-full bg-white/[0.08] ring-1 ring-transparent focus-within:ring-white/20"
	>
		<span class="icon-[mingcute--search-line] size-5 text-secondary-600"></span>
		<input
			type="search"
			use:searchField
			bind:value={search}
			enterkeyhint="search"
			placeholder="Search playlists or users"
			aria-label="Search playlists or users"
			class="flex-1 min-w-0 self-stretch bg-transparent outline-none placeholder:text-secondary-600 [&::-webkit-search-cancel-button]:hidden"
		/>
		{#if loading}
			<span class="icon-[svg-spinners--ring-resize] size-5 text-secondary-600"></span>
		{/if}
	</label>
	<div class="mt-3 flex gap-2" role="group" aria-label="Sort">
		{#each SORTS as [value, label] (value)}
			<button
				aria-pressed={sort === value}
				class="h-10 px-4 rounded-full text-sm font-semibold transition {sort === value
					? 'bg-white text-black'
					: 'bg-white/[0.08] text-white/80'}"
				onclick={() => (sort = value)}
			>
				{label}
			</button>
		{/each}
	</div>
</header>

{#if $offline}
	<p class="px-4 py-10 text-center text-secondary-600">
		The community's playlists show up once you're connected.
	</p>
{:else if error}
	<p class="px-4 py-10 text-center text-red-400">Couldn't load them: {error}</p>
{:else if loading && !results.length}
	<Skeleton grid rows={6} />
{:else if !loading && !results.length}
	<div class="px-8 py-16 flex flex-col items-center gap-2 text-center">
		<span class="icon-[mingcute--earth-2-line] size-10 text-secondary-600"></span>
		<p class="text-lg font-semibold">
			{search.trim() ? `No public playlists match "${search.trim()}"` : 'No public playlists yet'}
		</p>
		<p class="text-sm text-secondary-600">Be the first: make one of yours public.</p>
	</div>
{/if}

<ul class="px-2 pb-4 grid grid-cols-2 gap-1">
	{#each results as playlist (playlist.id)}
		{@const saved = isSaved(playlist)}
		{@const mine = isMine(playlist)}
		<li class="relative">
			<a href="{base}/playlist/{playlist.id}" class="block p-2 rounded-lg active:bg-white/[0.06]">
				<PlaylistCover
					{playlist}
					class="w-full aspect-square rounded-md shadow-lg shadow-black/40"
					iconClass="size-12"
				/>
				<p class="mt-2 font-semibold truncate">{playlist.title}</p>
				<p class="text-sm text-secondary-600 truncate">
					{mine ? 'You' : (playlist.creator?.username ?? 'Someone')} · {playlist.song_amount}
					{playlist.song_amount === 1 ? 'song' : 'songs'}
				</p>
				{#if playlist.saves}
					<p class="text-xs text-secondary-600">
						{playlist.saves}
						{playlist.saves === 1 ? 'save' : 'saves'}
					</p>
				{/if}
			</a>
			{#if !mine}
				<button
					aria-label={saved
						? `Remove ${playlist.title} from your library`
						: `Save ${playlist.title} to your library`}
					aria-pressed={saved}
					class="tap absolute top-4 right-4 size-10 grid place-items-center rounded-full bg-black/60 {saved
						? 'text-primary-400'
						: 'text-white'}"
					onclick={() => toggleSavedPlaylist(playlist)}
				>
					<span
						class="{saved
							? 'icon-[mingcute--bookmark-fill]'
							: 'icon-[mingcute--bookmark-line]'} size-5"
					></span>
				</button>
			{/if}
		</li>
	{/each}
</ul>
{#if more && !loading}
	{#key results.length}
		<div use:nearView={() => load(false)} class="h-20"></div>
	{/key}
{:else if loading && results.length}
	<div class="py-6 grid place-items-center">
		<span class="icon-[svg-spinners--ring-resize] size-6 text-secondary-600"></span>
	</div>
{/if}
