<script>
	// Choosing the song for a Dash level: the recently played and the downloaded songs, with a
	// search, and how far you got in each
	import { currentSong, setSongQueue } from '#lib/stores/audio.ts';
	import { downloadedLibrary } from '#lib/stores/data.ts';
	import { recentlyPlayed } from '#lib/stores/mixes.ts';
	import { sameSong } from '#lib/tracks.ts';
	import { chosenMapId } from '#lib/gameplay/play.ts';
	import { bestKey, bestOf } from '#lib/dash/game.ts';
	import SongCover from '../SongCover.svelte';

	/** @type {{ difficulty: import("#lib/dash/generate.ts").Difficulty }} */
	let { difficulty } = $props();

	let tab = $state('recent');
	let query = $state('');
	/** How many rows show (more as it scrolls) */
	let shown = $state(60);

	let source = $derived(tab === 'recent' ? $recentlyPlayed : $downloadedLibrary);
	let filtered = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const list = tab === 'downloaded' ? [...source].reverse() : source;
		if (!words.length) return list;
		return list.filter((song) => {
			const text = `${song.title} ${song.artist} ${song.creator ?? ''}`.toLowerCase();
			return words.every((w) => text.includes(w));
		});
	});

	$effect(() => {
		void tab;
		void query;
		shown = 60;
	});

	function pick(song) {
		const list = filtered;
		setSongQueue(
			list.findIndex((s) => sameSong(s, song)),
			list,
			'playlist',
			tab === 'downloaded' ? -1 : 'mix:recent'
		);
	}

	function random() {
		const list = filtered.length ? filtered : $downloadedLibrary;
		if (!list.length) return;
		pick(list[Math.floor(Math.random() * list.length)]);
	}

	const best = (song) => bestOf(bestKey(`${song.id}:${chosenMapId(song)}`, difficulty)).normal;
</script>

<div
	class="w-[min(22rem,100%)] h-[min(34rem,70vh)] flex flex-col rounded-3xl bg-black/60 backdrop-blur-xl ring-1 ring-white/15 shadow-2xl overflow-hidden"
>
	<div class="p-3 flex flex-col gap-2 border-b border-white/10">
		<div class="flex items-center gap-1 p-1 rounded-xl bg-white/5">
			{#each [['recent', 'Recent'], ['downloaded', 'Downloaded']] as [id, label] (id)}
				<button
					class="flex-1 h-8 rounded-lg text-sm font-semibold cursor-pointer transition {tab === id
						? 'bg-white/15 text-white'
						: 'text-white/55 hover:text-white'}"
					aria-pressed={tab === id}
					onclick={() => (tab = id)}>{label}</button
				>
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
				class="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-white/35"
				placeholder="Search your songs"
				bind:value={query}
			/>
		</label>
	</div>
	<div
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
						: 'No downloaded songs yet.'}
			</p>
		{/if}
		{#each filtered.slice(0, shown) as song (`${song.id}:${song.track ?? 0}`)}
			{@const current = sameSong(song, $currentSong.song)}
			{@const progress = best(song)}
			<button
				class="w-full flex items-center gap-3 p-1.5 rounded-xl text-left cursor-pointer transition {current
					? 'bg-white/15'
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
					<span class="shrink-0 text-xs font-bold text-white/60">{Math.floor(progress)}%</span>
				{/if}
				{#if current}
					<span class="icon-[mingcute--volume-line] size-4 shrink-0 text-white/70"></span>
				{/if}
			</button>
		{/each}
	</div>
</div>
