<script>
	const base = __WEB_BASE__;
	// Your library, as the desktop app's sidebar: the downloads, the liked songs, your
	// playlists and the ones you saved; + makes a new one
	import { goto } from '$app/navigation';
	import { keyStore } from '../../shims/auth';
	import { playlists, savedPlaylists, createPlaylist } from '../../../lib/stores/playlist';
	import { showToast } from '../../../lib/stores/toast';
	import { libraryState, loadLibrary } from '../../library';
	import PlaylistCover from '../../../lib/components/PlaylistCover.svelte';
	import { downloadedSongs } from '../../downloads';
	import { offline } from '../../../lib/stores/network';
	import {
		smartPlaylists,
		smartSongs,
		createSmartPlaylist
	} from '../../../lib/stores/smartPlaylists';
	import MixCover from '../../../lib/components/MixCover.svelte';

	let all = $derived([...$playlists, ...$savedPlaylists]);
	let creating = $state(false);
	let title = $state('');
	let saving = $state(false);

	async function create() {
		const name = title.trim();
		if (!name || saving) return;
		saving = true;
		try {
			const playlist = await createPlaylist(name);
			playlists.update((list) => [...list, { ...playlist, song_amount: 0 }]);
			creating = false;
			title = '';
			goto(`${base}/playlist/${playlist.id}`);
		} catch (e) {
			showToast(
				`Couldn't make the playlist: ${e instanceof Error ? e.message : e}`,
				'icon-[mingcute--warning-line]'
			);
		} finally {
			saving = false;
		}
	}
</script>

<header class="px-4 pt-5 pb-3 flex items-center justify-between gap-3">
	<h1 class="text-2xl font-bold tracking-tight">Your Library</h1>
	<div class="flex items-center">
		<button
			aria-label="Reload"
			class="size-11 grid place-items-center text-secondary-600"
			disabled={$libraryState.loading}
			onclick={() => loadLibrary($keyStore.access_token, true)}
		>
			<span
				class="{$libraryState.loading
					? 'icon-[svg-spinners--ring-resize]'
					: 'icon-[mingcute--refresh-2-line]'} size-6"
			></span>
		</button>
		<button
			aria-label="New playlist"
			class="size-11 grid place-items-center text-secondary-600"
			onclick={() => (creating = !creating)}
		>
			<span class="icon-[mingcute--add-line] size-7"></span>
		</button>
	</div>
</header>

{#if creating}
	<button
		class="mx-4 mb-2 w-[calc(100%-2rem)] flex items-center gap-3 p-2 rounded-md bg-white/[0.04] active:bg-white/[0.08] text-start"
		onclick={() => {
			creating = false;
			goto(`${base}/smart/${createSmartPlaylist().id}?edit`);
		}}
	>
		<span class="size-10 grid place-items-center rounded-md bg-primary-300/30 text-primary-400">
			<span class="icon-[mingcute--magic-2-line] size-6"></span>
		</span>
		<span class="min-w-0">
			<span class="block font-semibold">New smart playlist</span>
			<span class="block text-sm text-secondary-600"
				>Fills itself with songs like the ones you add</span
			>
		</span>
	</button>
	<form
		class="mx-4 mb-3 flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			create();
		}}
	>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={title}
			autofocus
			maxlength="100"
			class="flex-1 min-w-0 h-10 px-3 rounded-md bg-white/[0.06] outline-none ring-1 ring-transparent focus:ring-white/20"
			placeholder="Name of the playlist"
			aria-label="Name of the new playlist"
		/>
		<button
			class="h-10 px-4 rounded-md bg-primary-300 font-semibold disabled:opacity-50"
			disabled={!title.trim() || saving}
		>
			{saving ? '…' : 'Create'}
		</button>
	</form>
{/if}

{#if $libraryState.error && !$offline}
	<p class="px-4 pb-2 text-sm text-red-400">
		Couldn't load the playlists: {$libraryState.error}{all.length ? ' (these are from before)' : ''}
	</p>
{/if}

{#snippet entry(href, playlist, name, detail)}
	<li>
		<a {href} class="flex items-center gap-3 p-2 rounded-md active:bg-white/[0.06]">
			<PlaylistCover {playlist} class="size-12 rounded-md" iconClass="size-5" />
			<span class="min-w-0">
				<span class="block font-semibold truncate">{name}</span>
				<span class="block text-sm text-secondary-600 truncate">{detail}</span>
			</span>
		</a>
	</li>
{/snippet}

<ul class="px-2 pb-4">
	{@render entry(
		`${base}/library/downloads`,
		{ id: -1, title: 'Downloaded Songs', song_amount: 0 },
		'Downloaded Songs',
		`On this phone · ${$downloadedSongs.length} songs`
	)}
	{#each all as playlist (playlist.id)}
		{@render entry(
			`${base}/playlist/${playlist.id}`,
			playlist,
			playlist.title,
			playlist.id == -2
				? `Liked · ${playlist.song_amount ?? 0} songs`
				: `${playlist.creator?.username && !$playlists.some((p) => p.id === playlist.id) ? playlist.creator.username : 'Playlist'} · ${playlist.song_amount ?? 0} songs`
		)}
	{/each}
	{#each $smartPlaylists as smart (smart.id)}
		{@const songs = smartSongs(smart)}
		<li>
			<a
				href="{base}/smart/{smart.id}"
				class="flex items-center gap-3 p-2 rounded-md active:bg-white/[0.06]"
			>
				{#if songs.length}
					<MixCover {songs} class="size-12 rounded-md" />
				{:else}
					<span class="size-12 grid place-items-center rounded-md bg-white/[0.06]">
						<span class="icon-[mingcute--magic-2-line] size-5 text-secondary-600"></span>
					</span>
				{/if}
				<span class="min-w-0">
					<span class="block font-semibold truncate">{smart.title}</span>
					<span class="flex items-center gap-1 text-sm text-secondary-600 truncate">
						<span class="icon-[mingcute--magic-2-line] size-3.5 shrink-0"></span>
						Smart playlist · {songs.length} songs
					</span>
				</span>
			</a>
		</li>
	{/each}
</ul>
{#if $libraryState.loading && !all.length}
	<div class="py-6 grid place-items-center">
		<span class="icon-[svg-spinners--ring-resize] size-6 text-secondary-600"></span>
	</div>
{/if}
