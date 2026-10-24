<script module>
	let instances = 0;
</script>

<script>
	import { onMount, untrack } from 'svelte';
	import { jigsawPaths, judgeBeat, seededRandom } from '#lib/puzzle/puzzle.ts';

	/**
	 * A jigsaw of the picture: pieces with knobs lie around the board, dragged onto it. A piece
	 * dropped where it belongs snaps in (judged on the beat); dropped on the board anywhere
	 * else it's a miss and gets kicked back off.
	 * `relaxed`: a puzzle like on a table instead: nothing is judged, pieces can lie anywhere,
	 * and pieces that fit together join and move as one. `saved` puts a puzzle back the way
	 * `onchange` last told it.
	 * @type {{ url: string, aspect: number, cols: number, rows: number, seed: number, mods: string[], peeking?: boolean, relaxed?: boolean, saved?: import('#lib/puzzle/puzzle.ts').SavedPiece[] | null, onaction?: (action: import('#lib/puzzle/puzzle.ts').PuzzleAction) => void, onsnap?: (snap: { x: number, y: number, home: boolean }) => void, onchange?: (pieces: import('#lib/puzzle/puzzle.ts').SavedPiece[]) => void, onprogress: (fraction: number) => void, onsolved: () => void }}
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
		const kept = saved?.length === cols * rows ? saved : null;
		return jigsawPaths(cols, rows, WIDTH, height, random).map((path, i) => ({
			i,
			c: i % cols,
			r: Math.floor(i / cols),
			path,
			x: kept?.[i].x ?? (i % cols) * w,
			y: kept?.[i].y ?? Math.floor(i / cols) * h,
			rot: spun && random() < 0.75 ? Math.floor(1 + random() * 3) * 90 : 0,
			placed: kept?.[i].placed ?? false,
			z: kept?.[i].z ?? i,
			/** The pieces joined together share a group */
			g: kept?.[i].g ?? i,
			kicked: false
		}));
	}

	/** What to keep of the pieces to put the puzzle back later */
	const snapshot = () =>
		pieces.map(({ x, y, placed, z, g }) => ({
			x: Math.round(x * 10) / 10,
			y: Math.round(y * 10) / 10,
			placed,
			z,
			g
		}));
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

	/** A random spot beside the board, left or right, knobs and all on the table */
	function traySpot(piece, side = random() < 0.5 ? -1 : 1) {
		const b = bounds();
		const [from, to] =
			side < 0
				? [b.left + pad * 1.05, -w - pad * 0.6]
				: [WIDTH + pad * 0.6, b.right - w - pad * 1.05];
		const x = from + random() * Math.max(0, to - from);
		const y = b.top + pad * 1.05 + random() * Math.max(0, b.bottom - b.top - h - pad * 2.1);
		piece.x = x;
		piece.y = y;
	}

	/** The highest piece on the table */
	let top = Math.max(0, ...pieces.map((piece) => piece.z));

	// Scattered once the table has a size; every other piece to the other side
	let scattered = pieces.some((piece, i) => piece.x !== (i % cols) * w || piece.placed);
	$effect(() => {
		if (scattered || !tableWidth || !tableHeight) return;
		scattered = true;
		const order = pieces.map((piece) => piece.i).sort(() => random() - 0.5);
		order.forEach((index, n) => traySpot(pieces[index], n % 2 ? 1 : -1));
		order.forEach((index, n) => (pieces[index].z = n));
		top = order.length;
		onchange(snapshot());
	});

	// A smaller window: what lay at the edge of the table is pulled back onto it (each group
	// as a whole, so it stays together)
	$effect(() => {
		if (!tableWidth || !tableHeight) return;
		const b = bounds();
		untrack(() => {
			const groups = new Map();
			for (const piece of pieces) {
				if (piece.placed) continue;
				if (!groups.has(piece.g)) groups.set(piece.g, []);
				groups.get(piece.g).push(piece);
			}
			for (const members of groups.values()) {
				const left = Math.min(...members.map((p) => p.x));
				const right = Math.max(...members.map((p) => p.x + w));
				const up = Math.min(...members.map((p) => p.y));
				const down = Math.max(...members.map((p) => p.y + h));
				const dx = Math.max(0, b.left - left) - Math.max(0, right - b.right);
				const dy = Math.max(0, b.top - up) - Math.max(0, down - b.bottom);
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
				for (const member of members) {
					member.x += dx;
					member.y += dy;
				}
			}
		});
	});

	let dragging = $state(null);
	/** The piece last held, for turning it with R */
	let held = null;

	/** The pieces joined to a piece, itself included (only in a relaxed puzzle) */
	const groupOf = (piece) =>
		relaxed ? pieces.filter((other) => other.g === piece.g && !other.placed) : [piece];

	function grab(event, piece) {
		if (piece.placed || event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const group = groupOf(piece);
		for (const member of group) {
			member.z = ++top;
			member.kicked = false;
		}
		held = piece;
		dragging = {
			piece,
			group: group.map((member) => ({ member, x: member.x, y: member.y })),
			pointer: event.pointerId,
			startX: event.clientX,
			startY: event.clientY
		};
	}

	function move(event) {
		if (!dragging || event.pointerId !== dragging.pointer) return;
		const b = bounds();
		const { group } = dragging;
		// The whole group stays at least half a piece on the table
		const left = Math.min(...group.map((p) => p.x));
		const right = Math.max(...group.map((p) => p.x));
		const up = Math.min(...group.map((p) => p.y));
		const down = Math.max(...group.map((p) => p.y));
		const dx = Math.min(
			b.right - w * 0.5 - right,
			Math.max(b.left - w * 0.5 - left, (event.clientX - dragging.startX) / scale)
		);
		const dy = Math.min(
			b.bottom - h * 0.5 - down,
			Math.max(b.top - h * 0.5 - up, (event.clientY - dragging.startY) / scale)
		);
		for (const { member, x, y } of group) {
			member.x = x + dx;
			member.y = y + dy;
		}
	}

	/** Neighbours of a piece on the grid */
	function neighbours(piece) {
		const result = [];
		if (piece.c > 0) result.push(pieces[piece.i - 1]);
		if (piece.c < cols - 1) result.push(pieces[piece.i + 1]);
		if (piece.r > 0) result.push(pieces[piece.i - cols]);
		if (piece.r < rows - 1) result.push(pieces[piece.i + cols]);
		return result;
	}

	/**
	 * A relaxed drop: onto the board where the group belongs, else joined to a piece it fits
	 * (and to every other one that then fits as well)
	 */
	function dropRelaxed(event, group) {
		const near = group.find(
			(member) => Math.hypot(member.x - member.c * w, member.y - member.r * h) < snap
		);
		if (near) {
			for (const member of group) {
				member.x = member.c * w;
				member.y = member.r * h;
				member.placed = true;
				member.z = 0;
			}
			onsnap({ x: event.clientX, y: event.clientY, home: true });
			return;
		}
		let joined = false;
		for (const member of group) {
			for (const other of neighbours(member)) {
				if (other.placed || other.g === member.g) continue;
				const dx = other.x - (other.c - member.c) * w - member.x;
				const dy = other.y - (other.r - member.r) * h - member.y;
				if (Math.hypot(dx, dy) >= snap) continue;
				const g = member.g;
				for (const piece of pieces) {
					if (piece.g !== g) continue;
					piece.x += dx;
					piece.y += dy;
					piece.g = other.g;
				}
				joined = true;
				break;
			}
			if (joined) break;
		}
		if (!joined) return;
		// Whatever else lines up exactly now joins too
		let more = true;
		while (more) {
			more = false;
			const g = group[0].g;
			for (const member of pieces.filter((piece) => piece.g === g)) {
				for (const other of neighbours(member)) {
					if (other.placed || other.g === g) continue;
					const dx = other.x - (other.c - member.c) * w - member.x;
					const dy = other.y - (other.r - member.r) * h - member.y;
					if (Math.hypot(dx, dy) > 1) continue;
					const og = other.g;
					for (const piece of pieces) if (piece.g === og) piece.g = g;
					more = true;
				}
			}
		}
		const z = ++top;
		for (const piece of pieces) if (piece.g === group[0].g) piece.z = z;
		onsnap({ x: event.clientX, y: event.clientY, home: false });
	}

	function drop(event) {
		if (!dragging || event.pointerId !== dragging.pointer) return;
		const { piece, startX, startY, group } = dragging;
		dragging = null;
		if (relaxed) {
			dropRelaxed(
				event,
				group.map(({ member }) => member)
			);
			onchange(snapshot());
			return;
		}
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

	/**
	 * Sorts the loose pieces like a puzzler does: the edge pieces to the left of the board,
	 * the rest to the right (pieces already joined stay where they are)
	 */
	export function sortEdges() {
		const loose = pieces.filter(
			(piece) => !piece.placed && !pieces.some((o) => o !== piece && o.g === piece.g)
		);
		for (const piece of loose) {
			const edge = piece.c === 0 || piece.r === 0 || piece.c === cols - 1 || piece.r === rows - 1;
			piece.kicked = true;
			traySpot(piece, edge ? -1 : 1);
		}
		onchange(snapshot());
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
			{#if !relaxed}
				<!-- Lights up on the beat in kiai time -->
				<div
					class="kiai-glow absolute inset-0 pointer-events-none mix-blend-soft-light bg-[radial-gradient(circle_at_center,white,transparent_75%)]"
				></div>
			{/if}
		</div>

		{#each pieces as piece (piece.i)}
			<svg
				class="absolute overflow-visible pointer-events-none {piece.placed
					? ''
					: dragging?.group.some(({ member }) => member === piece)
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
