<script>
	const base = __WEB_BASE__;
	// Your playlists (the same as in the desktop app: from the Stosufy API)
	import { keyStore, logOut } from '../shims/auth';
	import {
		playlists,
		savedPlaylists,
		getPlaylists,
		loadSavedPlaylists
	} from '../../lib/stores/playlist';
	import Login from '../Login.svelte';

	let loading = $state(false);
	let error = $state('');

	$effect(() => {
		if ($keyStore.access_token) load($keyStore.access_token);
	});

	async function load(token) {
		loading = true;
		error = '';
		try {
			const own = await getPlaylists(token);
			playlists.set([{ id: -2, title: 'Liked Songs', song_amount: 0 }, ...own]);
			loadSavedPlaylists().catch(() => {});
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	let all = $derived([...$playlists, ...$savedPlaylists]);
</script>

{#if !$keyStore.access_token}
	<Login />
{:else}
	<header class="px-5 pt-6 pb-3 flex items-end justify-between">
		<h1 class="text-3xl font-extrabold">Playlists</h1>
		<button class="text-sm text-secondary-600" onclick={logOut}>Log out</button>
	</header>
	{#if error}
		<p class="px-5 text-sm text-red-400">Couldn't load the playlists: {error}</p>
	{/if}
	{#if loading && !all.length}
		<p class="px-5 text-sm text-secondary-600">Loading…</p>
	{/if}
	<ul class="px-3">
		{#each all as playlist (playlist.id)}
			<li>
				<a
					href="{base}/playlist/{playlist.id}"
					class="flex items-center gap-3 p-2 rounded-lg active:bg-white/5"
				>
					{#if playlist.id == -2}
						<span
							class="size-14 shrink-0 grid place-items-center rounded-md bg-gradient-to-br from-primary-300 to-primary-700"
						>
							<span class="icon-[mingcute--heart-fill] size-6"></span>
						</span>
					{:else if playlist.image_url}
						<img src={playlist.image_url} alt="" class="size-14 shrink-0 rounded-md object-cover" />
					{:else}
						<span class="size-14 shrink-0 grid place-items-center rounded-md bg-secondary-300">
							<span class="icon-[mingcute--music-2-line] size-6 text-secondary-600"></span>
						</span>
					{/if}
					<span class="min-w-0">
						<span class="block font-semibold truncate">{playlist.title}</span>
						<span class="block text-sm text-secondary-600 truncate">
							{playlist.id == -2 ? 'Your liked songs' : `${playlist.song_amount} songs`}
							{playlist.creator?.username ? ` · ${playlist.creator.username}` : ''}
						</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}
