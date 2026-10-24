<script>
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { finishRelaxed, formatTime, saveRelaxed } from '#lib/puzzle/puzzle.ts';
	import { finishSound, joinSound, snapSound } from '#lib/puzzle/sounds.ts';
	import Jigsaw from '#lib/components/puzzle/Jigsaw.svelte';
	import Bursts from '#lib/components/puzzle/Bursts.svelte';
	import Puzzle3D from '#lib/components/puzzle/Puzzle3D.svelte';

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
	let bursts = $state();
	let showing3d = $state(false);

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

	function snapped({ home, x, y, size }) {
		if (home) {
			snapSound(progress, Math.min(1, 0.6 + size / 10));
			bursts?.burst(x, y, { power: Math.min(1, 0.5 + size / 12) });
			bursts?.ring(x, y, { size: 70 + Math.min(80, size * 6) });
		} else {
			joinSound(size);
			bursts?.burst(x, y, { power: 0.25, color: '#ffe08a' });
		}
	}

	function solved() {
		done = true;
		doneTime = game.time + (Date.now() - openedAt);
		peeking = false;
		clearTimeout(saveTimer);
		saveRelaxed(null);
		finishRelaxed({
			picture: game.picture,
			pieces: total,
			time: doneTime,
			at: Date.now(),
			seed: game.seed,
			cols: game.cols,
			rows: game.rows,
			aspect: game.aspect
		});
		finishSound();
		// The wave runs through the picture, then the confetti, then the card
		setTimeout(() => {
			const rect = jigsaw?.boardRect();
			if (rect) bursts?.confetti(rect, 160);
		}, 700);
		setTimeout(() => (showDone = true), 2300);
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
			<!-- Below the picture, so it stays in sight -->
			<div
				class="absolute inset-x-0 bottom-5 z-[100002] flex justify-center px-4 pointer-events-none"
				transition:fly={{ y: 30, duration: 350 }}
			>
				<div
					class="pointer-events-auto flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pl-5 pr-2 py-2 rounded-2xl bg-secondary-100/85 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl"
				>
					<div class="flex items-center gap-3">
						<span class="icon-[ri--puzzle-2-line] size-8 text-primary-400"></span>
						<div>
							<p class="text-lg font-extrabold leading-tight">Done!</p>
							<p class="text-sm text-white/70">
								{total} pieces in {formatTime(time)} · in your gallery now
							</p>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						<button
							class="flex items-center gap-2 px-4 h-10 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition"
							onclick={() => (showing3d = true)}
						>
							<span class="icon-[mingcute--cube-3d-line] size-5"></span>
							View in 3D
						</button>
						<button
							class="flex items-center gap-2 px-4 h-10 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
							onclick={onnew}
						>
							<span class="icon-[ri--puzzle-2-line] size-5"></span>
							Another one
						</button>
						<button
							class="flex items-center gap-2 px-4 h-10 rounded-full bg-white/15 hover:bg-white/25 font-semibold cursor-pointer transition"
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

<Bursts bind:this={bursts} />
{#if showing3d}
	<Puzzle3D
		puzzle={{
			url: game.url,
			aspect: game.aspect,
			cols: game.cols,
			rows: game.rows,
			seed: game.seed,
			shape: 'jigsaw',
			title: game.picture.title
		}}
		onclose={() => (showing3d = false)}
	/>
{/if}
