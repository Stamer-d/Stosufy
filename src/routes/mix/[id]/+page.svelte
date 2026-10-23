<script>
	// A mix: one of today's daily mixes, the forgotten favourites or a smart playlist
	import { page } from '$app/state';
	import { allMixes } from '#lib/stores/mixes.ts';
	import { setSongQueue, togglePlayback, songQueue, currentSong } from '#lib/stores/audio.ts';
	import { sameSong, songKey } from '#lib/tracks.ts';
	import MixCover from '#lib/components/MixCover.svelte';
	import SongCover from '#lib/components/SongCover.svelte';
	import PlayButton from '#lib/components/PlayButton.svelte';

	let id = $derived(page.params.id);
	let mix = $derived($allMixes.get(id) ?? null);
	let queueId = $derived(`mix:${id}`);
	let playingThis = $derived($songQueue.playlistId === queueId && $currentSong.isPlaying);

	let seconds = $derived(
		(mix?.songs ?? []).reduce(
			(sum, song) => sum + (Number(song.beatmaps?.[0]?.total_length) || 0),
			0
		)
	);
	const length = (s) => {
		const h = Math.floor(s / 3600);
		const m = Math.round((s % 3600) / 60);
		return h ? `${h} h ${m} min` : `${m} min`;
	};
	const time = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

	function play(index = 0) {
		if (!mix) return;
		setSongQueue(index, mix.songs, 'playlist', queueId);
	}
	function playAll() {
		if ($songQueue.playlistId === queueId) togglePlayback();
		else play(0);
	}
	function shuffle() {
		if (!mix) return;
		const songs = [...mix.songs];
		for (let i = songs.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[songs[i], songs[j]] = [songs[j], songs[i]];
		}
		setSongQueue(0, songs, 'playlist', queueId);
	}
	const isCurrent = (song) =>
		$songQueue.playlistId === queueId && sameSong($currentSong.song, song);
</script>

{#if mix}
	<div class="pb-12">
		<header
			class="flex items-end gap-6 px-8 pt-10 pb-6 bg-gradient-to-b from-primary-400/40 to-transparent"
		>
			<MixCover songs={mix.songs} class="size-48 shrink-0 rounded-lg shadow-2xl shadow-black/50" />
			<div class="min-w-0">
				<p class="text-sm font-bold uppercase tracking-wide text-white/70">Made for you</p>
				<h1 class="text-5xl font-extrabold tracking-tight truncate">{mix.title}</h1>
				<p class="mt-2 text-white/80">{mix.description}</p>
				<p class="mt-1 text-sm text-secondary-600">
					{mix.songs.length} songs{seconds ? ` · ${length(seconds)}` : ''}
				</p>
			</div>
		</header>

		<div class="px-8 flex items-center gap-4 mb-4">
			<PlayButton
				playing={playingThis}
				label={playingThis ? 'Pause' : `Play ${mix.title}`}
				onclick={playAll}
			/>
			<button
				title="Shuffle"
				aria-label="Play {mix.title} shuffled"
				class="size-10 grid place-items-center rounded-full text-secondary-600 hover:text-white cursor-pointer transition"
				onclick={shuffle}
			>
				<span class="icon-[mingcute--shuffle-2-line] size-6"></span>
			</button>
		</div>

		<ol class="px-6">
			{#each mix.songs as song, i (songKey(song))}
				{@const current = isCurrent(song)}
				<li>
					<button
						class="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-start hover:bg-white/5 cursor-pointer transition"
						onclick={() => (current ? togglePlayback() : play(i))}
						title="Play {song.title}"
					>
						<span class="w-6 text-end text-sm text-secondary-600 tabular-nums">
							{#if current && $currentSong.isPlaying}
								<span class="icon-[svg-spinners--bars-scale-middle] size-4 text-primary-500"></span>
							{:else}
								{i + 1}
							{/if}
						</span>
						<SongCover
							setId={song.id}
							track={song.track}
							title={song.title}
							class="size-10 rounded"
							lazy
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-semibold {current ? 'text-primary-400' : ''}"
								>{song.title}</span
							>
							<span class="block truncate text-sm text-secondary-600">{song.artist}</span>
						</span>
						<span class="text-sm text-secondary-600 tabular-nums">
							{time(Number(song.beatmaps?.[0]?.total_length))}
						</span>
					</button>
				</li>
			{/each}
		</ol>
	</div>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--music-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This mix isn't here anymore</p>
		<p class="text-secondary-600 max-w-md">
			The daily mixes are made new every day. Find today's on the home page.
		</p>
		<a href="/home" class="mt-2 text-sm font-semibold hover:underline">Go home</a>
	</div>
{/if}
