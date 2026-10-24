<script>
	import { onMount } from 'svelte';
	import { coverBox, judgeBeat, seededRandom, tileImageStyle } from '#lib/puzzle/puzzle.ts';

	/**
	 * A sliding puzzle: the tiles of the picture with one gap; a tile in the gap's row or column
	 * slides towards it (with the ones between). Every move is judged on the beat; too far off
	 * it is a miss. The last tile comes in once the rest is in place.
	 * @type {{ url: string, aspect: number, cols: number, rows: number, seed: number, mods: string[], peeking?: boolean, onaction: (action: import('#lib/puzzle/puzzle.ts').PuzzleAction) => void, onprogress: (fraction: number) => void, onsolved: () => void }}
	 */
	let {
		url,
		aspect,
		cols,
		rows,
		seed,
		mods,
		peeking = false,
		onaction,
		onprogress,
		onsolved
	} = $props();

	let count = $derived(cols * rows);
	let gapTile = $derived(count - 1);
	let box = $derived(coverBox(aspect, cols, rows));
	let easy = $derived(mods.includes('EZ'));
	let hidden = $derived(mods.includes('HD'));

	/** Which cell each tile is in */
	let cells = $state(shuffled());
	let solved = $derived(cells.every((cell, tile) => cell === tile));
	let homeCount = $derived(cells.filter((cell, tile) => tile !== gapTile && cell === tile).length);

	/** From the solved picture, random slides: always solvable */
	function shuffled() {
		const random = seededRandom(seed);
		const at = [...Array(count).keys()];
		let previous = -1;
		const steps = count * 30;
		for (let step = 0; step < steps || at.every((cell, tile) => cell === tile); step++) {
			const gap = at[gapTile];
			const options = neighbours(gap).filter((cell) => cell !== previous);
			const target = options[Math.floor(random() * options.length)];
			const tile = at.indexOf(target);
			at[tile] = gap;
			at[gapTile] = target;
			previous = gap;
		}
		return at;
	}

	function neighbours(cell) {
		const c = cell % cols;
		const r = Math.floor(cell / cols);
		const result = [];
		if (c > 0) result.push(cell - 1);
		if (c < cols - 1) result.push(cell + 1);
		if (r > 0) result.push(cell - cols);
		if (r < rows - 1) result.push(cell + cols);
		return result;
	}

	/** Slides the tile in `cell` (and the ones between it and the gap) towards the gap */
	function slide(cell, x, y) {
		if (solved) return;
		const gap = cells[gapTile];
		const [c, r] = [cell % cols, Math.floor(cell / cols)];
		const [gc, gr] = [gap % cols, Math.floor(gap / cols)];
		if (cell === gap || (c !== gc && r !== gr)) return;
		const step = c === gc ? (r < gr ? cols : -cols) : c < gc ? 1 : -1;
		let home = false;
		// From the gap back to the clicked cell: each tile moves one on
		for (let at = gap; at !== cell; at -= step) {
			const tile = cells.indexOf(at - step);
			cells[tile] = at;
			if (tile === at) home = true;
		}
		cells[gapTile] = cell;
		const { judgement, kiai } = judgeBeat(true);
		onaction({ judgement, kiai, home, x, y });
	}

	let board = $state();
	function center(cell) {
		const rect = board?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: rect.left + ((cell % cols) + 0.5) * (rect.width / cols),
			y: rect.top + (Math.floor(cell / cols) + 0.5) * (rect.height / rows)
		};
	}

	onMount(() => {
		const onKey = (event) => {
			if (event.target instanceof HTMLInputElement) return;
			const gap = cells[gapTile];
			const [gc, gr] = [gap % cols, Math.floor(gap / cols)];
			// The arrow moves a tile that way into the gap
			const from = {
				ArrowLeft: gc < cols - 1 ? gap + 1 : null,
				ArrowRight: gc > 0 ? gap - 1 : null,
				ArrowUp: gr < rows - 1 ? gap + cols : null,
				ArrowDown: gr > 0 ? gap - cols : null
			}[event.key];
			if (from === undefined) return;
			event.preventDefault();
			if (from === null) return;
			const { x, y } = center(from);
			slide(from, x, y);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	let reported = false;
	$effect(() => {
		onprogress(homeCount / (count - 1));
		if (solved && !reported) {
			reported = true;
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
		class="relative rounded-md bg-black/40 ring-1 ring-white/15 shadow-2xl beat-bump"
		style="width: {tile * cols}px; height: {tile * rows}px"
	>
		{#each cells as cell, index (index)}
			{@const home = cell === index}
			<button
				class="absolute p-[2px] transition-transform duration-[110ms] ease-out {index === gapTile
					? solved
						? 'last-in'
						: 'invisible'
					: 'cursor-pointer'}"
				style="width: {tile}px; height: {tile}px; transform: translate({(cell % cols) *
					tile}px, {Math.floor(cell / cols) * tile}px)"
				aria-label="Tile {index + 1}"
				onclick={(event) => slide(cells[index], event.clientX, event.clientY)}
			>
				<span
					class="relative block size-full overflow-hidden rounded-[3px] ring-1 transition-shadow {home &&
					!hidden &&
					!solved
						? 'ring-primary-400/70 shadow-[0_0_10px] shadow-primary-400/40'
						: 'ring-black/40'}"
				>
					<img
						src={url}
						alt=""
						draggable="false"
						class="absolute max-w-none pointer-events-none"
						style={tileImageStyle(box, index % cols, Math.floor(index / cols))}
					/>
					{#if easy && !solved}
						<span
							class="absolute left-1 top-0.5 text-xs font-extrabold text-white drop-shadow-[0_1px_2px_black]"
							>{index + 1}</span
						>
					{/if}
				</span>
			</button>
		{/each}
		<div
			class="kiai-glow absolute inset-0 pointer-events-none mix-blend-soft-light bg-[radial-gradient(circle_at_center,white,transparent_75%)]"
		></div>
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
	.last-in {
		animation: last-in 600ms ease-out;
	}
	@keyframes last-in {
		from {
			opacity: 0;
			filter: brightness(2);
		}
	}
</style>
