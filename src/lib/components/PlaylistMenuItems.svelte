<script>
	// The right-click menu of a playlist in the library: its songs to the queue or downloaded,
	// and (as it's yours or saved) editing, deleting or removing it
	import Button from './Button.svelte';
	import { queueSongs } from '#lib/stores/audio.ts';
	import { getPlaylistSongs, toggleSavedPlaylist } from '#lib/stores/playlist.ts';
	import { smartSongs } from '#lib/stores/smartPlaylists.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { queueDownloads } from '#lib/stores/downloadQueue.ts';
	import { offline } from '#lib/stores/network.ts';
	import { showToast } from '#lib/stores/toast.ts';

	/**
	 * `kind`: 'own' (yours: edit and delete), 'saved' (someone else's in your library),
	 * 'smart' (a smart playlist) or 'virtual' (Downloaded Songs and Liked Songs)
	 * @type {{
	 *   playlist: any,
	 *   kind: 'own' | 'saved' | 'smart' | 'virtual',
	 *   onEdit?: () => void,
	 *   onDelete?: () => void
	 * }}
	 */
	let { playlist, kind, onEdit, onDelete } = $props();

	const ITEM = 'w-full rounded-md text-sm hover:bg-secondary-400';
	let queueId = $derived(kind === 'smart' ? `smart:${playlist.id}` : playlist.id);
	// Downloaded Songs only holds downloaded songs
	let downloadable = $derived(playlist.id != -1);

	async function songsOf() {
		if (kind === 'smart') return smartSongs(playlist);
		return (await getPlaylistSongs(playlist.id)).songs ?? [];
	}

	async function addToQueue() {
		const songs = await songsOf();
		if (!songs.length) {
			showToast(`"${playlist.title}" has no songs yet`);
			return;
		}
		await queueSongs(songs, queueId);
		showToast(
			`Added ${songs.length} ${songs.length === 1 ? 'song' : 'songs'} of "${playlist.title}" to the queue`,
			'icon-[mingcute--playlist-2-line]'
		);
	}

	async function downloadAll() {
		if ($offline) {
			showToast(
				"You're offline: songs download once you're connected",
				'icon-[mingcute--wifi-off-line]'
			);
			return;
		}
		const missing = (await songsOf()).filter(
			(song) => !Object.prototype.hasOwnProperty.call($mapDataStore, String(song.id))
		);
		if (!missing.length) {
			showToast(`All songs of "${playlist.title}" are downloaded`, 'icon-[mingcute--check-line]');
			return;
		}
		queueDownloads(missing.map((song) => ({ set: song, mapId: song.beatmaps[0].id })));
		showToast(
			`Downloading ${missing.length} ${missing.length === 1 ? 'song' : 'songs'} of "${playlist.title}"`,
			'icon-[mingcute--download-2-line]'
		);
	}
</script>

<Button type="ghost" class={ITEM} icon="icon-[mingcute--playlist-2-line]" on:click={addToQueue}>
	Add to queue
</Button>
{#if downloadable}
	<Button type="ghost" class={ITEM} icon="icon-[mingcute--download-2-line]" on:click={downloadAll}>
		Download all songs
	</Button>
{/if}
{#if onEdit}
	<Button type="ghost" class={ITEM} icon="icon-[mingcute--pencil-line]" on:click={onEdit}>
		{kind === 'smart' ? 'Add songs' : 'Edit details'}
	</Button>
{/if}
{#if kind === 'saved'}
	<Button
		type="ghost"
		class={ITEM}
		icon="icon-[mingcute--bookmark-remove-line]"
		on:click={() => toggleSavedPlaylist(playlist)}
	>
		Remove from your library
	</Button>
{/if}
{#if onDelete}
	<Button
		type="ghost"
		class="{ITEM} text-red-400!"
		icon="icon-[mingcute--delete-2-line]"
		on:click={onDelete}
	>
		Delete playlist
	</Button>
{/if}
