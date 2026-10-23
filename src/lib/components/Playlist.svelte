<script>
	import { keyStore } from '#lib/stores/auth.ts';
	import { user } from '#lib/stores/user.ts';
	import Button from './Button.svelte';
	import { getImageUrl, mapDataStore, formatSongData } from '#lib/stores/data.ts';
	import {
		playlists,
		getPlaylists,
		createPlaylist,
		deletePlaylist,
		editPlaylist,
		loadAllPlaylistSongs,
		savedPlaylists,
		loadSavedPlaylists,
		toggleSavedPlaylist,
		offlineLibrary
	} from '#lib/stores/playlist.ts';
	import { offline, noteNetworkError } from '#lib/stores/network.ts';
	import { favourites, likedPlaylist, loadFavourites, LIKED_ID } from '#lib/stores/favourites.ts';
	import { smartPlaylists, createSmartPlaylist } from '#lib/stores/smartPlaylists.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import Input from './Input.svelte';
	import PlaylistCover from './PlaylistCover.svelte';
	import DownloadQueue from './DownloadQueue.svelte';
	import { profileImportOpen } from '#lib/stores/osuProfile.ts';
	import { showToast } from '#lib/stores/toast.ts';

	let addMenuOpen = $state(false);

	let fileInput;
	let uploadedImage = $state(null);

	let editPlaylistModal = $state({
		open: false,
		playlist: null,
		title: '',
		description: '',
		isPublic: false,
		selectedFile: null,
		imageError: ''
	});

	// "Downloaded Songs" counts songs, so a set with several songs counts each of them
	let downloadedCount = $derived(formatSongData($mapDataStore).length);
	$effect(() => {
		if ($playlists.some((p) => p.id == -1 && p.song_amount !== downloadedCount)) {
			$playlists = $playlists.map((p) => (p.id == -1 ? { ...p, song_amount: downloadedCount } : p));
		}
	});

	async function getPlaylist() {
		let playlist_list = [];
		try {
			playlist_list = await getPlaylists($keyStore.access_token);
		} catch (error) {
			// Offline: the playlists as they were the last time
			noteNetworkError(error);
			const kept = await offlineLibrary();
			playlist_list = (kept?.playlists ?? []).filter((p) => Number(p.id) > 0);
			if (kept?.saved) savedPlaylists.set(kept.saved);
			if (!kept) console.error('Could not load the playlists:', error);
		}

		const downloadedSongsPlaylist = {
			id: -1,
			title: 'Downloaded Songs',
			description: 'Your downloaded music collection',
			image_url: null,
			song_amount: formatSongData($mapDataStore).length,
			created_at: null,
			updated_at: null,
			public: false
		};

		// Liked Songs come right after the downloads (their count once they're loaded)
		$playlists = [downloadedSongsPlaylist, likedPlaylist($favourites.length), ...playlist_list];
		loadAllPlaylistSongs();
		loadFavourites().catch(
			(error) => !$offline && console.error('Could not load the liked songs:', error)
		);
		loadSavedPlaylists().catch(
			(error) => !$offline && console.error('Could not load the saved playlists:', error)
		);
	}

	// The number of liked songs
	$effect(() => {
		const count = $favourites.length;
		if ($playlists.some((p) => p.id == LIKED_ID && p.song_amount !== count)) {
			$playlists = $playlists.map((p) => (p.id == LIKED_ID ? { ...p, song_amount: count } : p));
		}
	});

	/** Downloaded Songs and Liked Songs: not real playlists */
	const isVirtual = (playlist) => playlist.id == -1 || playlist.id == LIKED_ID;

	async function createNewPlaylist() {
		let amount = 1;
		$playlists.forEach((element) => {
			if (element?.created_by == $user?.stosufy_id) {
				amount++;
			}
		});
		const tempId = `temp-${Date.now()}`;
		const dummyPlaylist = {
			id: tempId,
			title: `My Playlist Nr.${amount}`,
			song_amount: 0,
			image_url: null,
			created_by: $user?.stosufy_id
		};

		const virtual = $playlists.filter(isVirtual);
		$playlists = [...virtual, dummyPlaylist, ...$playlists.filter((p) => !isVirtual(p))];
		try {
			const newPlaylist = await createPlaylist(`My Playlist Nr.${amount}`);
			$playlists = $playlists.map((playlist) => (playlist.id === tempId ? newPlaylist : playlist));
		} catch (error) {
			console.error('Could not create the playlist:', error);
			$playlists = $playlists.filter((playlist) => playlist.id !== tempId);
			showToast("Couldn't create the playlist, try again", 'icon-[mingcute--warning-line]');
		}
	}

	let playlistToDelete = $state(null);
	let deleteModalOpen = $state(false);

	async function deleteClickedPlaylist(playlistId) {
		const before = $playlists;
		$playlists = $playlists.filter((playlist) => playlist.id !== playlistId);
		if (page.params?.id == playlistId) goto('/home');
		try {
			await deletePlaylist(playlistId);
		} catch (error) {
			console.error('Could not delete the playlist:', error);
			$playlists = before;
			showToast("Couldn't delete the playlist, try again", 'icon-[mingcute--warning-line]');
		}
	}

	let saving = $state(false);

	async function handleImageSelect(event) {
		const file = event.target.files[0];
		if (file) {
			editPlaylistModal.imageError = '';

			// Check if it's an image
			if (!file.type.startsWith('image/')) {
				editPlaylistModal.imageError = 'Selected file is not an image';
				return;
			}

			// Check if size is under 1MB (1048576 bytes)
			if (file.size > 1048576) {
				editPlaylistModal.imageError = 'Image size must be less than 1MB';
				return;
			}
			editPlaylistModal.selectedFile = file;
			const imageUrl = URL.createObjectURL(file);
			uploadedImage = imageUrl;
		}
	}

	async function handleSavePlaylistChanges() {
		const { playlist, title, description, isPublic, selectedFile } = editPlaylistModal;
		if (saving) return;
		saving = true;
		try {
			const updatedPlaylist = await editPlaylist(
				playlist.id,
				title,
				description,
				isPublic,
				selectedFile
			);
			$playlists = $playlists.map((p) =>
				p.id === playlist.id ? { ...updatedPlaylist, song_amount: p.song_amount } : p
			);
			editPlaylistModal.open = false;
		} catch (error) {
			console.error('Could not save the playlist:', error);
			editPlaylistModal.imageError = `Couldn't save: ${error instanceof Error ? error.message : error}`;
		} finally {
			saving = false;
		}
	}

	let lastUserId = null;

	// Load the playlists once a user is logged in or the user changed; offline (also without
	// a user known yet) from the copy on this computer, and again once the connection is back
	let wasOffline = false;
	$effect(() => {
		const isOffline = $offline;
		if ($user?.id && lastUserId !== $user.id) {
			lastUserId = $user.id;
			getPlaylist();
		} else if (isOffline && !$playlists.length) getPlaylist();
		else if (wasOffline && !isOffline) getPlaylist();
		wasOffline = isOffline;
	});
