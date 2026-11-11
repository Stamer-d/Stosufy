<script>
	// Choosing the song for a Dash level: what's playing now (the queue), the recently played and
	// the downloaded songs, with a search and how far you got in each. ↑ ↓ to go through them,
	// Enter to take one (see DashView)
	import { tick, untrack } from 'svelte';
	import { currentSong, setSongQueue, songQueue } from '#lib/stores/audio.ts';
	import { downloadedLibrary } from '#lib/stores/data.ts';
	import { recentlyPlayed } from '#lib/stores/mixes.ts';
	import { sameSong } from '#lib/tracks.ts';
	import { bestOfSet } from '#lib/addons/dash/game.ts';
	import SongCover from '../../../components/SongCover.svelte';

	/** @type {{ difficulty: import("#lib/addons/dash/generate.ts").Difficulty, mark?: string }} */
	let { difficulty, mark = '' } = $props();

	let queue = $derived($songQueue.queue ?? []);
	let tab = $state(($songQueue.queue?.length ?? 0) > 1 ? 'queue' : 'recent');
	let query = $state('');
	/** How many rows show (more as it scrolls) */
	let shown = $state(60);
	/** The row ↑ ↓ are on */
	let selected = $state(-1);
	let list = $state();
	let search = $state();

	const TABS = [
		['queue', 'Playing'],
		['recent', 'Recent'],
		['downloaded', 'Downloaded']
	];

	let source = $derived(
		tab === 'queue' ? queue : tab === 'recent' ? $recentlyPlayed : $downloadedLibrary
	);
	let filtered = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const songs = tab === 'downloaded' ? [...source].reverse() : source;
		if (!words.length) return songs;
		return songs.filter((song) => {
			const text = `${song.title} ${song.artist} ${song.creator ?? ''}`.toLowerCase();
			return words.every((w) => text.includes(w));
		});
	});
	let currentIndex = $derived(filtered.findIndex((s) => sameSong(s, $currentSong.song)));

	// A new list: on the song that plays (in view)
	$effect(() => {
		void tab;
		void query;
		shown = 60;
	});
	$effect(() => {
		const index = currentIndex;
		selected = index;
		if (index >= 0) untrack(() => reveal(index));
	});

	async function reveal(index) {
		if (index >= shown) shown = index + 30;
		await tick();
		list?.querySelector(`[data-row="${index}"]`)?.scrollIntoView({ block: 'nearest' });
	}

	function pick(song) {
		if (tab === 'queue') {
			const index = queue.findIndex((s) => sameSong(s, song));
			setSongQueue(index, queue, $songQueue.type ?? 'playlist', $songQueue.playlistId ?? null);
			return;
		}
		setSongQueue(
			filtered.findIndex((s) => sameSong(s, song)),
			filtered,
			'playlist',
			tab === 'downloaded' ? -1 : 'mix:recent'
		);
	}

	function random() {
		const songs = filtered.length ? filtered : $downloadedLibrary;
		if (!songs.length) return;
		pick(songs[Math.floor(Math.random() * songs.length)]);
	}

	/** ↑ ↓: the row before or after */
	export function move(by) {
		if (!filtered.length) return;
		selected = Math.max(
			0,
			Math.min(filtered.length - 1, (selected < 0 ? currentIndex : selected) + by)
		);
		reveal(selected);
	}

	/** Enter: takes the chosen row's song; false when that's the one playing already */
	export function choose() {
		const song = filtered[selected];
		if (!song || sameSong(song, $currentSong.song)) return false;
		pick(song);
		return true;
	}

	/** The song after the one playing (in this list); false when there's none */
	export function next() {
		if (filtered.length < 2 && currentIndex >= 0) return false;
		if (!filtered.length) return false;
		pick(filtered[(currentIndex + 1) % filtered.length]);
		return true;
	}

	export function focusSearch() {
		search?.focus();
	}

	const best = (song) => bestOfSet(song.id, difficulty, mark).normal;
</script>

<div
	class="size-full flex flex-col rounded-3xl bg-black/55 backdrop-blur-xl ring-1 ring-white/12 shadow-2xl overflow-hidden"
