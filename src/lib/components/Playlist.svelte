<script>
	import { keyStore, user } from '$lib/stores/auth';
	import Button from './Button.svelte';
	import { getImageUrl, mapDataStore } from '$lib/stores/data';
	import { playlists, getPlaylists, createPlaylist, deletePlaylist } from '$lib/stores/playlist';
	import { goto } from '$app/navigation';
	import ContextMenu from './ContextMenu.svelte';
	import Modal from './Modal.svelte';
	import Input from './Input.svelte';

	let editPlaylistModal = $state({
		open: false,
		playlist: null
	});

	async function getPlaylist() {
		let playlist_list = await getPlaylists($keyStore.access_token);

		const downloadedSongsPlaylist = {
			id: -1,
			title: 'Downloaded Songs',
			description: 'Your offline music collection',
			image_path: null,
			song_amount: Object.keys($mapDataStore).length, // This could be updated dynamically if needed
			created_at: null,
			updated_at: null,
			public: false
		};

		// Add the Downloaded Songs playlist at the beginning of the list
		$playlists = [downloadedSongsPlaylist, ...playlist_list];
		console.log($playlists);
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
			created_by: $user?.stosufy_id,
			isLoading: true // Flag to show loading state if needed
		};

		// Add dummy playlist to the list (after the Downloaded Songs playlist)
		$playlists = [$playlists[0], dummyPlaylist, ...$playlists.slice(1)];
		const newPlaylist = await createPlaylist(`My Playlist Nr.${amount}`);
		$playlists = $playlists.map((playlist) => (playlist.id === tempId ? newPlaylist : playlist));
	}

	async function deleteClickedPlaylist(playlistId) {
		$playlists = $playlists.filter((playlist) => playlist.id !== playlistId);
		await deletePlaylist(playlistId);
	}

	$effect(async () => {
		if ($user?.id) {
			await getPlaylist();
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

	<!-- Playlist List -->
	<ul class="overflow-y-auto flex flex-col gap-2 pl-2">
		{#each $playlists as playlist}
			<ContextMenu disabled={playlist.id == -1 ? true : false}>
				<button
					on:click={() => {
						console.log(playlist.id);
						goto(`/playlist/${playlist?.id}`);
					}}
					class="group flex items-center p-2 rounded-md hover:bg-secondary-200 w-full cursor-pointer transition duration-100"
				>
					<div class="w-12 h-12 mr-3 flex-shrink-0">
						<div class="relative">
							<img
								src={playlist.id !== -1 ? getImageUrl(playlist.image_path) : '/NoLetterLogo.png'}
								alt={playlist.title}
								class="w-full h-full object-cover rounded-md"
							/>
							{#if playlist.id == -1}
								<span
									class="icon-[fa6-solid--circle-arrow-down] text-secondary-600 absolute size-6 top-3.5 left-3"
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
	<div class="flex gap-2 items-center">
		<button class="relative w-48 flex items-center group">
			<div
				class="absolute w-full h-full rounded bg-secondary-100/50 opacity-0 group-hover:opacity-100 cursor-pointer z-10"
			></div>

			<span
				class="icon-[fa6-solid--pen] absolute opacity-0 group-hover:opacity-100 text-secondary-600 size-6 left-1/2 cursor-pointer top-1/2 -translate-x-1/2 -translate-y-1/2 z-20"
			></span>

			<!-- Image -->
			<img
				class=" bg-secondary-300/30 rounded cursor-pointer w-full"
				src={getImageUrl(editPlaylistModal.playlist?.image_path)}
				alt="Playlist cover"
			/>
		</button>
		<div class="flex flex-col gap-2 w-full">
			<div>
				<h3 class="font-semibold">Playlist Title</h3>
				<Input
					value={editPlaylistModal?.playlist?.title}
					type="text"
					placeholder="Playlist Title"
				/>
			</div>
			<div>
				<h3 class="font-semibold">Playlist Description</h3>
				<Input
					value={editPlaylistModal?.playlist?.Description}
					type="text"
					placeholder="Playlist Description"
				/>
			</div>
		</div>
	</div>
</Modal>
