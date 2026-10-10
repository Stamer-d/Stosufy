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
	function position(widget) {
		const size = sizes[widget.uid] ?? { w: 0, h: 0 };
		const freeX = Math.max(width - size.w - 2 * PADDING, 0);
		const freeY = Math.max(height - size.h - 2 * PADDING, 0);
		if (dragging?.uid === widget.uid) return { left: dragging.left, top: dragging.top };
		return { left: PADDING + widget.x * freeX, top: PADDING + widget.y * freeY };
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
		const x = (dragging.left - PADDING) / freeX;
		const y = (dragging.top - PADDING) / freeY;
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
