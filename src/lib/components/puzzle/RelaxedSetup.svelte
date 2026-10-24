<script>
	import { currentSong } from '#lib/stores/audio.ts';
	import { formatSongData, mapDataStore } from '#lib/stores/data.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import {
		PIECE_COUNTS,
		formatTime,
		gridFor,
		loadRelaxedSave,
		ownPicture
	} from '#lib/puzzle/puzzle.ts';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import SongCover from '#lib/components/SongCover.svelte';

	/**
	 * Setting up a relaxed puzzle: any picture (a song's background or one of your own), as many
	 * pieces as you like. A puzzle left unfinished can be picked up again.
	 * @type {{ busy?: boolean, onstart: (setup: { picture: import('#lib/puzzle/puzzle.ts').PuzzlePicture, pieces: number, ghost: boolean, outlines: boolean }) => void, onresume: (save: import('#lib/puzzle/puzzle.ts').RelaxedSave) => void }}
	 */
	let { busy = false, onstart, onresume } = $props();

	const SETTINGS_KEY = 'puzzleRelaxedSettings';
	let options = $state(readOptions());
	function readOptions() {
		const fallback = { pieces: 100, ghost: false, outlines: true };
		try {
			return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
		} catch {
			return fallback;
		}
	}
	$effect(() => {
		const saved = JSON.stringify(options);
		try {
			localStorage.setItem(SETTINGS_KEY, saved);
		} catch {
			// (not remembered)
		}
	});

	const save = loadRelaxedSave();
	let savedDone = $derived(save ? save.pieces.filter((piece) => piece.placed).length : 0);

	let library = $derived(formatSongData($mapDataStore));
	/** @type {import('#lib/puzzle/puzzle.ts').PuzzlePicture | null} */
	let picture = $state(null);
	const fromSong = (song) => ({
		setId: song.id,
		mapId: song.beatmaps?.[0]?.id ?? null,
		title: song.title ?? '',
		artist: song.artist ?? ''
	});
	// The song playing, else a random one once the library is there
	$effect(() => {
		if (picture) return;
		const song =
			$currentSong.song ??
			(library.length ? library[Math.floor(Math.random() * library.length)] : null);
		if (song) picture = fromSong(song);
	});

	let query = $state('');
	let shown = $state(48);
	let matches = $derived.by(() => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		const songs = words.length
			? library.filter((song) => {
					const text = [song.title, song.artist, song.songSource, song.creator, song.tags]
						.join(' ')
						.toLowerCase();
					return words.every((word) => text.includes(word));
				})
			: [...library].reverse();
		// One picture per set
		const seen = new Set();
		return songs.filter((song) => !seen.has(song.id) && seen.add(song.id));
	});

	let fileInput = $state();
	async function pickOwn(event) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		try {
			const own = await ownPicture(file);
			picture = { title: file.name.replace(/\.[^.]+$/, ''), image: own.url };
		} catch (error) {
			console.error('Could not read the picture:', error);
			showToast("Couldn't open this picture", 'icon-[mingcute--pic-line]');
		}
	}

	const isPicked = (song) => picture?.setId != null && picture.setId == song.id;
	const actualCount = (pieces) => {
		const { cols, rows } = gridFor(pieces, 16 / 9);
		return cols * rows;
	};
</script>

