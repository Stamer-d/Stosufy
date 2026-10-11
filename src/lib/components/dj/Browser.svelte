<script>
	// The songs to mix: downloads, liked songs or a playlist (only downloaded songs can be
	// mixed). Load one onto a deck, or let Auto DJ mix through the list.
	import SongCover from '../SongCover.svelte';
	import { mapDataStore, formatSongData, isSongDownloaded } from '#lib/stores/data.ts';
	import { playlists, playlistSongsCache, getPlaylistSongs } from '#lib/stores/playlist.ts';
	import { matchesQuery } from '#lib/stores/search.ts';
	import { gridFrom, mainSection, bpmOf } from '#lib/dj/grid.ts';

	let { mixer, state: mix, colors } = $props();

	let source = $state('downloaded');
	let filter = $state('');
	let shuffle = $state(false);
	let sortByBpm = $state(false);

	$effect(() => {
		if (source !== 'downloaded') getPlaylistSongs(source);
	});

	let songs = $derived.by(() => {
		const all =
			source === 'downloaded'
				? formatSongData($mapDataStore)
				: ($playlistSongsCache[source]?.songs ?? []).filter((song) => isSongDownloaded(song.id));
		const shown = filter.trim() ? all.filter((song) => matchesQuery(song, filter)) : all;
		return sortByBpm ? [...shown].sort((a, b) => bpmFor(a) - bpmFor(b)) : shown;
	});

	const bpms = new Map();
	function bpmFor(song) {
		const key = `${song.id}:${song.beatmaps?.[0]?.id}`;
		if (!bpms.has(key)) {
			const stored = $mapDataStore[song.id];
			const map =
				stored?.beatmaps?.[song.beatmaps?.[0]?.id] ?? Object.values(stored?.beatmaps ?? {})[0];
			const grid = gridFrom(map?.timing);
			const length = Number(map?.total_length) || (grid.at(-1)?.time ?? 0) + 120;
			bpms.set(key, Math.round(bpmOf(mainSection(grid, length))));
		}
		return bpms.get(key);
	}

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
		mixer.decks[deck].load(song);
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

	let nextUp = $derived(
		mix.auto.on && mix.auto.queue.length
			? mix.auto.queue[(mix.auto.index + 1) % mix.auto.queue.length]
			: null
	);
</script>

<section
	class="flex-1 min-h-[280px] flex flex-col rounded-xl bg-white/[0.035] ring-1 ring-white/[0.06] overflow-hidden"
>
	<div class="flex flex-wrap items-center gap-2 p-2 border-b border-white/10">
		<select
			bind:value={source}
			aria-label="Songs from"
			class="h-8 px-2 rounded-md bg-white/[0.06] ring-1 ring-white/10 text-sm text-white outline-none cursor-pointer"
		>
			<option value="downloaded">Downloaded Songs</option>
			{#each $playlists.filter((p) => p.id != -1) as playlist (playlist.id)}
				<option value={String(playlist.id)}>{playlist.title}</option>
			{/each}
		</select>
		<div class="relative flex items-center">
			<span
				class="icon-[mingcute--search-line] absolute left-2.5 size-4 text-white/40 pointer-events-none"
			></span>
			<input
				type="search"
				bind:value={filter}
				placeholder="Search"
				aria-label="Search songs"
				class="w-48 h-8 pl-8 pr-2 rounded-md bg-white/[0.06] ring-1 ring-white/10 text-sm text-white placeholder:text-white/40 outline-none"
			/>
		</div>
		<button
			aria-pressed={sortByBpm}
			title="Sort by tempo, for smooth mixes"
			class="h-8 px-2.5 rounded-md text-xs font-bold ring-1 cursor-pointer {sortByBpm
				? 'bg-white text-black ring-white'
				: 'bg-white/[0.06] ring-white/10 text-white/70 hover:text-white'}"
			onclick={() => (sortByBpm = !sortByBpm)}>BPM ↑</button
		>
		<span class="text-xs text-white/40">{songs.length} songs</span>

		<div class="ml-auto flex items-center gap-2">
			{#if nextUp}
				<span class="text-xs text-white/50 truncate max-w-64">Next: {nextUp.title}</span>
			{/if}
			<label class="flex items-center gap-1.5 text-xs text-white/70 cursor-pointer">
				<input type="checkbox" bind:checked={shuffle} class="accent-violet-400" /> Shuffle
			</label>
			<button
				title="Auto DJ mixes through this list by itself, with the mix set in the mixer"
				aria-pressed={mix.auto.on}
				disabled={!songs.length && !mix.auto.on}
				class="h-8 px-3 rounded-md text-xs font-black cursor-pointer ring-1 transition disabled:opacity-40 {mix
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

	<div class="flex-1 min-h-0 overflow-y-auto">
		{#each songs.slice(0, 400) as song (`${song.id}:${song.track ?? 0}`)}
			{@const onA = mix.A.song?.id === song.id}
			{@const onB = mix.B.song?.id === song.id}
			<div
				role="button"
				tabindex="0"
				class="group grid grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_3rem_auto] items-center gap-3 px-3 h-11 hover:bg-white/[0.05] cursor-default"
				ondblclick={() => load(song)}
				onkeydown={(e) => e.key === 'Enter' && load(song)}
			>
				<SongCover setId={song.id} title={song.title} class="size-8 rounded" lazy />
				<div class="min-w-0">
					<p class="text-sm font-semibold truncate">{song.title}</p>
					<p class="text-xs text-white/50 truncate">{song.artist}</p>
				</div>
				<span class="text-sm font-bold tabular-nums text-white/70 text-right"
					>{bpmFor(song) || ''}</span
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
