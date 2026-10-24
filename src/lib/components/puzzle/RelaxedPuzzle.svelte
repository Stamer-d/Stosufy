<script>
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { playSkinSound } from '#lib/hitsounds/player.ts';
	import { finishRelaxed, formatTime, saveRelaxed } from '#lib/puzzle/puzzle.ts';
	import Jigsaw from '#lib/components/puzzle/Jigsaw.svelte';

	/**
	 * A relaxed jigsaw: no time limit and no score, the music just plays on. Pieces that fit
	 * join together; the puzzle is kept as it goes, to go on with later.
	 * @type {{ game: { picture: import('#lib/puzzle/puzzle.ts').PuzzlePicture, url: string, aspect: number, cols: number, rows: number, seed: number, ghost: boolean, outlines: boolean, saved: import('#lib/puzzle/puzzle.ts').SavedPiece[] | null, time: number }, onleave: () => void, onnew: () => void }}
	 */
	let { game, onleave, onnew } = $props();

	let total = $derived(game.cols * game.rows);
	let progress = $state(0);
	let placed = $derived(Math.round(progress * total));
	let peeking = $state(false);
	let done = $state(false);
	let showDone = $state(false);
	let jigsaw = $state();

	// The time spent on it: what it had before, and this time
	const openedAt = Date.now();
	let now = $state(Date.now());
	let doneTime = $state(0);
	let time = $derived(doneTime || game.time + (now - openedAt));

	let mods = $derived([...(game.ghost ? ['EZ'] : []), ...(game.outlines ? [] : ['HD'])]);

	// Kept a moment after each move (and when leaving)
	let pieces = null;
	let saveTimer;
	function keep() {
		clearTimeout(saveTimer);
		if (done || !pieces) return;
		saveRelaxed({
			picture: game.picture,
			cols: game.cols,
			rows: game.rows,
			seed: game.seed,
			ghost: game.ghost,
			outlines: game.outlines,
			pieces,
			time: game.time + (Date.now() - openedAt),
			at: Date.now()
		});
	}
	function changed(next) {
		pieces = next;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(keep, 800);
	}

	function snapped({ home }) {
		playSkinSound('normal', 'soft', home ? 0.6 : 0.4);
	}

	function solved() {
		done = true;
		doneTime = game.time + (Date.now() - openedAt);
		peeking = false;
		clearTimeout(saveTimer);
		saveRelaxed(null);
		finishRelaxed({ picture: game.picture, pieces: total, time: doneTime, at: Date.now() });
		playSkinSound('finish', 'normal', 0.8);
		setTimeout(() => (showDone = true), 900);
	}

	function leave() {
		keep();
		onleave();
	}

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		const onKey = (event) => {
			if (event.target instanceof HTMLInputElement) return;
			if (event.key === 'Escape') leave();
			if (event.key.toLowerCase() === 'q' && !event.repeat && !done) peeking = true;
		};
		const onKeyUp = (event) => {
			if (event.key.toLowerCase() === 'q') peeking = false;
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			clearInterval(timer);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keyup', onKeyUp);
			keep();
		};
	});
</script>

<div class="relative h-full flex flex-col overflow-hidden">
	<!-- The picture behind it all, dark and blurred -->
	<div class="absolute inset-0 overflow-hidden pointer-events-none">
		<img src={game.url} alt="" class="size-full object-cover blur-2xl scale-110 opacity-25" />
	</div>

	<div class="relative z-10 flex items-center gap-4 px-5 py-3 bg-black/30 backdrop-blur">
		<img
			src={game.url}
			alt="What it should look like"
			class="h-14 aspect-video object-cover rounded ring-1 ring-white/15 shadow"
		/>
		<div class="min-w-0 flex-1">
			<p class="font-bold truncate">{game.picture.title}</p>
			<p class="text-xs text-white/60 tabular-nums">
				{placed} of {total} pieces · {formatTime(time)}
			</p>
		</div>
		<div class="flex items-center gap-1">
			<button
				title="Edge pieces to the left, the rest to the right"
				class="flex items-center gap-2 px-3 h-9 rounded-full hover:bg-white/15 text-sm font-semibold cursor-pointer transition disabled:opacity-30 disabled:pointer-events-none"
				disabled={done}
				onclick={() => jigsaw?.sortEdges()}
			>
				<span class="icon-[mingcute--classify-2-line] size-5"></span>Edges first
			</button>
			<button
				title="Hold to see the whole picture (Q)"
				aria-label="Peek"
				class="size-9 grid place-items-center rounded-full hover:bg-white/15 cursor-pointer transition disabled:opacity-30 disabled:pointer-events-none"
				disabled={done}
				onpointerdown={() => (peeking = true)}
				onpointerup={() => (peeking = false)}
				onpointerleave={() => (peeking = false)}
			>
				<span class="icon-[mingcute--eye-line] size-5"></span>
			</button>
			<button
				title="Leave (Esc): the puzzle is kept"
				aria-label="Leave the puzzle"
				class="size-9 grid place-items-center rounded-full hover:bg-white/15 cursor-pointer transition"
				onclick={leave}
			>
				<span class="icon-[mingcute--close-line] size-5"></span>
			</button>
		</div>
	</div>
	<div class="relative z-10 h-1 bg-white/10">
		<div
			class="h-full bg-primary-400 transition-[width] duration-300"
			style="width: {progress * 100}%"
		></div>
	</div>

	<div class="relative flex-1 min-h-0">
		<Jigsaw
			bind:this={jigsaw}
			url={game.url}
			aspect={game.aspect}
			cols={game.cols}
			rows={game.rows}
			seed={game.seed}
			{mods}
			{peeking}
			relaxed
			saved={game.saved}
			onsnap={snapped}
			onchange={changed}
			onprogress={(fraction) => (progress = fraction)}
			onsolved={solved}
		/>

		{#if showDone}
			<div
				class="absolute inset-0 z-[100002] grid place-items-center bg-black/40"
				transition:fade={{ duration: 250 }}
			>
				<div
					class="flex flex-col items-center gap-4 px-10 py-8 rounded-2xl bg-secondary-100/90 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl text-center"
					in:scale={{ start: 0.85, duration: 400, easing: backOut }}
				>
					<span class="icon-[ri--puzzle-2-line] size-12 text-primary-400"></span>
					<div>
						<p class="text-3xl font-extrabold">Done!</p>
						<p class="mt-1 text-white/70">
							{total} pieces in {formatTime(time)}. It hangs in your gallery now.
						</p>
					</div>
					<div class="flex flex-wrap justify-center gap-2">
						<button
							class="flex items-center gap-2 px-5 h-11 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition"
							onclick={onnew}
						>
							<span class="icon-[ri--puzzle-2-line] size-5"></span>
							Another one
						</button>
						<button
							class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
							onclick={() => (showDone = false)}
						>
							<span class="icon-[mingcute--pic-line] size-5"></span>
							Look at it
						</button>
						<button
							class="flex items-center gap-2 px-5 h-11 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
							onclick={onleave}
						>
							<span class="icon-[mingcute--arrow-left-line] size-5"></span>
							Back
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
