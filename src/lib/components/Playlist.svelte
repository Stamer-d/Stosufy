<script>
	import { keyStore } from '#lib/stores/auth.ts';
	import { user } from '#lib/stores/user.ts';
	import Button from './Button.svelte';
	import { getImageUrl, mapDataStore } from '#lib/stores/data.ts';
	import {
		playlists,
		getPlaylists,
		createPlaylist,
		deletePlaylist,
		editPlaylist,
		loadAllPlaylistSongs
	} from '#lib/stores/playlist.ts';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import Input from './Input.svelte';
	import PlaylistCover from './PlaylistCover.svelte';

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

	async function getPlaylist() {
		let playlist_list = await getPlaylists($keyStore.access_token);

		const downloadedSongsPlaylist = {
			id: -1,
			title: 'Downloaded Songs',
			description: 'Your downloaded music collection',
			image_url: null,
			song_amount: Object.keys($mapDataStore).length,
			created_at: null,
			updated_at: null,
			public: false
		};

		$playlists = [downloadedSongsPlaylist, ...playlist_list];
		loadAllPlaylistSongs();
	}

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

		$playlists = [$playlists[0], dummyPlaylist, ...$playlists.slice(1)];
		const newPlaylist = await createPlaylist(`My Playlist Nr.${amount}`);
		$playlists = $playlists.map((playlist) => (playlist.id === tempId ? newPlaylist : playlist));
	}

	let playlistToDelete = $state(null);
	let deleteModalOpen = $state(false);

	async function deleteClickedPlaylist(playlistId) {
		$playlists = $playlists.filter((playlist) => playlist.id !== playlistId);
		if (page.params?.id == playlistId) goto('/home');
		await deletePlaylist(playlistId);
	}

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
	}

	let lastUserId = null;

	// Load the playlists once a user is logged in or the user changed
	$effect(() => {
		if ($user?.id && lastUserId !== $user.id) {
			lastUserId = $user.id;
			getPlaylist();
		}
	});
</script>

<div class="h-full flex flex-col">
	<div class="flex items-center justify-between pl-5 pr-3 h-14 shrink-0">
		<h2 class="font-bold">Your Library</h2>
		<button
			title="Create playlist"
			aria-label="Create playlist"
			class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
			onclick={createNewPlaylist}
		>
			<span class="icon-[mingcute--add-line] size-5"></span>
		</button>
	</div>
	<ul class="flex-1 overflow-y-auto flex flex-col px-2 pb-2">
		{#each $playlists as playlist (playlist.id)}
			{@const isActive = page.params?.id == playlist.id}
			<li>
				<ContextMenu disabled={playlist.id == -1}>
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
									{playlist.id == -1 ? 'On this device' : 'Playlist'} · {playlist.song_amount || 0}
									{playlist.song_amount === 1 ? 'song' : 'songs'}
								</p>
							</div>
						</button>
						{#if playlist.id !== -1}
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
						{#if playlist.id !== -1}
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
	</ul>
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
		<Button type="primary" on:click={handleSavePlaylistChanges} disabled={!editPlaylistModal.title}>
			Save Changes
		</Button>
	</svelte:fragment>
</Modal>