</script>

<div class="h-full flex flex-col">
	<div class="flex items-center justify-between pl-5 pr-3 h-14 shrink-0">
		<h2 class="font-bold">Your Library</h2>
		<div class="relative flex items-center gap-1">
			<button
				title="Community playlists"
				aria-label="Community playlists"
				class="size-8 grid place-items-center rounded-full cursor-pointer transition {page.url
					?.pathname === '/community'
					? 'text-white bg-secondary-300'
					: 'text-secondary-600 hover:text-white hover:bg-secondary-300'}"
				onclick={() => goto('/community')}
			>
				<span class="icon-[mingcute--earth-2-line] size-5"></span>
			</button>
			<button
				title="Create playlist"
				aria-label="Create playlist"
				aria-haspopup="menu"
				aria-expanded={addMenuOpen}
				class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
				onclick={() => (addMenuOpen = !addMenuOpen)}
			>
				<span class="icon-[mingcute--add-line] size-5"></span>
			</button>
			{#if addMenuOpen}
				<!-- Closes the menu on a click anywhere else -->
				<button
					class="fixed inset-0 z-40 cursor-default"
					aria-label="Close menu"
					tabindex="-1"
					onclick={() => (addMenuOpen = false)}
				></button>
				<div
					role="menu"
					class="absolute right-0 top-9 z-50 w-56 p-1 rounded-md bg-secondary-200 shadow-xl border border-white/5"
				>
					<button
						role="menuitem"
						class="w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-start hover:bg-secondary-400 cursor-pointer"
						onclick={() => {
							addMenuOpen = false;
							createNewPlaylist();
						}}
					>
						<span class="icon-[mingcute--playlist-line] size-[18px] text-secondary-600"></span>
						New playlist
					</button>
					<button
						role="menuitem"
						class="w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-start hover:bg-secondary-400 cursor-pointer"
						onclick={() => {
							addMenuOpen = false;
							goto(`/smart/${createSmartPlaylist().id}?edit`);
						}}
					>
						<span class="icon-[mingcute--magic-2-line] size-[18px] text-secondary-600"></span>
						New smart playlist
					</button>
					<button
						role="menuitem"
						class="w-full flex items-center gap-3 px-3 py-2 rounded text-sm text-start hover:bg-secondary-400 cursor-pointer"
						onclick={() => {
							addMenuOpen = false;
							$profileImportOpen = true;
						}}
					>
						<span class="icon-[mingcute--user-heart-line] size-[18px] text-secondary-600"></span>
						From your osu! profile
					</button>
				</div>
			{/if}
		</div>
	</div>
	<ul class="flex-1 overflow-y-auto flex flex-col px-2 pb-2">
		{#each $playlists as playlist (playlist.id)}
			{@const isActive = page.params?.id == playlist.id}
			<li>
				<ContextMenu disabled={isVirtual(playlist)}>
					<div
						class="group flex items-center gap-3 p-2 rounded-md transition {isActive
							? 'bg-secondary-300'
							: 'hover:bg-secondary-200'}"
					>
						<button
							onclick={() => goto(`/playlist/${playlist?.id}`)}
							aria-current={isActive ? 'page' : undefined}
							class="flex flex-1 min-w-0 items-center gap-3 text-start cursor-pointer"
						>
							<PlaylistCover {playlist} />
							<div class="min-w-0">
								<h3 class="font-semibold truncate {isActive ? 'text-primary-500' : ''}">
									{playlist.title}
								</h3>
								<p class="text-sm text-secondary-600 truncate">
									{playlist.id == -1
										? 'On this device'
										: playlist.id == LIKED_ID
											? 'Liked'
											: playlist.public
												? 'Public playlist'
												: 'Playlist'} · {playlist.song_amount || 0}
									{playlist.song_amount === 1 ? 'song' : 'songs'}
								</p>
							</div>
						</button>
						{#if !isVirtual(playlist)}
							<button
								title="Delete playlist"
								aria-label="Delete {playlist.title}"
								class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
								onclick={() => {
									playlistToDelete = playlist;
									deleteModalOpen = true;
								}}
							>
								<span class="icon-[mingcute--delete-2-line] size-[18px]"></span>
							</button>
						{/if}
					</div>
					<svelte:fragment slot="menu">
						{#if !isVirtual(playlist)}
							<Button
								type="ghost"
								class="w-full rounded-md text-sm hover:bg-secondary-400"
								icon="icon-[mingcute--pencil-line]"
								on:click={async (e) => {
									e.preventDefault();
									editPlaylistModal.open = true;
									editPlaylistModal.playlist = playlist;
									editPlaylistModal.title = playlist.title || '';
									editPlaylistModal.description = playlist.description || '';
									editPlaylistModal.isPublic = playlist.public || false;
									editPlaylistModal.selectedFile = null;
									uploadedImage = null;
									editPlaylistModal.imageError = '';
								}}
							>
								Edit details
							</Button>
						{/if}
					</svelte:fragment>
				</ContextMenu>
			</li>
		{/each}
		{#if $smartPlaylists.length}
			<li class="px-2 pt-4 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
				Smart playlists
			</li>
			{#each $smartPlaylists as smart (smart.id)}
				{@const isActive = page.url?.pathname === `/smart/${smart.id}`}
				<li>
					<button
						onclick={() => goto(`/smart/${smart.id}`)}
						aria-current={isActive ? 'page' : undefined}
						class="w-full flex items-center gap-3 p-2 rounded-md text-start cursor-pointer transition {isActive
							? 'bg-secondary-300'
							: 'hover:bg-secondary-200'}"
					>
						<span
							class="size-12 shrink-0 grid place-items-center rounded-md bg-gradient-to-br from-primary-300 to-primary-700"
						>
							<span class="icon-[mingcute--magic-2-line] size-6 text-white/90"></span>
						</span>
						<span class="min-w-0">
							<span class="block font-semibold truncate {isActive ? 'text-primary-500' : ''}"
								>{smart.title}</span
							>
							<span class="block text-sm text-secondary-600 truncate">
								Smart playlist · {smart.rules.length}
								{smart.rules.length === 1 ? 'rule' : 'rules'}
							</span>
						</span>
					</button>
				</li>
			{/each}
		{/if}
		{#if $savedPlaylists.length}
			<li class="px-2 pt-4 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
				Saved
			</li>
			{#each $savedPlaylists as playlist (playlist.id)}
				{@const isActive = page.params?.id == playlist.id}
				<li>
					<div
						class="group flex items-center gap-3 p-2 rounded-md transition {isActive
							? 'bg-secondary-300'
							: 'hover:bg-secondary-200'}"
					>
						<button
							onclick={() => goto(`/playlist/${playlist.id}`)}
							aria-current={isActive ? 'page' : undefined}
							class="flex flex-1 min-w-0 items-center gap-3 text-start cursor-pointer"
						>
							<PlaylistCover {playlist} />
							<div class="min-w-0">
								<h3 class="font-semibold truncate {isActive ? 'text-primary-500' : ''}">
									{playlist.title}
								</h3>
								<p class="text-sm text-secondary-600 truncate">
									by {playlist.creator?.username ?? 'someone'} · {playlist.song_amount || 0}
									{playlist.song_amount === 1 ? 'song' : 'songs'}
								</p>
							</div>
						</button>
						<button
							title="Remove from your library"
							aria-label="Remove {playlist.title} from your library"
							class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
							onclick={() => toggleSavedPlaylist(playlist)}
						>
							<span class="icon-[mingcute--bookmark-remove-line] size-[18px]"></span>
						</button>
					</div>
				</li>
			{/each}
		{/if}
	</ul>
	<DownloadQueue />
</div>

<Modal title="Delete playlist" width="420px" bind:open={deleteModalOpen}>
	<p>
		Do you really want to delete <strong>{playlistToDelete?.title}</strong>? This cannot be undone.
	</p>
	<svelte:fragment slot="footer">
		<Button
			on:click={() => {
				deleteModalOpen = false;
			}}
		>
			Cancel
		</Button>
		<Button
			type="primary"
			class="bg-red-500! hover:bg-red-600! active:bg-red-700!"
			on:click={async () => {
				deleteModalOpen = false;
				await deleteClickedPlaylist(playlistToDelete.id);
			}}
		>
			Delete
		</Button>
	</svelte:fragment>
</Modal>

<Modal title="Edit details" bind:open={editPlaylistModal.open}>
	<div class="flex flex-col md:flex-row gap-4">
		<div class="flex flex-col items-center">
			<button
				class="relative flex-shrink-0 w-[150px] h-[150px] flex items-center justify-center group cursor-pointer rounded-md overflow-hidden"
				onclick={() => fileInput.click()}
			>
				<input
					type="file"
					bind:this={fileInput}
					accept="image/*"
					class="hidden"
					onchange={handleImageSelect}
				/>

				<div
					class="absolute inset-0 bg-secondary-100/70 opacity-0 group-hover:opacity-100 z-10"
				></div>

				<span
					class="icon-[fa6-solid--pencil] absolute opacity-0 group-hover:opacity-100 text-white size-8 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
				></span>

				<div class="w-[150px] h-[150px] bg-secondary-300">
					<img
						class="w-full h-full object-cover"
						src={uploadedImage || getImageUrl(editPlaylistModal.playlist?.image_url)}
						alt="Playlist cover"
					/>
				</div>
			</button>

			{#if editPlaylistModal.imageError}
				<div class="mt-2 text-red-500 text-sm text-center w-[150px]">
					{editPlaylistModal.imageError}
				</div>
			{:else}
				<div class="mt-2 text-sm text-gray-400 text-center">
					Click to change image<br />
					<span class="text-xs">(max 1MB)</span>
				</div>
			{/if}
		</div>

		<div class="flex flex-col gap-3 flex-grow justify-start">
			<div>
				<h3 class="font-semibold mb-1">Playlist Title</h3>
				<Input bind:value={editPlaylistModal.title} type="text" placeholder="Playlist Title" />
			</div>
			<div>
				<h3 class="font-semibold mb-1">Playlist Description</h3>
				<Input
					bind:value={editPlaylistModal.description}
					type="text"
					placeholder="Playlist Description"
				/>
			</div>
			<label
				class="flex items-center justify-between gap-4 p-3 rounded-md bg-secondary-300/60 cursor-pointer"
			>
				<span>
					<span class="block font-semibold">Public</span>
					<span class="block text-sm text-secondary-600">
						Anyone can find it in Community playlists and save it to their library.
					</span>
				</span>
				<input type="checkbox" class="peer sr-only" bind:checked={editPlaylistModal.isPublic} />
				<span
					class="relative w-9 h-5 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
				></span>
			</label>
		</div>
	</div>
	<svelte:fragment slot="footer">
		<Button
			on:click={() => {
				editPlaylistModal.open = false;
			}}
		>
			Cancel
		</Button>
		<Button
			type="primary"
			on:click={handleSavePlaylistChanges}
			disabled={!editPlaylistModal.title || saving}
		>
			Save Changes
		</Button>
	</svelte:fragment>
</Modal>
