<script>
	// The songs to mix: downloads, liked songs or a playlist (only downloaded songs can be
	// mixed). Drag one onto a deck or load it with A / B; the list shows how well each fits
	// the song that plays. Auto DJ mixes through the list.
	import SongCover from '../SongCover.svelte';
	import Select from '../Select.svelte';
	import { mapDataStore, formatSongData, isSongDownloaded } from '#lib/stores/data.ts';
	import { playlists, playlistSongsCache, getPlaylistSongs } from '#lib/stores/playlist.ts';
	import { matchesQuery } from '#lib/stores/search.ts';
	import { songBpm, songKeyOf, setDragged } from '#lib/dj/library.ts';

	let { mixer, state: mix, colors } = $props();

	let source = $state('downloaded');
	let filter = $state('');
	let shuffle = $state(false);
	let sort = $state('match');

	$effect(() => {
		if (source !== 'downloaded') getPlaylistSongs(source);
	});

	let sources = $derived([
		{ value: 'downloaded', label: 'Downloaded Songs', icon: 'icon-[mingcute--download-2-line]' },
		...$playlists
			.filter((p) => p.id != -1)
			.map((p) => ({
				value: String(p.id),
				label: p.title,
				icon: p.id == -2 ? 'icon-[mingcute--heart-line]' : 'icon-[mingcute--playlist-line]'
			}))
	]);

	/** The tempo the next song should fit: the playing deck's */
	let leadBpm = $derived.by(() => {
		void mix.A.playing;
		void mix.B.playing;
		void mix.crossfader;
		const lead = mixer.leading();
		return lead ? lead.bpm() : 0;
	});

	/** How far a song's tempo is from the playing one (also at double or half) */
	function distance(song) {
		const bpm = songBpm(song, $mapDataStore);
		if (!leadBpm || !bpm) return null;
		return Math.min(...[1, 2, 0.5].map((f) => Math.abs((leadBpm * f) / bpm - 1)));
	}
	const fitOf = (d) =>
		d == null ? null : d <= 0.03 ? 'perfect' : d <= 0.07 ? 'good' : d <= 0.15 ? 'tricky' : 'clash';
	const FIT = {
		perfect: { label: 'Perfect', class: 'bg-green-400/20 text-green-300' },
		good: { label: 'Good', class: 'bg-lime-400/15 text-lime-300' },
		tricky: { label: 'Tricky', class: 'bg-amber-400/15 text-amber-300' },
		clash: { label: 'Echo out', class: 'bg-white/10 text-white/50' }
	};

	let songs = $derived.by(() => {
		const all =
			source === 'downloaded'
				? formatSongData($mapDataStore)
				: ($playlistSongsCache[source]?.songs ?? []).filter((song) => isSongDownloaded(song.id));
		const shown = filter.trim() ? all.filter((song) => matchesQuery(song, filter)) : all;
		if (sort === 'bpm')
			return [...shown].sort((a, b) => songBpm(a, $mapDataStore) - songBpm(b, $mapDataStore));
		if (sort === 'match' && leadBpm)
			return [...shown].sort((a, b) => (distance(a) ?? 9) - (distance(b) ?? 9));
		return shown;
	});

	const length = (song) => {
		const s = Number(song.beatmaps?.[0]?.total_length);
		return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
	};

	/** The deck that's free: not playing, the quieter one */
	function freeDeck() {
		const { A, B } = mix;
		if (!A.song) return 'A';
		if (!B.song) return 'B';
		if (A.playing && !B.playing) return 'B';
		if (B.playing && !A.playing) return 'A';
		return mix.crossfader <= 0.5 ? 'B' : 'A';
	}

	function load(song, deck = freeDeck()) {
		if (
			mixer.decks[deck].state.playing &&
			!confirm(`Deck ${deck} is playing. Load "${song.title}" anyway?`)
		)
			return;
		mixer.decks[deck].userLoad(song);
	}

	function toggleAuto() {
		if (mix.auto.on) {
			mixer.stopAuto();
			return;
		}
		let queue = [...songs];
		if (shuffle) {
			for (let i = queue.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[queue[i], queue[j]] = [queue[j], queue[i]];
			}
		}
		if (queue.length) mixer.startAuto(queue, source);
	}

	let nextUp = $derived.by(() => {
		if (!mix.auto.on || !mix.auto.queue.length) return null;
		const lead =
			mix.A.playing && !mix.B.playing ? 'B' : mix.B.playing && !mix.A.playing ? 'A' : null;
		const picked = lead && mixer.decks[lead].pickedByUser ? mix[lead].song : null;
		return picked ?? mix.auto.queue[(mix.auto.index + 1) % mix.auto.queue.length];
	});
</script>

<section
	class="flex-1 min-h-[280px] flex flex-col rounded-xl bg-white/[0.035] ring-1 ring-white/[0.06]"
