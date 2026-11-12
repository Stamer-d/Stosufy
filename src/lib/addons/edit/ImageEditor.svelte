<script>
	// A picture being edited: turned, mirrored, cut to a part (dragged, maybe in a shape like
	// square or 16:9), made smaller, and saved in a format.
	import { onDestroy } from 'svelte';
	import { showToast } from '#lib/stores/toast.ts';
	import { detectFormat, editTargets, extensionOf } from '../files/formats.ts';
	import { readImage } from '../files/image.ts';
	import { reveal } from '../files/save.ts';
	import Formats from '../files/Formats.svelte';
	import { freshImageEdit, oriented, outputSize, saveImage } from './image.ts';

	/** @type {{ file: File }} */
	let { file } = $props();

	// (a file of its own each time: the page makes a new editor for another file)
	// svelte-ignore state_referenced_locally
	const targets = editTargets(detectFormat(file));
	/** @type {[string, string, number][]} */
	const SHAPES = [
		['free', 'Free', 0],
		['1:1', 'Square', 1],
		['4:3', '4:3', 4 / 3],
		['16:9', '16:9', 16 / 9],
		['9:16', '9:16', 9 / 16]
	];
	/** @type {('nw' | 'ne' | 'sw' | 'se')[]} */
	const CORNERS = ['nw', 'ne', 'sw', 'se'];
	/** The smallest part kept (of the picture's side) */
	const SMALLEST = 0.02;

	let image = $state(null);
	let failed = $state('');
	let edit = $state(freshImageEdit());
	let shape = $state('free');
	let preview = $state('');
	let box = $state();
	let saving = $state({ status: 'idle', saved: null, error: '' });

	// svelte-ignore state_referenced_locally
	readImage(file, extensionOf(file.name))
		.then((read) => (image = read))
		.catch((error) => (failed = error?.message ?? "Couldn't read the picture"));

	// The turned and mirrored picture, to cut from
	$effect(() => {
		if (!image) return;
		// (only the turn and the mirrors: not drawn again for each move of the part)
		const canvas = oriented(image, {
			...freshImageEdit(),
			turns: edit.turns,
			mirrorX: edit.mirrorX,
			mirrorY: edit.mirrorY
		});
		let url = '';
		let current = true;
		canvas.toBlob((blob) => {
			if (!current || !blob) return;
			url = URL.createObjectURL(blob);
			preview = url;
		});
		return () => {
			current = false;
			if (url) setTimeout(() => URL.revokeObjectURL(url), 500);
		};
	});

	onDestroy(() => {
		if (preview) URL.revokeObjectURL(preview);
	});

	/** The turned picture's size (px) */
	let whole = $derived.by(() => {
		if (!image) return { width: 1, height: 1 };
		const sideways = edit.turns % 2 === 1;
		return sideways
			? { width: image.naturalHeight, height: image.naturalWidth }
			: { width: image.naturalWidth, height: image.naturalHeight };
	});
	let size = $derived(image ? outputSize(image, edit) : { width: 0, height: 0 });
	let ratio = $derived(SHAPES.find(([id]) => id === shape)?.[2] ?? 0);

	/** A part's height for its width in the shape (both 0–1 of the picture) */
	const heightFor = (w) => (w * whole.width) / (whole.height * ratio);

	function turn(by) {
		edit.turns = /** @type {0|1|2|3} */ ((edit.turns + by + 4) % 4);
		edit.crop = { x: 0, y: 0, w: 1, h: 1 };
		if (ratio) chooseShape(shape);
	}

	/** The biggest part of this shape, in the middle */
	function chooseShape(id) {
		shape = id;
		const wanted = SHAPES.find(([other]) => other === id)?.[2] ?? 0;
		if (!wanted) return;
		let w = 1;
		let h = (whole.width * w) / (whole.height * wanted);
		if (h > 1) {
			h = 1;
			w = (whole.height * h * wanted) / whole.width;
		}
		edit.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
	}

	const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

	function pointAt(event) {
		const rect = box.getBoundingClientRect();
		return {
			x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
			y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
		};
	}

	/** From a corner that stays (`anchor`) to the pointer, in the shape if there's one */
	function spanned(anchor, point) {
		let w = Math.max(SMALLEST, Math.abs(point.x - anchor.x));
		let h = Math.max(SMALLEST, Math.abs(point.y - anchor.y));
		const right = point.x >= anchor.x;
		const down = point.y >= anchor.y;
		if (ratio) {
			h = heightFor(w);
			const roomY = down ? 1 - anchor.y : anchor.y;
			if (h > roomY) {
				h = roomY;
				w = (whole.height * h * ratio) / whole.width;
			}
		}
		w = Math.min(w, right ? 1 - anchor.x : anchor.x);
		if (ratio) h = heightFor(w);
		return {
			x: right ? anchor.x : anchor.x - w,
			y: down ? anchor.y : anchor.y - h,
			w,
			h
		};
	}

	/** @param {'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se'} mode */
	function drag(event, mode) {
		event.preventDefault();
		event.stopPropagation();
		const start = pointAt(event);
		const was = { ...edit.crop };
		const anchor =
			mode === 'new'
				? start
				: {
						x: mode.includes('w') ? was.x + was.w : was.x,
						y: mode.includes('n') ? was.y + was.h : was.y
					};
		const move = (moved) => {
			const point = pointAt(moved);
			if (mode === 'move') {
				edit.crop = {
					...was,
					x: clamp(was.x + point.x - start.x, 0, 1 - was.w),
					y: clamp(was.y + point.y - start.y, 0, 1 - was.h)
				};
			} else edit.crop = spanned(anchor, point);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function reset() {
		edit = freshImageEdit();
		shape = 'free';
	}

	async function save(targetId) {
		const target = targets.find((option) => option.id === targetId);
		if (!target || !image) return;
		saving = { status: 'working', saved: null, error: '' };
		try {
			const saved = await saveImage(file, image, $state.snapshot(edit), target);
			saving = { status: 'done', saved, error: '' };
		} catch (error) {
			console.warn('Could not save the picture:', error);
			saving = { status: 'failed', saved: null, error: error?.message ?? String(error) };
		}
	}

	async function show(path) {
		try {
			await reveal(path);
		} catch {
			showToast("Couldn't open the folder", 'icon-[mingcute--warning-line]');
		}
	}

	let cropped = $derived(edit.crop.w < 0.999 || edit.crop.h < 0.999);
</script>

{#if failed}
	<p class="flex items-center gap-1.5 text-sm text-red-300">
		<span class="icon-[mingcute--warning-line] size-4"></span>{failed}
	</p>
{:else if !image}
	<p class="text-sm text-white/50">Reading the picture…</p>
{:else}
	<div class="flex flex-col gap-4">
		<!-- The picture, and the part kept -->
		<div
			class="grid place-items-center p-4 rounded-2xl bg-black/40 ring-1 ring-white/5 overflow-hidden isolate"
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				bind:this={box}
				class="relative max-w-full select-none touch-none cursor-crosshair"
				style="aspect-ratio: {whole.width} / {whole.height}; width: min(100%, calc(50vh * {whole.width} / {whole.height}), {whole.width}px)"
				onpointerdown={(event) => drag(event, 'new')}
			>
				{#if preview}
					<img src={preview} alt="" class="absolute inset-0 size-full" draggable="false" />
				{/if}
				<!-- Outside the part: darker -->
				<div
					class="absolute pointer-events-none ring-[9999px] ring-black/55"
					style="left: {edit.crop.x * 100}%; top: {edit.crop.y * 100}%; width: {edit.crop.w *
						100}%; height: {edit.crop.h * 100}%"
				></div>
				<div
					class="absolute border-2 border-white cursor-move"
					role="slider"
					tabindex="-1"
					aria-label="The part kept"
					aria-valuenow={Math.round(edit.crop.w * 100)}
					style="left: {edit.crop.x * 100}%; top: {edit.crop.y * 100}%; width: {edit.crop.w *
						100}%; height: {edit.crop.h * 100}%"
					onpointerdown={(event) => drag(event, 'move')}
				>
					{#each CORNERS as corner (corner)}
						<div
							class="absolute size-4 rounded-sm bg-white shadow {corner === 'nw'
								? '-left-2 -top-2 cursor-nwse-resize'
								: corner === 'ne'
									? '-right-2 -top-2 cursor-nesw-resize'
									: corner === 'sw'
										? '-left-2 -bottom-2 cursor-nesw-resize'
										: '-right-2 -bottom-2 cursor-nwse-resize'}"
							onpointerdown={(event) => drag(event, corner)}
						></div>
					{/each}
				</div>
			</div>
		</div>

		<!-- What's done to it -->
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<button
				class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition"
				onclick={() => turn(-1)}
			>
				<span class="icon-[mingcute--anticlockwise-line] size-4"></span>Turn left
			</button>
			<button
				class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold bg-white/[0.06] hover:bg-white/15 cursor-pointer transition"
				onclick={() => turn(1)}
			>
				<span class="icon-[mingcute--clockwise-line] size-4"></span>Turn right
			</button>
			<button
				aria-pressed={edit.mirrorX}
				class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {edit.mirrorX
					? 'bg-white text-black'
					: 'bg-white/[0.06] hover:bg-white/15'}"
				onclick={() => (edit.mirrorX = !edit.mirrorX)}
			>
				<span class="icon-[mingcute--flip-horizontal-line] size-4"></span>Mirror
			</button>
			<button
				aria-pressed={edit.mirrorY}
				class="h-8 px-3 flex items-center gap-1.5 rounded-full font-semibold cursor-pointer transition {edit.mirrorY
					? 'bg-white text-black'
					: 'bg-white/[0.06] hover:bg-white/15'}"
				onclick={() => (edit.mirrorY = !edit.mirrorY)}
			>
				<span class="icon-[mingcute--flip-vertical-line] size-4"></span>Upside down
			</button>

			<span class="w-px h-6 mx-1 bg-white/10"></span>
			<span class="flex items-center gap-1 text-white/60">
				<span class="icon-[ri--crop-line] size-4"></span>Cut to
			</span>
			<div
				class="inline-flex gap-0.5 p-0.5 rounded-full bg-white/[0.06]"
				role="radiogroup"
				aria-label="Shape"
			>
				{#each SHAPES as [id, label] (id)}
					<button
						role="radio"
						aria-checked={shape === id}
						class="h-7 px-2.5 rounded-full text-xs font-bold cursor-pointer transition {shape === id
							? 'bg-white text-black'
							: 'text-white/70 hover:text-white'}"
						onclick={() => chooseShape(id)}
					>
						{label}
					</button>
				{/each}
			</div>
			{#if cropped || edit.turns || edit.mirrorX || edit.mirrorY || edit.width}
				<button
					class="h-8 px-3 rounded-full font-semibold text-white/60 hover:text-white hover:bg-white/10 cursor-pointer transition"
					onclick={reset}
				>
					Undo all
				</button>
			{/if}

			<label class="ml-auto flex items-center gap-2">
				<span class="text-white/60">Width</span>
				<input
					type="number"
					min="1"
					class="w-24 h-8 px-2 rounded-lg bg-white/[0.06] tabular-nums font-semibold outline-none focus:ring-1 focus:ring-violet-300"
					aria-label="Width"
					placeholder="Full"
					value={edit.width || ''}
					onchange={(event) =>
						(edit.width = Math.max(0, Math.round(+event.currentTarget.value || 0)))}
				/>
				<span class="tabular-nums text-white/60">{size.width} × {size.height} px</span>
			</label>
		</div>

		<!-- Saved as -->
		<div
			class="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 pl-4 rounded-2xl bg-violet-300/[0.07] ring-1 ring-violet-300/20"
		>
			<span class="text-sm font-semibold text-violet-100">
				{saving.status === 'working' ? 'Saving…' : 'Save as'}
			</span>
			<Formats {targets} onpick={save} label="Save as" disabled={saving.status === 'working'} />
		</div>
		{#if saving.status === 'done' && saving.saved}
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<button
					class="h-8 pl-2.5 pr-3 flex items-center gap-1.5 rounded-full font-semibold text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 cursor-pointer transition"
					title="Show it in the folder"
					onclick={() => show(saving.saved.path)}
				>
					<span class="icon-[mingcute--check-circle-fill] size-4"></span>
					Saved: {saving.saved.name}
				</button>
				<span class="text-white/50">in Stosufy/Edited</span>
			</div>
		{:else if saving.status === 'failed'}
			<p class="flex items-center gap-1.5 text-sm text-red-300">
				<span class="icon-[mingcute--warning-line] size-4"></span>
				{saving.error}
			</p>
		{/if}
	</div>
{/if}
