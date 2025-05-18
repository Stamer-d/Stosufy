<script>
	import { onMount } from 'svelte';
    import Button from '$lib/components/Button.svelte';
	import { mapDataStore, deleteSong, getImageUrl, formatSongData} from '$lib/stores/data';
	import { playlists } from '$lib/stores/playlist';
	import {
		currentSong,
		setSongQueue,
		songQueue,
		stopPlayback,
		togglePlayback,
		updateSongQueue
	} from '$lib/stores/audio';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';


	// Use reactive declarations to handle parameter changes
	$: playlistId = $page.params?.id;
	$: playlistData = $playlists.find((playlist) => playlist.id == playlistId);
	$: {
		if (playlistId == -1) {
			songs = formatSongData($mapDataStore);
		} else if (playlistData) {
			songs = [];
		}
	}

	function getDateString(timestamp) {
    // Check if timestamp is in milliseconds (13 digits) or seconds (10 digits)
    const date = timestamp.toString().length > 10 
        ? new Date(timestamp)          // Already in milliseconds
        : new Date(timestamp * 1000);  // Convert seconds to milliseconds
    
    const now = new Date();
    
    // Calculate time differences
    const diffTime = now - date;
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffMinutes < 60) {
        if (diffMinutes < 1) {
            return 'Just now';
        }
        return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    else if (diffDays < 30) {
        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else {
            const weeks = Math.floor(diffDays / 7);
            return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
        }
    } 
    else {
        const options = { day: 'numeric', month: 'long', year: 'numeric' };
        return date.toLocaleDateString('de-DE', options);
    }
}

	let songs;

	onMount(() => {
		
	});
</script>

{#if playlistData}
	<div class="flex flex-col">
		<div class="flex items-center gap-4 mb-2">
			<div class="relative ">
				<img
				src={playlistId != -1 ? getImageUrl(playlistData.image_path) : '/NoLetterLogo.png'}
				alt=""
				class="xl:size-50 size-40 bg-secondary-200 rounded-md object-cover"
			/>
			{#if playlistId == -1}
				<span class="icon-[fa6-solid--circle-arrow-down] text-secondary-600 xl:size-25 size-18 absolute xl:top-15 xl:left-12.5 top-13 left-11"></span>
			{/if}
			</div>
			
			<div class="flex xl:gap-2 gap-1 flex-col">
				<Button
					on:click={() => {
						goto('/home');
					}}>Back</Button
				>
				<div>{playlistData.public ? 'Public Playlist' : 'Private Playlist'}</div>
				<div class="xl:text-6xl text-3xl font-bold">{playlistData.title}</div>
				<div >
					{playlistData.song_amount} Song{playlistData.song_amount > 1 ? 's' : ''}
				</div>
			</div>
		</div>
		{#if songs}
			{#each songs as song, index}
				<button
					class="cursor-pointer group grid grid-cols-[40px_56px_1fr_200px_auto] items-center hover:bg-secondary-200 rounded p-2"
					on:click={async () => {
						if ($songQueue.type !== 'playlist' || $songQueue.playlistId != playlistId) {
							await setSongQueue(index, songs, 'playlist', playlistId);
							return
						} else if ($songQueue.playlistId == playlistId && $currentSong?.song?.id != song.id) {
							stopPlayback();
							await updateSongQueue(index);
							togglePlayback();
							return
						}
						if ($currentSong?.song?.id == song.id) {
							togglePlayback();
							return;
						}

					}}
				>
					<div class="relative flex justify-end mr-4">
						{#if $currentSong?.song?.id == song.id && $currentSong?.isPlaying && $songQueue.type == 'playlist'}
							<span
								class="icon-[svg-spinners--bars-scale-middle] cursor-pointer absolute size-5 top-0.5 group-hover:opacity-0 {$currentSong?.song?.id == song?.id ? "text-primary-200" : ""}"
							></span>
							<span
								class="icon-[fa6-solid--pause] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
							></span>
						{:else}
							<span
								class=" icon-[fa6-solid--play] cursor-pointer absolute size-5 top-0.5 opacity-0 group-hover:opacity-100 text-white"
							></span>
						{/if}
						<div
							class="{$currentSong?.song?.id == song.id && $currentSong?.isPlaying
								? 'opacity-0'
								: ''} {$currentSong?.song?.id == song?.id ? "text-primary-200" : ""} group-hover:opacity-0 text-start"
						>
							{index + 1}
						</div>
					</div> 
					<img
						src="https://assets.ppy.sh/beatmaps/{song.id}/covers/list.jpg"
						alt={song.title}
						class="size-14 rounded"
					/>
					<div class="flex flex-col text-start ml-4">
						<h3 class="font-semibold {$currentSong?.song?.id == song?.id ? "text-primary-200" : ""}">{song.title}</h3>
						<p class="text-sm text-secondary-600 w-auto">{song.artist}</p>
					</div>
					<div class="flex text-start">
						{getDateString(song.created_at)}
					</div>
					<div>
						<Button
							class="group-hover:opacity-100 opacity-0 duration-0"
							type="ghost"
							icon="icon-[fa6-solid--trash-can]"
							on:click={async (e) => {
								event.stopPropagation();
								await deleteSong(song.id);
							}}
						/>
					</div>
				</button>
			{/each}
		{/if}
	</div>
{/if}
