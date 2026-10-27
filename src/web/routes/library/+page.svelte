<script>
	const base = __WEB_BASE__;
	// Your playlists (the same as in the desktop app: from the Stosufy API); + makes a new one
	import { goto } from '$app/navigation';
	import { keyStore, logOut } from '../../shims/auth';
	import { playlists, savedPlaylists, createPlaylist } from '../../../lib/stores/playlist';
	import { showToast } from '../../../lib/stores/toast';
	import { libraryState, loadLibrary } from '../../library';
	import PlaylistCover from '../../PlaylistCover.svelte';
	import { offline } from '../../../lib/stores/network';

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

<header class="px-5 pt-6 pb-3 flex items-end justify-between gap-3">
	<h1 class="text-3xl font-extrabold">Library</h1>
	<div class="flex items-center gap-1">
		<button
			aria-label="New playlist"
			class="size-10 grid place-items-center text-secondary-600"
			onclick={() => (creating = !creating)}
		>
			<span class="icon-[mingcute--add-line] size-6"></span>
		</button>
		<button
			aria-label="Reload"
			class="size-10 grid place-items-center text-secondary-600"
			disabled={$libraryState.loading}
			onclick={() => loadLibrary($keyStore.access_token, true)}
		>
			<span
				class="{$libraryState.loading
					? 'icon-[svg-spinners--ring-resize]'
					: 'icon-[mingcute--refresh-2-line]'} size-5"
			></span>
		</button>
		<button class="h-10 px-2 text-sm text-secondary-600" onclick={logOut}>Log out</button>
	</div>
</header>

{#if creating}
	<form
		class="mx-5 mb-3 flex gap-2"
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
			class="flex-1 min-w-0 h-11 px-3 rounded-xl bg-secondary-300 text-base outline-none focus:ring-2 focus:ring-primary-400"
			placeholder="Name of the playlist"
			aria-label="Name of the new playlist"
		/>
		<button
			class="h-11 px-4 rounded-xl bg-primary-300 font-semibold disabled:opacity-50"
			disabled={!title.trim() || saving}
		>
			{saving ? '…' : 'Make'}
		</button>
	</form>
{/if}

{#if $libraryState.error && !$offline}
	<p class="px-5 pb-2 text-sm text-red-400">
		Couldn't load the playlists: {$libraryState.error}{all.length ? ' (these are from before)' : ''}
	</p>
{/if}
{#if $libraryState.loading && !all.length}
	<p class="px-5 text-sm text-secondary-600">Loading…</p>
{/if}
<ul class="px-3">
	{#each all as playlist (playlist.id)}
		<li>
			<a
				href="{base}/playlist/{playlist.id}"
				class="flex items-center gap-3 p-2 rounded-lg active:bg-white/5"
			>
				<PlaylistCover {playlist} />
				<span class="min-w-0">
					<span class="block font-semibold truncate">{playlist.title}</span>
					<span class="block text-sm text-secondary-600 truncate">
						{playlist.song_amount ?? 0} songs{playlist.creator?.username
							? ` · ${playlist.creator.username}`
							: ''}
					</span>
				</span>
			</a>
		</li>
	{/each}
</ul>
