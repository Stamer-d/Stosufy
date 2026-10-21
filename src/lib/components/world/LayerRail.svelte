<script>
	// A category's layers, each on or off with how it's doing (how many, loading, failed,
	// zoom in for it), and pinned ones of other categories. A pinned layer is shown in every
	// category. Under them the category's coloured maps, one at a time.

	/**
	 * @type {{
	 *   layers: import('#lib/world/registry.ts').LayerInfo[],
	 *   others: import('#lib/world/registry.ts').LayerInfo[],
	 *   on: Record<string, boolean>,
	 *   pinned: string[],
	 *   status: Record<string, { state?: string, count?: number, error?: string, live?: boolean } | undefined>,
	 *   fields?: import('#lib/world/types.ts').FieldSource[],
	 *   fieldId?: string | null,
	 *   fieldState?: { state: string, error?: string },
	 *   ontoggle: (id: string) => void,
	 *   onpin: (id: string) => void,
	 *   onfield?: (id: string | null) => void
	 * }}
	 */
	let {
		layers,
		others,
		on,
		pinned,
		status,
		fields = [],
		fieldId = null,
		fieldState = { state: 'off' },
		ontoggle,
		onpin,
		onfield = () => {}
	} = $props();
</script>

{#snippet row(layer)}
	{@const s = status[layer.id]}
	<div
		class="group flex items-center rounded-xl transition {on[layer.id]
			? 'bg-white/10 text-white'
			: 'text-white/45 hover:text-white/80 hover:bg-white/[0.04]'}"
	>
		<button
			class="flex-1 min-w-0 flex items-center gap-2.5 h-9 pl-2.5 text-sm font-medium cursor-pointer"
			aria-pressed={!!on[layer.id]}
			title={layer.hint}
			onclick={() => ontoggle(layer.id)}
		>
			<span class="{layer.icon} size-[18px] shrink-0"></span>
			<span class="flex-1 text-start truncate">{layer.label}</span>
			{#if on[layer.id] && s}
				{#if s.state === 'loading'}
					<span class="icon-[mingcute--loading-line] size-3.5 animate-spin text-white/40"></span>
				{:else if s.state === 'error'}
					<span class="text-[11px] font-bold text-rose-300" title={s.error}>!</span>
				{:else if s.state === 'zoom'}
					<span class="text-[10px] text-white/40 whitespace-nowrap">zoom in</span>
				{:else if s.state === 'unavailable'}
					<span class="text-[10px] text-white/40 whitespace-nowrap" title={s.error}>not set up</span
					>
				{:else if s.live !== undefined}
					<span
						class="size-1.5 rounded-full {s.live ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}"
						title={s.live ? 'Live' : 'Connecting'}
					></span>
				{:else if s.count !== undefined}
					<span class="text-[11px] tabular-nums text-white/50">{s.count.toLocaleString()}</span>
				{/if}
			{/if}
		</button>
		<button
			class="grid place-items-center size-7 me-1 rounded-lg cursor-pointer transition {pinned.includes(
				layer.id
			)
				? 'text-sky-300'
				: 'text-white/0 group-hover:text-white/40 hover:!text-white'}"
			title={pinned.includes(layer.id)
				? 'Pinned: shown in every category. Click to show it only here'
				: 'Pin: show it in every category'}
			aria-label={pinned.includes(layer.id) ? `Unpin ${layer.label}` : `Pin ${layer.label}`}
			aria-pressed={pinned.includes(layer.id)}
			onclick={() => onpin(layer.id)}
			><span
				class="{pinned.includes(layer.id)
					? 'icon-[mingcute--pin-fill]'
					: 'icon-[mingcute--pin-line]'} size-3.5"
			></span></button
		>
	</div>
{/snippet}

<div class="flex flex-col gap-0.5 p-1.5">
	<p class="px-2 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
		Layers
	</p>
	{#each layers as layer (layer.id)}
		{@render row(layer)}
	{/each}
	{#if others.length}
		<p class="px-2 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
			Pinned from elsewhere
		</p>
		{#each others as layer (layer.id)}
			{@render row(layer)}
		{/each}
	{/if}
	{#if fields.length}
		<p
			class="flex items-center gap-2 px-2 pt-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40"
		>
			Maps
			{#if fieldId && fieldState.state === 'loading'}
				<span class="icon-[mingcute--loading-line] size-3 animate-spin"></span>
			{:else if fieldId && fieldState.state === 'error'}
				<span class="text-rose-300 normal-case tracking-normal" title={fieldState.error}
					>couldn't load</span
				>
			{/if}
		</p>
		{#each fields as f (f.id)}
			<button
				class="flex items-center gap-2.5 h-9 px-2.5 rounded-xl text-sm font-medium cursor-pointer transition {fieldId ===
				f.id
					? 'bg-white text-black'
					: 'text-white/60 hover:text-white hover:bg-white/[0.06]'}"
				title={f.hint}
				aria-pressed={fieldId === f.id}
				onclick={() => onfield(fieldId === f.id ? null : f.id)}
			>
				<span class="{f.icon} size-[18px]"></span>
				<span class="flex-1 text-start truncate">{f.label}</span>
			</button>
		{/each}
	{/if}
</div>
