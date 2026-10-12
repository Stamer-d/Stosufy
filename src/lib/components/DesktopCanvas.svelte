<script>
	import { WIDGETS, DEFAULT_WIDGETS } from '#lib/widgets.ts';
	import { userSettings, updateHomeSettings } from '#lib/stores/user.ts';

	/** @type {{ editing?: boolean }} */
	let { editing = false } = $props();

	const PADDING = 24;
	const GRID = 8;

	let width = $state(0);
	let height = $state(0);
	let sizes = $state({});
	let dragging = $state(null);

	let widgets = $derived($userSettings.settings?.home?.widgets ?? DEFAULT_WIDGETS);

	// Positions are fractions of the free space, so widgets keep their place when the
	// window is resized and never end up outside of it
	function wanted(widget) {
		const size = sizes[widget.uid] ?? { w: 0, h: 0 };
		const freeX = Math.max(width - size.w - 2 * PADDING, 0);
		const freeY = Math.max(height - size.h - 2 * PADDING, 0);
		if (dragging?.uid === widget.uid) return { left: dragging.left, top: dragging.top };
		return { left: PADDING + widget.x * freeX, top: PADDING + widget.y * freeY };
	}

	// --- Widgets never lie on each other --------------------------------------------------
	const GAP = 12;
	const overlaps = (a, b) =>
		a.left < b.left + b.w + GAP &&
		b.left < a.left + a.w + GAP &&
		a.top < b.top + b.h + GAP &&
		b.top < a.top + a.h + GAP;

	/** The wanted place if it's free, else the nearest free one next to the other widgets */
	function resolve(rect, placed) {
		if (!placed.some((other) => overlaps(rect, other))) return rect;
		const maxLeft = Math.max(PADDING, width - rect.w - PADDING);
		const maxTop = Math.max(PADDING, height - rect.h - PADDING);
		// Candidates: the wanted place lined up with the others' edges (beside, above, below)
		const xs = [rect.left, PADDING, maxLeft];
		const ys = [rect.top, PADDING, maxTop];
		for (const other of placed) {
			xs.push(other.left + other.w + GAP, other.left - rect.w - GAP, other.left);
			ys.push(other.top + other.h + GAP, other.top - rect.h - GAP, other.top);
		}
		let best = null;
		let bestDistance = Infinity;
		for (const x of xs) {
			if (x < PADDING || x > maxLeft) continue;
			for (const y of ys) {
				if (y < PADDING || y > maxTop) continue;
				const candidate = { ...rect, left: x, top: y };
				if (placed.some((other) => overlaps(candidate, other))) continue;
				const distance = (x - rect.left) ** 2 + (y - rect.top) ** 2;
				if (distance < bestDistance) {
					bestDistance = distance;
					best = candidate;
				}
			}
		}
		// No room anywhere: where it was wanted
		return best ?? rect;
	}

	/** Where each widget is shown: in order, each in the nearest free place (the one being
	 * dragged last, so it moves around the others instead of pushing them) */
	let layout = $derived.by(() => {
		const order = dragging
			? [
					...widgets.filter((widget) => widget.uid !== dragging.uid),
					...widgets.filter((widget) => widget.uid === dragging.uid)
				]
			: widgets;
		const placed = [];
		const result = {};
		for (const widget of order) {
			const size = sizes[widget.uid];
			const rect = { ...wanted(widget), w: size?.w ?? 0, h: size?.h ?? 0 };
			// Not measured yet: it takes no room
			const spot = rect.w && rect.h ? resolve(rect, placed) : rect;
			if (rect.w && rect.h) placed.push(spot);
			result[widget.uid] = { left: spot.left, top: spot.top };
		}
		return result;
	});

	function position(widget) {
		return layout[widget.uid] ?? wanted(widget);
	}

	function startDrag(event, widget) {
		if (!editing || event.button !== 0 || event.target.closest('[data-remove]')) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const { left, top } = position(widget);
		dragging = {
			uid: widget.uid,
			left,
			top,
			startX: event.clientX,
			startY: event.clientY,
			originLeft: left,
			originTop: top
		};
	}

	function drag(event) {
		if (!dragging) return;
		const size = sizes[dragging.uid];
		const snap = (value) => Math.round(value / GRID) * GRID;
		const clamp = (value, max) => Math.min(Math.max(value, PADDING), Math.max(max, PADDING));
		dragging.left = clamp(
			snap(dragging.originLeft + event.clientX - dragging.startX),
			width - size.w - PADDING
		);
		dragging.top = clamp(
			snap(dragging.originTop + event.clientY - dragging.startY),
			height - size.h - PADDING
		);
	}

	function endDrag() {
		if (!dragging) return;
		const size = sizes[dragging.uid];
		const freeX = Math.max(width - size.w - 2 * PADDING, 1);
		const freeY = Math.max(height - size.h - 2 * PADDING, 1);
		// Where it's shown (moved beside the others if it was dropped on one)
		const shown = layout[dragging.uid] ?? dragging;
		const x = (shown.left - PADDING) / freeX;
		const y = (shown.top - PADDING) / freeY;
		const uid = dragging.uid;
		dragging = null;
		updateHomeSettings({
			widgets: widgets.map((widget) => (widget.uid === uid ? { ...widget, x, y } : widget))
		});
	}

	function remove(uid) {
		updateHomeSettings({ widgets: widgets.filter((widget) => widget.uid !== uid) });
	}
</script>

<div class="absolute inset-0" bind:clientWidth={width} bind:clientHeight={height}>
	{#each widgets as widget (widget.uid)}
		{@const definition = WIDGETS[widget.type]}
		{#if definition}
			{@const pos = position(widget)}
			<div
				role="group"
				aria-label={definition.name}
				class="absolute w-max {editing
					? 'cursor-grab active:cursor-grabbing'
					: ''} {dragging?.uid === widget.uid
					? 'z-20 scale-[1.03]'
					: 'transition-[left,top] duration-200'}"
				style="left: {pos.left}px; top: {pos.top}px"
				bind:offsetWidth={
					() => sizes[widget.uid]?.w ?? 0, (w) => (sizes[widget.uid] = { ...sizes[widget.uid], w })
				}
				bind:offsetHeight={
					() => sizes[widget.uid]?.h ?? 0, (h) => (sizes[widget.uid] = { ...sizes[widget.uid], h })
				}
				onpointerdown={(e) => startDrag(e, widget)}
				onpointermove={drag}
				onpointerup={endDrag}
				onpointercancel={endDrag}
			>
				<div class={editing ? 'pointer-events-none' : ''}>
					<definition.component />
				</div>
				{#if editing}
					<div
						class="absolute -inset-1.5 rounded-[1.9rem] outline-2 outline-dashed outline-white/60 pointer-events-none"
					></div>
					<button
						data-remove
						aria-label="Remove {definition.name}"
						title="Remove"
						class="absolute -top-2.5 -left-2.5 size-6 grid place-items-center rounded-full bg-white text-black shadow-lg cursor-pointer hover:scale-110 transition"
						onclick={() => remove(widget.uid)}
					>
						<span class="icon-[mingcute--minimize-line] size-3.5"></span>
					</button>
				{/if}
			</div>
		{/if}
	{/each}
</div>
