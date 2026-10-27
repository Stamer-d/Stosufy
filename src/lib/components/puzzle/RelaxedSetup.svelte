<script>
	import { currentSong } from '#lib/stores/audio.ts';
	import { downloadedLibrary } from '#lib/stores/data.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import {
		MODES,
		PIECE_COUNTS,
		dropRelaxed,
		formatTime,
		gridFor,
		loadRelaxedSaves,
		ownPicture
	} from '#lib/puzzle/puzzle.ts';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import SongCover from '#lib/components/SongCover.svelte';

	/**
	 * Setting up a relaxed puzzle: any picture (a song's background or one of your own), any of
	 * the three kinds, as many pieces as you like. Puzzles left unfinished wait here.
	 * @type {{ busy?: boolean, onstart: (setup: { picture: import('#lib/puzzle/puzzle.ts').PuzzlePicture, mode: import('#lib/puzzle/puzzle.ts').PuzzleMode, pieces: number, ghost: boolean, outlines: boolean }) => void, onresume: (save: import('#lib/puzzle/puzzle.ts').RelaxedSave) => void }}
	 */
	let { busy = false, onstart, onresume } = $props();

	const SETTINGS_KEY = 'puzzleRelaxedSettings';
	let options = $state(readOptions());
	function readOptions() {
		const fallback = {
			mode: 'jigsaw',
			pieces: { jigsaw: 100, slide: 12, spin: 48 },
			ghost: false,
			outlines: true
		};
		try {
			const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
			// (the pieces were one number when there was only the jigsaw)
			const pieces =
				typeof saved.pieces === 'object'
					? { ...fallback.pieces, ...saved.pieces }
					: { ...fallback.pieces, jigsaw: saved.pieces ?? fallback.pieces.jigsaw };
			return { ...fallback, ...saved, pieces };
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

	let saves = $state(loadRelaxedSaves());
	/** How far along a save is (older ones only know their pieces) */
	const doneOf = (save) =>
		save.progress ??
		(save.pieces ? save.pieces.filter((piece) => piece.placed).length / save.pieces.length : 0);
	function forget(save) {
		dropRelaxed(save.id);
		saves = loadRelaxedSaves();
	}
	const modeOf = (id) => MODES.find((mode) => mode.id === (id ?? 'jigsaw'));

	let library = $derived($downloadedLibrary);
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
	{#if saves.length}
		<!-- The puzzles left unfinished -->
		<section class="flex flex-col gap-3">
			<h2 class="text-xl font-bold">
				Keep going <span class="text-secondary-600 font-semibold text-base"
					>· {saves.length} unfinished</span
				>
			</h2>
			<div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
				{#each saves as save (save.id)}
					<div class="relative group">
						<button
							class="block w-full relative aspect-video rounded-xl overflow-hidden text-left cursor-pointer ring-1 ring-white/10 hover:ring-primary-400 transition disabled:opacity-50"
							title="Go on with it"
							disabled={busy}
							onclick={() => onresume(save)}
						>
							{#if save.picture.image}
								<img
									src={save.picture.image}
									alt=""
									class="absolute inset-0 size-full object-cover"
								/>
							{:else}
								<BeatmapBackground
									setId={save.picture.setId}
									mapId={save.picture.mapId}
									title={save.picture.title}
									class="absolute inset-0"
								/>
							{/if}
							<div
								class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent"
							></div>
							<span
								class="absolute top-2 left-2 grid place-items-center size-9 rounded-full bg-primary-300 shadow-lg opacity-0 group-hover:opacity-100 transition"
							>
								<span class="icon-[mingcute--play-fill] size-4"></span>
							</span>
							<div class="absolute bottom-0 inset-x-0 p-3 min-w-0">
								<p class="font-bold truncate">{save.picture.title}</p>
								<p class="flex items-center gap-1.5 text-xs text-white/70">
									<span class="{modeOf(save.mode)?.icon} size-3.5"></span>
									{save.cols * save.rows} · {Math.round(doneOf(save) * 100)}% · {formatTime(
										save.time
									)}
								</p>
								<div class="mt-2 h-1 rounded-full bg-white/15 overflow-hidden">
									<div class="h-full bg-primary-400" style="width: {doneOf(save) * 100}%"></div>
								</div>
							</div>
						</button>
						<button
							class="absolute top-2 right-2 grid place-items-center size-7 rounded-full bg-black/60 hover:bg-red-500 cursor-pointer transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
							title="Throw it away"
							aria-label="Throw away {save.picture.title}"
							onclick={() => forget(save)}
						>
							<span class="icon-[mingcute--delete-2-line] size-4"></span>
						</button>
					</div>
				{/each}
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
				<!-- The scrolling and the grid apart: a grid that's also limited in height squeezes
				     its rows, and the covers overlap -->
				<div class="max-h-[22rem] overflow-y-auto pr-1">
					<div class="grid gap-2 grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
						{#each matches.slice(0, shown) as song (song.id)}
							<button
								class="block w-full relative aspect-square rounded-lg overflow-hidden cursor-pointer ring-2 transition {isPicked(
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
								class="block w-full aspect-square rounded-lg bg-secondary-200 hover:bg-secondary-300 text-xs font-semibold text-secondary-600 cursor-pointer transition"
								onclick={() => (shown += 96)}>{Math.min(96, matches.length - shown)} more</button
							>
						{/if}
					</div>
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
				<h2 class="text-xl font-bold">Kind</h2>
				<div class="grid grid-cols-3 gap-2">
					{#each MODES as mode (mode.id)}
						<button
							class="flex flex-col items-start gap-1 p-3 rounded-xl text-left cursor-pointer ring-1 transition {options.mode ===
							mode.id
								? 'bg-primary-300/20 ring-primary-400'
								: 'bg-secondary-200 ring-white/5 hover:bg-secondary-300'}"
							onclick={() => (options.mode = mode.id)}
						>
							<span class="{mode.icon} size-6"></span>
							<span class="font-bold">{mode.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<h2 class="text-xl font-bold">{options.mode === 'jigsaw' ? 'Pieces' : 'Tiles'}</h2>
				<div class="flex flex-wrap gap-2">
					{#each PIECE_COUNTS[options.mode] as count (count)}
						<button
							class="px-4 h-9 rounded-full text-sm font-bold tabular-nums cursor-pointer transition {options
								.pieces[options.mode] === count
								? 'bg-primary-300 text-white'
								: 'bg-secondary-200 hover:bg-secondary-300'}"
							onclick={() => (options.pieces[options.mode] = count)}>{actualCount(count)}</button
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
						><span class="font-semibold"
							>{options.mode === 'jigsaw' ? 'Outlines on the board' : 'Light up what’s right'}</span
						>
						<span class="text-secondary-600"
							>· {options.mode === 'jigsaw'
								? 'where the pieces go'
								: 'tiles in their place glow'}</span
						></span
					>
				</label>
				<label class="flex items-center gap-3 cursor-pointer w-fit">
					<input type="checkbox" bind:checked={options.ghost} class="accent-primary-400 size-4" />
					<span
						><span class="font-semibold"
							>{options.mode === 'jigsaw'
								? 'The picture on the board'
								: options.mode === 'slide'
									? 'Numbers on the tiles'
									: 'Arrows pointing up'}</span
						>
						<span class="text-secondary-600"
							>· {options.mode === 'jigsaw' ? 'faintly, to puzzle onto' : 'a little help'}</span
						></span
					>
				</label>
			</div>

			<p class="text-sm text-secondary-600">
				No time limit, nothing to score: your music keeps playing (or your library starts on
				shuffle). Leave whenever you like: the puzzle waits above, with the others you haven't
				finished.
			</p>

			<button
				class="self-start flex items-center gap-2 px-6 h-12 rounded-full bg-primary-300 hover:bg-primary-400 font-bold cursor-pointer transition shadow-lg shadow-black/30 disabled:opacity-50 disabled:pointer-events-none"
				disabled={!picture || busy}
				onclick={() =>
					onstart({
						picture,
						mode: options.mode,
						pieces: options.pieces[options.mode],
						ghost: options.ghost,
						outlines: options.outlines
					})}
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