>
	<div class="flex flex-wrap items-center gap-2 p-2 border-b border-white/10">
		<Select
			label="Songs"
			icon="icon-[mingcute--music-2-line]"
			options={sources}
			value={source}
			onchange={(v) => (source = v)}
		/>
		<div class="relative flex items-center">
			<span
				class="icon-[mingcute--search-line] absolute left-2.5 size-4 text-white/40 pointer-events-none"
			></span>
			<input
				type="search"
				bind:value={filter}
				placeholder="Search"
				aria-label="Search songs"
				class="w-48 h-9 pl-8 pr-2 rounded-full bg-white/[0.06] ring-1 ring-white/10 text-sm text-white placeholder:text-white/40 outline-none"
			/>
		</div>
		<Select
			label="Sort"
			icon="icon-[mingcute--sort-descending-line]"
			options={[
				{ value: 'match', label: 'Best match' },
				{ value: 'bpm', label: 'BPM' },
				{ value: 'list', label: 'List order' }
			]}
			value={sort}
			onchange={(v) => (sort = v)}
		/>
		<span class="text-xs text-white/40">{songs.length} songs · drag one onto a deck</span>

		<div class="ml-auto flex items-center gap-2">
			{#if nextUp}
				<span class="text-xs text-white/50 truncate max-w-64">Next: {nextUp.title}</span>
			{/if}
			<label class="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
				<input type="checkbox" bind:checked={shuffle} class="accent-violet-400" /> Shuffle
			</label>
			<button
				title="Auto DJ mixes through this list by itself. Songs you put on the free deck play next."
				aria-pressed={mix.auto.on}
				disabled={!songs.length && !mix.auto.on}
				class="h-9 px-3 rounded-full text-xs font-black cursor-pointer ring-1 transition disabled:opacity-40 {mix
					.auto.on
					? 'bg-violet-400 text-black ring-violet-200'
					: 'bg-white/[0.06] ring-white/10 text-white hover:bg-white/15'}"
				onclick={toggleAuto}
			>
				<span class="icon-[mingcute--magic-2-line] size-4 align-[-3px] mr-1"></span>
				{mix.auto.on ? 'AUTO DJ ON' : 'AUTO DJ'}
			</button>
		</div>
	</div>

	<div class="flex-1 min-h-0 overflow-y-auto rounded-b-xl">
		{#each songs.slice(0, 400) as song (songKeyOf(song))}
			{@const onA = mix.A.song?.id === song.id}
			{@const onB = mix.B.song?.id === song.id}
			{@const fit = fitOf(distance(song))}
			<div
				role="button"
				tabindex="0"
				draggable="true"
				class="group grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_3.5rem_3rem_auto] items-center gap-3 px-3 h-11 hover:bg-white/[0.05] cursor-grab active:cursor-grabbing"
				ondragstart={(e) => {
					setDragged(song);
					e.dataTransfer.effectAllowed = 'copy';
					e.dataTransfer.setData('text/plain', song.title);
				}}
				ondragend={() => setDragged(null)}
				ondblclick={() => load(song)}
				onkeydown={(e) => e.key === 'Enter' && load(song)}
			>
				<SongCover
					setId={song.id}
					track={song.track}
					title={song.title}
					class="size-8 rounded pointer-events-none"
					lazy
				/>
				<div class="min-w-0">
					<p class="text-sm font-semibold truncate">{song.title}</p>
					<p class="text-xs text-white/50 truncate">{song.artist}</p>
				</div>
				<span class="justify-self-end">
					{#if fit}
						<span class="px-1.5 py-0.5 rounded text-[10px] font-bold {FIT[fit].class}"
							>{FIT[fit].label}</span
						>
					{/if}
				</span>
				<span class="text-sm font-bold tabular-nums text-white/70 text-right"
					>{songBpm(song, $mapDataStore) || ''}</span
				>
				<span class="text-xs tabular-nums text-white/40 text-right">{length(song)}</span>
				<div class="flex gap-1">
					{#each ['A', 'B'] as deck (deck)}
						<button
							title="Load on deck {deck}"
							aria-label="Load {song.title} on deck {deck}"
							class="h-7 w-8 rounded-md text-xs font-black cursor-pointer transition ring-1 {(
								deck === 'A' ? onA : onB
							)
								? 'text-black ring-transparent'
								: 'bg-white/[0.06] ring-white/10 text-white/70 hover:text-white'}"
							style={(deck === 'A' ? onA : onB) ? `background: ${colors[deck]}` : ''}
							onclick={() => load(song, deck)}>{deck}</button
						>
					{/each}
				</div>
			</div>
		{:else}
			<p class="p-6 text-center text-sm text-white/50">
				{source === 'downloaded'
					? 'Download songs to mix them.'
					: 'No downloaded songs in this playlist.'}
			</p>
		{/each}
	</div>
</section>
