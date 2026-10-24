<script module>
	let instances = 0;
</script>

<script>
	import { onMount } from 'svelte';
	import { jigsawPaths, judgeBeat, seededRandom } from '#lib/puzzle/puzzle.ts';

	/**
	 * A jigsaw of the picture: pieces with knobs lie around the board, dragged onto it. A piece
	 * dropped where it belongs snaps in (judged on the beat); dropped on the board anywhere
	 * else it's a miss and gets kicked back off.
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

	const uid = `jigsaw-${++instances}`;
	// The picture in its own units: 1000 wide
	const WIDTH = 1000;
	let height = $derived(WIDTH / aspect);
	let w = $derived(WIDTH / cols);
	let h = $derived(height / rows);
	// Room around a piece for its knobs
	let pad = $derived(Math.min(w, h) * 0.3);
	let easy = $derived(mods.includes('EZ'));
	let hidden = $derived(mods.includes('HD'));
	let spun = $derived(mods.includes('SP'));
	let snap = $derived(Math.min(w, h) * (easy ? 0.45 : 0.28));

	/** The puzzle's own randomness, from its seed (the same puzzle for the same seed) */
	let random = Math.random;
	let pieces = $state(cut());

	function cut() {
		random = seededRandom(seed);
		return jigsawPaths(cols, rows, WIDTH, height, random).map((path, i) => ({
			i,
			c: i % cols,
			r: Math.floor(i / cols),
			path,
			x: (i % cols) * w,
			y: Math.floor(i / cols) * h,
			rot: spun && random() < 0.75 ? Math.floor(1 + random() * 3) * 90 : 0,
			placed: false,
			z: i,
			kicked: false
		}));
	}
	let placedCount = $derived(pieces.filter((piece) => piece.placed).length);

	// The table and the board on it (px)
	let tableWidth = $state(0);
	let tableHeight = $state(0);
	let scale = $derived(
		Math.max(0.01, Math.min((tableWidth * 0.6) / WIDTH, (tableHeight * 0.86) / height))
	);
	let boardX = $derived((tableWidth - WIDTH * scale) / 2);
	let boardY = $derived((tableHeight - height * scale) / 2);

	/** The table's edges in the picture's units */
	const bounds = () => ({
		left: -boardX / scale,
		top: -boardY / scale,
		right: (tableWidth - boardX) / scale,
		bottom: (tableHeight - boardY) / scale
	});

	/** A random spot beside the board, left or right */
	function traySpot(piece, side = random() < 0.5 ? -1 : 1) {
		const b = bounds();
		const [from, to] =
			side < 0
				? [b.left + pad * 0.3, -w - pad * 0.6]
				: [WIDTH + pad * 0.6, b.right - w - pad * 0.3];
		const x = from + random() * Math.max(0, to - from);
		const y = b.top + pad * 0.5 + random() * Math.max(0, b.bottom - b.top - h - pad);
		piece.x = x;
		piece.y = y;
	}

	/** The highest piece on the table */
	let top = 0;

	// Scattered once the table has a size; every other piece to the other side
	let scattered = false;
	$effect(() => {
		if (scattered || !tableWidth || !tableHeight) return;
		scattered = true;
		const order = pieces.map((piece) => piece.i).sort(() => random() - 0.5);
		order.forEach((index, n) => traySpot(pieces[index], n % 2 ? 1 : -1));
		order.forEach((index, n) => (pieces[index].z = n));
		top = order.length;
	});

	let dragging = $state(null);
	/** The piece last held, for turning it with R */
	let held = null;

	function grab(event, piece) {
		if (piece.placed || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		piece.z = ++top;
		piece.kicked = false;
		held = piece;
		dragging = {
			piece,
			pointer: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			x: piece.x,
			y: piece.y
		};
	}

	function move(event) {
		if (!dragging || event.pointerId !== dragging.pointer) return;
		const b = bounds();
		const piece = dragging.piece;
		piece.x = Math.min(
			b.right - w * 0.5,
			Math.max(b.left - w * 0.5, dragging.x + (event.clientX - dragging.startX) / scale)
		);
		piece.y = Math.min(
			b.bottom - h * 0.5,
			Math.max(b.top - h * 0.5, dragging.y + (event.clientY - dragging.startY) / scale)
		);
	}

	function drop(event) {
		if (!dragging || event.pointerId !== dragging.pointer) return;
		const { piece, startX, startY } = dragging;
		dragging = null;
		const homeX = piece.c * w;
		const homeY = piece.r * h;
		if (piece.rot % 360 === 0 && Math.hypot(piece.x - homeX, piece.y - homeY) < snap) {
			piece.x = homeX;
			piece.y = homeY;
			piece.placed = true;
			piece.z = 0;
			const { judgement, kiai } = judgeBeat(false);
			onaction({ judgement, kiai, home: true, x: event.clientX, y: event.clientY });
			return;
		}
		// Only a real drop on the board counts, not a click
		const cx = piece.x + w / 2;
		const cy = piece.y + h / 2;
		const moved = Math.hypot(event.clientX - startX, event.clientY - startY) > 6;
		if (moved && cx > 0 && cx < WIDTH && cy > 0 && cy < height) {
			onaction({ judgement: 0, x: event.clientX, y: event.clientY });
			piece.kicked = true;
			traySpot(piece, cx < WIDTH / 2 ? -1 : 1);
		}
	}

	function turn(piece, by = 90) {
		if (!piece || piece.placed) return;
		piece.rot += by;
	}

	onMount(() => {
		const onKey = (event) => {
			if (!spun || event.repeat || event.key.toLowerCase() !== 'r') return;
			if (event.target instanceof HTMLInputElement) return;
			turn(dragging?.piece ?? held, event.shiftKey ? -90 : 90);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	let solved = false;
	$effect(() => {
		onprogress(placedCount / pieces.length);
		if (placedCount === pieces.length && !solved) {
			solved = true;
			onsolved();
		}
	});
</script>

<div
	class="relative size-full overflow-hidden select-none touch-none"
	bind:clientWidth={tableWidth}
	bind:clientHeight={tableHeight}
>
	{#if tableWidth}
		<!-- The board: where the pieces go -->
		<div
			class="absolute rounded-sm bg-black/35 ring-1 ring-white/15 shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]"
			style="left: {boardX}px; top: {boardY}px; width: {WIDTH * scale}px; height: {height *
				scale}px"
		>
			{#if easy}
				<img src={url} alt="" class="absolute inset-0 size-full opacity-20 grayscale" />
			{/if}
			{#if !hidden}
				<svg class="absolute inset-0 size-full" viewBox="0 0 {WIDTH} {height}" aria-hidden="true">
					{#each pieces as piece (piece.i)}
						<path
							d={piece.path}
							fill="none"
							stroke="white"
							stroke-opacity="0.08"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
				</svg>
			{/if}
			<!-- Lights up on the beat in kiai time -->
			<div
				class="kiai-glow absolute inset-0 pointer-events-none mix-blend-soft-light bg-[radial-gradient(circle_at_center,white,transparent_75%)]"
			></div>
		</div>

		{#each pieces as piece (piece.i)}
			<svg
				class="absolute overflow-visible pointer-events-none {piece.placed
					? ''
					: dragging?.piece === piece
						? 'cursor-grabbing drop-shadow-[0_10px_14px_rgba(0,0,0,0.6)]'
						: 'cursor-grab drop-shadow-[0_3px_4px_rgba(0,0,0,0.55)]'} {piece.placed
					? 'snapped'
					: ''}"
				style="left: {boardX + (piece.x - pad) * scale}px; top: {boardY +
					(piece.y - pad) * scale}px; width: {(w + pad * 2) * scale}px; height: {(h + pad * 2) *
					scale}px; z-index: {piece.placed
					? 0
					: piece.z + 1}; transform: rotate({piece.rot}deg); transition-property: {piece.kicked
					? 'left, top, transform'
					: 'transform'}; transition-duration: {piece.kicked ? '500ms' : '150ms'}"
				viewBox="{piece.c * w - pad} {piece.r * h - pad} {w + pad * 2} {h + pad * 2}"
				aria-hidden="true"
			>
				<defs>
					<clipPath id="{uid}-{piece.i}">
						<path d={piece.path} />
					</clipPath>
				</defs>
				<image
					href={url}
					x="0"
					y="0"
					width={WIDTH}
					{height}
					preserveAspectRatio="none"
					clip-path="url(#{uid}-{piece.i})"
				/>
				<!-- The edge, and what's grabbed: only the piece itself, not the room around it -->
				<path
					d={piece.path}
					fill="transparent"
					stroke="white"
					stroke-opacity={piece.placed ? 0 : 0.45}
					stroke-width="1"
					vector-effect="non-scaling-stroke"
					style="pointer-events: {piece.placed ? 'none' : 'visiblePainted'}"
					role="button"
					tabindex="-1"
					aria-label="Piece {piece.i + 1}"
					onpointerdown={(event) => grab(event, piece)}
					onpointermove={move}
					onpointerup={drop}
					onpointercancel={drop}
					oncontextmenu={(event) => {
						event.preventDefault();
						if (spun) turn(piece);
					}}
				/>
			</svg>
		{/each}

		{#if peeking}
			<img
				src={url}
				alt=""
				class="absolute z-[100000] rounded-sm shadow-2xl pointer-events-none"
				style="left: {boardX}px; top: {boardY}px; width: {WIDTH * scale}px; height: {height *
					scale}px"
			/>
		{/if}
	{/if}
</div>

<style>
	/* A placed piece flashes once as it snaps in */
	.snapped {
		animation: snap 450ms ease-out;
	}
	@keyframes snap {
		from {
			filter: brightness(1.9) drop-shadow(0 0 12px white);
		}
		to {
			filter: none;
		}
	}
</style>
