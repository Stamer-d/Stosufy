<script>
	// A list of songs to play as one (a mix, a smart playlist): its cover, title, play and
	// shuffle, and the songs
	import { setSongQueue, togglePlayback, songQueue, currentSong } from '#lib/stores/audio.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { sameSong, songKey, songsLength } from '#lib/tracks.ts';
	import MixCover from './MixCover.svelte';
	import SongCover from './SongCover.svelte';
	import PlayButton from './PlayButton.svelte';

	/**
	 * `queueId`: the queue's playlist id while it plays (to show it as playing).
	 * `heading`, `actions` and `children` (between the buttons and the songs) are its own, and
	 * `row` the buttons at the end of a song's row.
	 * @type {{
	 *   songs: import('#lib/types.ts').MapSet[],
	 *   queueId: string,
	 *   label: string,
	 *   title: string,
	 *   description?: string,
	 *   heading?: import('svelte').Snippet,
	 *   actions?: import('svelte').Snippet,
	 *   children?: import('svelte').Snippet,
	 *   row?: import('svelte').Snippet<[import('#lib/types.ts').MapSet, number]>,
	 *   empty?: import('svelte').Snippet
	 * }}
	 */
	let {
		songs,
		queueId,
		label,
		title,
		description = '',
		heading,
		actions,
		children,
		row,
		empty
	} = $props();

	let playingThis = $derived($songQueue.playlistId === queueId && $currentSong.isPlaying);
	let length = $derived(songsLength(songs));
	const time = (s) =>
		s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

	const play = (index = 0, list = songs) => setSongQueue(index, list, 'playlist', queueId);
	function playAll() {
		if ($songQueue.playlistId === queueId) togglePlayback();
		else play(0);
	}
	function shuffle() {
		const list = [...songs];
		for (let i = list.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[list[i], list[j]] = [list[j], list[i]];
		}
		play(0, list);
	}
	const isCurrent = (song) =>
		$songQueue.playlistId === queueId && sameSong($currentSong.song, song);
</script>

<div class="pb-12">
	<header
		class="flex items-end gap-6 px-8 pt-10 pb-6 bg-gradient-to-b from-primary-400/40 to-transparent"
	>
		{#if songs.length}
			<MixCover {songs} class="size-48 shrink-0 rounded-lg shadow-2xl shadow-black/50" />
		{:else}
			<div
				class="size-48 shrink-0 grid place-items-center rounded-lg bg-gradient-to-br from-primary-300 to-primary-700 shadow-2xl shadow-black/50"
			>
				<span class="icon-[mingcute--magic-2-line] size-20 text-white/80"></span>
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<p class="text-sm font-bold uppercase tracking-wide text-white/70">{label}</p>
			{#if heading}
				{@render heading()}
			{:else}
				<h1 class="text-5xl font-extrabold tracking-tight truncate">{title}</h1>
			{/if}
			{#if description}
				<p class="mt-2 text-white/80">{description}</p>
			{/if}
			<p class="mt-1 text-sm text-secondary-600">
				{songs.length}
				{songs.length === 1 ? 'song' : 'songs'}{length ? ` · ${length}` : ''}
			</p>
		</div>
	</header>

	<div class="px-8 flex items-center gap-4 mb-4">
		<PlayButton
			playing={playingThis}
			disabled={!songs.length}
			label={playingThis ? 'Pause' : `Play ${title}`}
			onclick={playAll}
		/>
		<button
			title="Shuffle"
			aria-label="Play {title} shuffled"
			disabled={!songs.length}
			class="size-10 grid place-items-center rounded-full text-secondary-600 hover:text-white cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
			onclick={shuffle}
		>
			<span class="icon-[mingcute--shuffle-2-line] size-6"></span>
		</button>
		{@render actions?.()}
	</div>

	{@render children?.()}

	{#if songs.length}
		<ol class="px-6">
			{#each songs as song, i (songKey(song))}
				{@const current = isCurrent(song)}
				<li class="group flex items-center gap-1 rounded-md hover:bg-white/5 transition">
					<button
						class="min-w-0 flex-1 flex items-center gap-3 px-2 py-1.5 text-start cursor-pointer"
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
						{#if !$mapDataStore[song.id]}
							<span
								class="icon-[mingcute--cloud-line] size-4 shrink-0 text-secondary-600"
								title="Not downloaded: it streams from osu!"
							></span>
						{/if}
						<span class="text-sm text-secondary-600 tabular-nums">
							{time(Number(song.beatmaps?.[0]?.total_length))}
						</span>
					</button>
					{@render row?.(song, i)}
				</li>
			{/each}
		</ol>
	{:else}
		{@render empty?.()}
	{/if}
</div>