<div class="flex flex-col gap-8">
	{#if save}
		<!-- The puzzle left unfinished -->
		<section class="relative h-40 rounded-xl overflow-hidden">
			{#if save.picture.image}
				<img src={save.picture.image} alt="" class="absolute inset-0 size-full object-cover" />
			{:else}
				<BeatmapBackground
					setId={save.picture.setId}
					mapId={save.picture.mapId}
					title={save.picture.title}
					class="absolute inset-0"
				/>
			{/if}
			<div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10"></div>
			<div class="relative h-full flex items-end justify-between gap-6 p-6">
				<div class="min-w-0">
					<p class="text-xs font-bold uppercase tracking-wide text-primary-400">Keep going</p>
					<p class="mt-1 text-2xl font-extrabold leading-tight truncate">{save.picture.title}</p>
					<p class="text-sm text-white/75">
						{savedDone} of {save.pieces.length} pieces in place · {formatTime(save.time)}
					</p>
				</div>
				<button
					class="shrink-0 flex items-center gap-2 px-5 h-11 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition shadow-lg shadow-black/40 disabled:opacity-50"
					disabled={busy}
					onclick={() => onresume(save)}
				>
					<span class="icon-[mingcute--play-fill] size-5"></span>
					Go on
				</button>
			</div>
		</section>
	{/if}

	<section class="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
		<!-- The picture -->
		<div class="flex flex-col gap-3 min-w-0">
			<h2 class="text-xl font-bold">The picture</h2>
			<div class="flex flex-wrap gap-2">
				<button
					class="flex items-center gap-2 px-4 h-9 rounded-full bg-secondary-200 hover:bg-secondary-300 text-sm font-semibold cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
					disabled={!$currentSong.song}
					onclick={() => (picture = fromSong($currentSong.song))}
				>
					<span class="icon-[mingcute--music-2-line] size-4"></span>Now playing
				</button>
				<button
					class="flex items-center gap-2 px-4 h-9 rounded-full bg-secondary-200 hover:bg-secondary-300 text-sm font-semibold cursor-pointer transition disabled:opacity-40 disabled:pointer-events-none"
					disabled={!library.length}
					onclick={() => (picture = fromSong(library[Math.floor(Math.random() * library.length)]))}
				>
					<span class="icon-[mingcute--shuffle-2-line] size-4"></span>Surprise me
				</button>
				<button
					class="flex items-center gap-2 px-4 h-9 rounded-full bg-secondary-200 hover:bg-secondary-300 text-sm font-semibold cursor-pointer transition"
					onclick={() => fileInput?.click()}
				>
					<span class="icon-[mingcute--pic-line] size-4"></span>Your own picture
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={pickOwn}
				/>
			</div>
			<div class="relative">
				<span
					class="absolute left-3 top-1/2 -translate-y-1/2 icon-[mingcute--search-line] size-4 text-secondary-600"
				></span>
				<input
					bind:value={query}
					oninput={() => (shown = 48)}
					placeholder="Search your songs: title, artist, anime…"
					class="w-full h-10 pl-9 pr-3 rounded-lg bg-secondary-200 ring-1 ring-white/5 focus:ring-primary-400 outline-none text-sm"
				/>
			</div>
			{#if matches.length}
				<div
					class="max-h-[22rem] overflow-y-auto pr-1 grid gap-2 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]"
				>
					{#each matches.slice(0, shown) as song (song.id)}
						<button
							class="group relative aspect-square rounded-lg overflow-hidden cursor-pointer ring-2 transition {isPicked(
								song
							)
								? 'ring-primary-400'
								: 'ring-transparent hover:ring-white/30'}"
							title="{song.title} – {song.artist}"
							onclick={() => (picture = fromSong(song))}
						>
							<SongCover
								setId={song.id}
								track={song.track}
								title={song.title}
								class="size-full"
								lazy
							/>
							{#if isPicked(song)}
								<span
									class="absolute top-1 right-1 grid place-items-center size-5 rounded-full bg-primary-400"
								>
									<span class="icon-[mingcute--check-line] size-3.5"></span>
								</span>
							{/if}
						</button>
					{/each}
					{#if matches.length > shown}
						<button
							class="aspect-square rounded-lg bg-secondary-200 hover:bg-secondary-300 text-xs font-semibold text-secondary-600 cursor-pointer transition"
							onclick={() => (shown += 96)}>{matches.length - shown} more</button
						>
					{/if}
				</div>
			{:else if library.length}
				<p class="text-secondary-600 text-sm">No song matches that.</p>
			{:else}
				<p class="text-secondary-600 text-sm">
					Download some songs to puzzle their backgrounds, or take a picture of your own.
				</p>
			{/if}
		</div>

		<!-- How many pieces, and go -->
		<div class="flex flex-col gap-5 min-w-0">
			{#if picture}
				<div class="relative aspect-video rounded-xl overflow-hidden ring-1 ring-white/10">
					{#if picture.image}
						<img src={picture.image} alt="" class="absolute inset-0 size-full object-cover" />
					{:else}
						<BeatmapBackground
							setId={picture.setId}
							mapId={picture.mapId}
							title={picture.title}
							class="absolute inset-0"
						/>
					{/if}
					<div class="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
					<div class="absolute bottom-0 inset-x-0 p-3 min-w-0">
						<p class="font-bold truncate">{picture.title}</p>
						{#if picture.artist}<p class="text-sm text-white/70 truncate">{picture.artist}</p>{/if}
					</div>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<h2 class="text-xl font-bold">Pieces</h2>
				<div class="flex flex-wrap gap-2">
					{#each PIECE_COUNTS as count (count)}
						<button
							class="px-4 h-9 rounded-full text-sm font-bold tabular-nums cursor-pointer transition {options.pieces ===
							count
								? 'bg-primary-300 text-white'
								: 'bg-secondary-200 hover:bg-secondary-300'}"
							onclick={() => (options.pieces = count)}>{actualCount(count)}</button
						>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-2 text-sm">
				<label class="flex items-center gap-3 cursor-pointer w-fit">
					<input
						type="checkbox"
						bind:checked={options.outlines}
						class="accent-primary-400 size-4"
					/>
					<span
						><span class="font-semibold">Outlines on the board</span>
						<span class="text-secondary-600">· where the pieces go</span></span
					>
				</label>
				<label class="flex items-center gap-3 cursor-pointer w-fit">
					<input type="checkbox" bind:checked={options.ghost} class="accent-primary-400 size-4" />
					<span
						><span class="font-semibold">The picture on the board</span>
						<span class="text-secondary-600">· faintly, to puzzle onto</span></span
					>
				</label>
			</div>

			<p class="text-sm text-secondary-600">
				No time limit, nothing to score: your music keeps playing (or your library starts on
				shuffle), and the puzzle is kept when you leave.
				{#if save}Starting a new one replaces the unfinished one.{/if}
			</p>

			<button
				class="self-start flex items-center gap-2 px-6 h-12 rounded-full bg-primary-300 hover:bg-primary-400 font-bold cursor-pointer transition shadow-lg shadow-black/30 disabled:opacity-50 disabled:pointer-events-none"
				disabled={!picture || busy}
				onclick={() => onstart({ picture, ...options })}
			>
				{#if busy}
					<span class="icon-[line-md--loading-loop] size-5"></span>Cutting it up…
				{:else}
					<span class="icon-[ri--puzzle-2-line] size-5"></span>Start puzzling
				{/if}
			</button>
		</div>
	</section>
</div>
