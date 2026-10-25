<script>
	import { coverBox, seededRandom, tileImageStyle } from '#lib/puzzle/puzzle.ts';

	/**
	 * The picture in square tiles, most of them turned: a left click turns a tile right, a
	 * right click left. Every turn is told (`onaction`); turning a tile that was right is wrong.
	 * `relaxed`: nothing is counted (`onsnap` hears of each turn instead); `saved` turns the tiles
	 * back the way `onchange` last told it.
	 * @type {{ url: string, aspect: number, cols: number, rows: number, seed: number, mods: string[], peeking?: boolean, relaxed?: boolean, saved?: number[] | null, onaction?: (action: import('#lib/puzzle/puzzle.ts').PuzzleAction) => void, onsnap?: (snap: { x: number, y: number, home: boolean }) => void, onchange?: (tiles: number[]) => void, onprogress: (fraction: number) => void, onsolved: () => void }}
	 */
	let {
		url,
		aspect,
		cols,
		rows,
		seed,
		mods,
		peeking = false,
		relaxed = false,
		saved = null,
		onaction = () => {},
		onsnap = () => {},
		onchange = () => {},
		onprogress,
		onsolved
	} = $props();

	let count = $derived(cols * rows);
	let box = $derived(coverBox(aspect, cols, rows));
	let hidden = $derived(mods.includes('HD'));
	let easy = $derived(mods.includes('EZ'));

	/** The tile turned last */
	let lastTurned = 0;
	const upright = (n) => ((n % 4) + 4) % 4 === 0;
	/** Each tile's quarter turns, counted on (so it always turns the short way round) */
	let turns = $state(start());
	let rightCount = $derived(turns.filter(upright).length);
	let solved = $derived(rightCount === count);

	function start() {
		if (saved?.length === count) return [...saved];
		const random = seededRandom(seed);
		const result = Array.from({ length: count }, () =>
			random() < 0.85 ? 1 + Math.floor(random() * 3) : 0
		);
		if (result.every(upright)) result[0] = 2;
		return result;
	}

	function turn(event, index, by) {
		event.preventDefault();
		if (solved) return;
		const wasRight = upright(turns[index]);
		turns[index] += by;
		const home = upright(turns[index]);
		lastTurned = index;
		if (home) pop(index);
		if (relaxed) {
			onsnap({ x: event.clientX, y: event.clientY, home });
			onchange([...turns]);
			return;
		}
		onaction({ home, wrong: wasRight, x: event.clientX, y: event.clientY });
	}

	// --- How it feels --------------------------------------------------------------------

	/** Each tile's element, to animate it */
	const elements = [];
	let board = $state();
	let celebrating = $state(false);

	/** Where the board is on the screen (for the confetti) */
	export function boardRect() {
		return board?.getBoundingClientRect() ?? null;
	}

	/** A tile that went where it belongs: it pops */
	function pop(index) {
		elements[index]?.animate([{ filter: 'brightness(1.8)' }, { filter: 'brightness(1)' }], {
			duration: 380,
			easing: 'ease-out'
		});
	}

	/** The end: a wave runs through the tiles from the last one moved */
	function celebrate(from) {
		celebrating = true;
		const far = Math.hypot(cols, rows);
		elements.forEach((element, index) => {
			const distance =
				Math.hypot(
					(index % cols) - (from % cols),
					Math.floor(index / cols) - Math.floor(from / cols)
				) / far;
			element?.firstElementChild?.animate(
				[
					{ transform: 'scale(1)', filter: 'brightness(1)' },
					{ transform: 'scale(1.08)', filter: 'brightness(1.6)', offset: 0.4 },
					{ transform: 'scale(1)', filter: 'brightness(1)' }
				],
				{ duration: 520, delay: distance * 650, easing: 'ease-in-out' }
			);
		});
	}

	let reported = false;
	$effect(() => {
		onprogress(rightCount / count);
		if (solved && !reported) {
			reported = true;
			celebrate(lastTurned);
			onsolved();
		}
	});

	let areaWidth = $state(0);
	let areaHeight = $state(0);
	let tile = $derived(Math.min((areaWidth * 0.9) / cols, (areaHeight * 0.9) / rows));
</script>

<div
	class="size-full grid place-items-center select-none"
	bind:clientWidth={areaWidth}
	bind:clientHeight={areaHeight}
>
	<div
		bind:this={board}
		class="relative grid rounded-md bg-black/40 ring-1 ring-white/15 shadow-2xl beat-bump {solved
			? 'gap-0'
			: 'gap-[3px] p-[3px]'} transition-all duration-500"
		style="grid-template-columns: repeat({cols}, {solved ? tile : tile - 3}px)"
	>
		{#each turns as turned, index (index)}
			{@const right = upright(turned)}
			<button
				class="relative aspect-square overflow-hidden cursor-pointer transition-[transform,border-radius,box-shadow] duration-200 ease-out {solved
					? 'rounded-none'
					: 'rounded-[3px] hover:brightness-110'} {right && !hidden && !solved
					? 'ring-1 ring-primary-400/60'
					: ''}"
				style="transform: rotate({turned * 90}deg)"
				aria-label="Tile {index + 1}"
				bind:this={elements[index]}
				onclick={(event) => turn(event, index, 1)}
				oncontextmenu={(event) => turn(event, index, -1)}
			>
				<img
					src={url}
					alt=""
					draggable="false"
					class="absolute max-w-none pointer-events-none"
					style={tileImageStyle(box, index % cols, Math.floor(index / cols))}
				/>
				{#if easy && !right}
					<!-- Easy: an arrow shows which way is up -->
					<span
						class="absolute top-0.5 left-1/2 -translate-x-1/2 icon-[mingcute--arrow-up-line] size-4 text-white drop-shadow-[0_1px_2px_black]"
					></span>
				{/if}
			</button>
		{/each}
		<div
			class="kiai-glow absolute inset-0 pointer-events-none mix-blend-soft-light bg-[radial-gradient(circle_at_center,white,transparent_75%)]"
		></div>
		{#if celebrating}
			<div class="shine absolute inset-0 z-10 pointer-events-none rounded-md"></div>
		{/if}
		{#if peeking}
			<div class="absolute inset-0 overflow-hidden rounded-md pointer-events-none z-10">
				<img
					src={url}
					alt=""
					class="absolute max-w-none"
					style="left: {(box.x / cols) * 100}%; top: {(box.y / rows) * 100}%; width: {(box.width /
						cols) *
						100}%; height: {(box.height / rows) * 100}%"
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.shine {
		background: linear-gradient(
			105deg,
			transparent 30%,
			rgba(255, 255, 255, 0.55) 48%,
			rgba(255, 255, 255, 0.9) 50%,
			rgba(255, 255, 255, 0.55) 52%,
			transparent 70%
		);
		background-size: 250% 100%;
		mix-blend-mode: overlay;
		animation: shine 1100ms ease-in-out 650ms both;
	}
	@keyframes shine {
		from {
			background-position: 120% 0;
		}
		to {
			background-position: -40% 0;
		}
	}
</style>
