<script>
	// What's shown (a picture, a video) with the part kept on it: dragged anew, moved, its
	// corners pulled, in a shape if there's one. Outside it: darker. Without `active`, only
	// shown (the video plays on a click then).
	/**
	 * @type {{
	 *   width: number,
	 *   height: number,
	 *   crop: import('./crop.ts').Crop,
	 *   ratio?: number,
	 *   active?: boolean,
	 *   maxHeight?: string,
	 *   children: import('svelte').Snippet
	 * }}
	 */
	let {
		width,
		height,
		crop = $bindable(),
		ratio = 0,
		active = true,
		maxHeight = '50vh',
		children
	} = $props();

	/** @type {('nw' | 'ne' | 'sw' | 'se')[]} */
	const CORNERS = ['nw', 'ne', 'sw', 'se'];
	/** The smallest part kept (of a side) */
	const SMALLEST = 0.02;

	let box = $state();
	let cropped = $derived(crop.w < 0.999 || crop.h < 0.999);

	const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
	/** A part's height for its width in the shape (both 0–1) */
	const heightFor = (w) => (w * width) / (height * ratio);

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
				w = (height * h * ratio) / width;
			}
		}
		w = Math.min(w, right ? 1 - anchor.x : anchor.x);
		if (ratio) h = heightFor(w);
		return { x: right ? anchor.x : anchor.x - w, y: down ? anchor.y : anchor.y - h, w, h };
	}

	/** @param {'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se'} mode */
	function drag(event, mode) {
		if (!active) return;
		event.preventDefault();
		event.stopPropagation();
		const start = pointAt(event);
		const was = { ...crop };
		const anchor =
			mode === 'new'
				? start
				: {
						x: mode.includes('w') ? was.x + was.w : was.x,
						y: mode.includes('n') ? was.y + was.h : was.y
					};
		const move = (moved) => {
			const point = pointAt(moved);
			if (mode === 'move')
				crop = {
					...was,
					x: clamp(was.x + point.x - start.x, 0, 1 - was.w),
					y: clamp(was.y + point.y - start.y, 0, 1 - was.h)
				};
			else crop = spanned(anchor, point);
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	const place = $derived(
		`left: ${crop.x * 100}%; top: ${crop.y * 100}%; width: ${crop.w * 100}%; height: ${crop.h * 100}%`
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={box}
	class="relative max-w-full select-none touch-none overflow-hidden {active
		? 'cursor-crosshair'
		: ''}"
	style="aspect-ratio: {width} / {height}; width: min(100%, calc({maxHeight} * {width} / {height}), {width}px)"
	onpointerdown={(event) => drag(event, 'new')}
>
	{@render children()}
	{#if active || cropped}
		<!-- Outside the part: darker (four pieces: over a video too) -->
		<div class="pointer-events-none absolute inset-0 z-10">
			<div class="absolute inset-x-0 top-0 bg-black/55" style="height: {crop.y * 100}%"></div>
			<div
				class="absolute inset-x-0 bottom-0 bg-black/55"
				style="height: {(1 - crop.y - crop.h) * 100}%"
			></div>
			<div
				class="absolute left-0 bg-black/55"
				style="top: {crop.y * 100}%; height: {crop.h * 100}%; width: {crop.x * 100}%"
			></div>
			<div
				class="absolute right-0 bg-black/55"
				style="top: {crop.y * 100}%; height: {crop.h * 100}%; width: {(1 - crop.x - crop.w) * 100}%"
			></div>
		</div>
	{/if}
	{#if active}
		<div
			class="absolute z-20 border-2 border-white cursor-move"
			role="slider"
			tabindex="-1"
			aria-label="The part kept"
			aria-valuenow={Math.round(crop.w * 100)}
			style={place}
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
	{/if}
</div>
