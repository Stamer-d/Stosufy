<script>
	import { keyStore, user } from '$lib/stores/auth';
	import Button from './Button.svelte';
	import { getImageUrl, mapDataStore } from '$lib/stores/data';
	import {
		playlists,
		getPlaylists,
		createPlaylist,
		deletePlaylist,
		loadAllPlaylistSongs
	} from '$lib/stores/playlist';
	import { goto } from '$app/navigation';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import Input from './Input.svelte';
	import { writable } from 'svelte/store';
	import { editPlaylist } from '$lib/stores/playlist';

	let fileInput;
	let uploadedImage = writable(null);

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
			image_path: null,
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
			image_path: null,
			created_by: $user?.stosufy_id
		};

		$playlists = [$playlists[0], dummyPlaylist, ...$playlists.slice(1)];
		const newPlaylist = await createPlaylist(`My Playlist Nr.${amount}`);
		$playlists = $playlists.map((playlist) => (playlist.id === tempId ? newPlaylist : playlist));
	}

	async function deleteClickedPlaylist(playlistId) {
		$playlists = $playlists.filter((playlist) => playlist.id !== playlistId);
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
			$uploadedImage = imageUrl;
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

	let playlistsLoaded = false;
	let lastUserId = null;

	// Replace the effect with this improved version
	$effect(async () => {
		if ($user?.id && (!playlistsLoaded || lastUserId !== $user.id)) {
			lastUserId = $user.id;
			await getPlaylist();
			playlistsLoaded = true;
		}
	});
</script>

<div class="h-full flex flex-col text-white">
	<div class="flex items-center justify-between p-4 0">
		<h2 class="text-xl font-bold">Playlists</h2>
		<Button
			type="ghost"
			icon="icon-[fa6-solid--plus]"
			class="text-gray-400 hover:text-white"
			on:click={async () => {
				await createNewPlaylist();
			}}
		/>
	</div>
	<ul class="overflow-y-auto flex flex-col gap-2 pl-2">
		{#each $playlists as playlist}
			<ContextMenu disabled={playlist.id == -1 ? true : false}>
				<button
					on:click={() => {
						goto(`/playlist/${playlist?.id}`);
					}}
					class="group flex items-center p-2 rounded-md hover:bg-secondary-200 w-full cursor-pointer transition duration-100"
				>
					<div class="w-12 h-12 mr-3 flex items-center">
						<div class="relative w-12 h-12 aspect-square">
							<img
								src={playlist.id !== -1 ? getImageUrl(playlist.image_path) : '/NoLetterLogo.png'}
								alt={playlist.title}
								class="w-full h-full object-cover rounded-md aspect-square"
							/>
							{#if playlist.id == -1}
								<span
									class="icon-[fa6-solid--circle-arrow-down] text-white absolute size-6 top-3.5 left-3"
								></span>
							{/if}
						</div>
					</div>
					<div class="overflow-hidden text-start">
						<h3 class="font-medium truncate">{playlist.title}</h3>
						<p class="">{playlist.song_amount || 0} Songs</p>
					</div>
					{#if playlist.id !== -1}
						<Button
							type="ghost"
							icon="icon-[fa6-solid--trash]"
							class="text-gray-400 hover:text-white ml-auto opacity-0 group-hover:opacity-100"
							on:click={async (e) => {
								e.preventDefault();
								await deleteClickedPlaylist(playlist.id);
							}}
						/>
					{/if}
				</button>
				<svelte:fragment slot="menu">
					{#if playlist.id !== -1}
						<Button
							type="ghost"
							class="w-full py-3 rounded-sm hover:bg-secondary-300"
							icon="icon-[fa6-solid--pen]"
							on:click={async (e) => {
								e.preventDefault();
								editPlaylistModal.open = true;
								editPlaylistModal.playlist = playlist;
								editPlaylistModal.title = playlist.title || '';
								editPlaylistModal.description = playlist.description || '';
								editPlaylistModal.isPublic = playlist.public || false;
								editPlaylistModal.selectedFile = null;
								$uploadedImage = null;
								editPlaylistModal.imageError = '';
							}}
						>
							Edit Playlist
						</Button>
					{/if}
				</svelte:fragment>
			</ContextMenu>
		{/each}
	</ul>
</div>

<Modal title="Edit Playlist" bind:open={editPlaylistModal.open}>
	<div class="flex flex-col md:flex-row gap-4">
		<div class="flex flex-col items-center">
			<button
				class="relative flex-shrink-0 w-[150px] h-[150px] flex items-center justify-center group cursor-pointer rounded-md overflow-hidden"
				on:click={() => fileInput.click()}
			>
				<input
					type="file"
					bind:this={fileInput}
					accept="image/*"
					class="hidden"
					on:change={handleImageSelect}
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
						src={$uploadedImage || getImageUrl(editPlaylistModal.playlist?.image_path)}
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