>
	<div class="p-3 flex flex-col gap-2 border-b border-white/10">
		<div class="flex items-center gap-1 p-1 rounded-xl bg-white/5">
			{#each TABS as [id, label] (id)}
				{#if id !== 'queue' || queue.length > 1}
					<button
						class="flex-1 h-8 rounded-lg text-sm font-semibold cursor-pointer transition {tab === id
							? 'bg-white/15 text-white'
							: 'text-white/55 hover:text-white'}"
						aria-pressed={tab === id}
						onclick={() => (tab = id)}>{label}</button
					>
				{/if}
			{/each}
			<button
				class="grid place-items-center size-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
				title="A random song"
				aria-label="A random song"
				onclick={random}
			>
				<span class="icon-[mingcute--shuffle-line] size-4"></span>
			</button>
		</div>
		<label
			class="flex items-center gap-2 h-9 px-3 rounded-xl bg-white/5 focus-within:ring-1 focus-within:ring-white/30"
		>
			<span class="icon-[mingcute--search-line] size-4 text-white/45"></span>
			<input
				bind:this={search}
				class="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-white/35"
				placeholder="Search your songs"
				bind:value={query}
				onkeydown={(e) => {
					// (out of the search with ↓ or Esc, back to the list)
					if (e.key === 'ArrowDown' || e.key === 'Escape') e.currentTarget.blur();
				}}
			/>
		</label>
	</div>
	<div
		bind:this={list}
		class="flex-1 overflow-y-auto p-1.5"
		onscroll={(e) => {
			const el = e.currentTarget;
			if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) shown += 60;
		}}
	>
		{#if !filtered.length}
			<p class="py-10 text-center text-sm text-white/45">
				{query
					? 'No song matches.'
					: tab === 'recent'
						? 'Nothing played yet.'
						: tab === 'queue'
							? 'Nothing in the queue.'
							: 'No downloaded songs yet.'}
			</p>
		{/if}
		{#each filtered.slice(0, shown) as song, i (`${song.id}:${song.track ?? 0}`)}
			{@const current = i === currentIndex}
			{@const progress = best(song)}
			<button
				data-row={i}
				class="w-full flex items-center gap-3 p-1.5 rounded-xl text-left cursor-pointer transition {current
					? 'bg-white/15'
					: i === selected
						? 'bg-white/[0.09] ring-1 ring-white/25'
						: 'hover:bg-white/[0.07]'}"
				onclick={() => !current && pick(song)}
			>
				<SongCover
					setId={song.id}
					track={song.track ?? 0}
					title={song.title}
					class="size-10 rounded-lg shrink-0"
					lazy
				/>
				<span class="flex-1 min-w-0">
					<span class="block text-sm font-semibold truncate">{song.title}</span>
					<span class="block text-xs text-white/50 truncate">{song.artist}</span>
				</span>
				{#if progress >= 100}
					<span
						class="icon-[mingcute--check-circle-fill] size-5 shrink-0 text-lime-300"
						title="Done"
					></span>
				{:else if progress > 0}
					<span class="shrink-0 flex flex-col items-end gap-1" title="Your best at this difficulty">
						<span class="text-xs font-bold tabular-nums text-white/60">{Math.floor(progress)}%</span
						>
						<span class="block w-10 h-1 rounded-full bg-white/10 overflow-hidden">
							<span class="block h-full bg-white/60" style="width: {progress}%"></span>
						</span>
					</span>
				{/if}
				{#if current}
					<span class="flex items-end gap-0.5 h-4 shrink-0" aria-label="Playing">
						{#each [0, 1, 2] as k (k)}
							<span class="bar w-0.5 rounded-full bg-white/80" style="animation-delay: {k * 0.18}s"
							></span>
						{/each}
					</span>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.bar {
		height: 100%;
		transform-origin: bottom;
		animation: bar 0.9s ease-in-out infinite;
	}
	@keyframes bar {
		0%,
		100% {
			transform: scaleY(0.3);
		}
		50% {
			transform: scaleY(1);
		}
	}
</style>
