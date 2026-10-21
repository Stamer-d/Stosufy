<script>
	// The storm center's earthquakes: which are shown (time, magnitude) and those in view,
	// newest or strongest first
	import { quakeStatus } from '#lib/stores/quakes.ts';
	import { QUAKE_PERIODS, QUAKE_MAGNITUDES, magColour, quakeAgo } from '#lib/quakes.ts';
	import { distanceKm } from '#lib/map.ts';

	/**
	 * @type {{
	 *   listed: import('#lib/quakes.ts').Quake[],
	 *   total: number,
	 *   strongest: import('#lib/quakes.ts').Quake | null,
	 *   loaded: boolean,
	 *   period: string,
	 *   minMag: number,
	 *   sort: string,
	 *   selectedId: string | null,
	 *   home: { lat: number, lon: number } | null,
	 *   now: number,
	 *   onchange: (change: Record<string, unknown>) => void,
	 *   onpick: (quake: import('#lib/quakes.ts').Quake) => void
	 * }}
	 */
	let {
		listed,
		total,
		strongest,
		loaded,
		period,
		minMag,
		sort,
		selectedId,
		home,
		now,
		onchange,
		onpick
	} = $props();

	const LIST_MAX = 100;
	const depthText = (km) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
</script>

<div class="p-1.5 flex flex-col gap-1.5 border-b border-white/[0.06]">
	<div class="flex items-center gap-2 px-2 pt-1 text-xs">
		<span
			class="size-1.5 shrink-0 rounded-full {$quakeStatus.state === 'live'
				? 'bg-green-400'
				: $quakeStatus.state === 'error'
					? 'bg-rose-400'
					: 'bg-amber-400 animate-pulse'}"
			title={$quakeStatus.state === 'live'
				? 'Live: each quake as soon as it is located'
				: 'Updated every 2 minutes'}
		></span>
		{#if $quakeStatus.state === 'error'}
			<span class="text-rose-200">Earthquake data not reachable</span>
		{:else if !loaded}
			<span class="text-white/55">Loading the quakes…</span>
		{:else}
			<span><strong class="tabular-nums">{total.toLocaleString()}</strong> quakes</span>
			<span class="ms-auto text-[10px] text-white/40"
				>{$quakeStatus.from === 'usgs' ? 'USGS' : 'EMSC'}</span
			>
		{/if}
	</div>
	<div class="grid grid-cols-3 p-0.5 rounded-xl bg-white/[0.05] text-xs font-semibold" role="group">
		{#each QUAKE_PERIODS as p (p.id)}
			<button
				class="h-7 rounded-lg cursor-pointer whitespace-nowrap {period === p.id
					? 'bg-white text-black'
					: 'text-white/60 hover:text-white'}"
				aria-pressed={period === p.id}
				onclick={() => onchange({ quakePeriod: p.id })}>{p.label}</button
			>
		{/each}
	</div>
	<div class="grid grid-cols-4 p-0.5 rounded-xl bg-white/[0.05] text-xs font-semibold" role="group">
		{#each QUAKE_MAGNITUDES as m (m)}
			<button
				class="h-7 rounded-lg cursor-pointer tabular-nums whitespace-nowrap {minMag === m
					? 'bg-white text-black'
					: 'text-white/60 hover:text-white'}"
				aria-pressed={minMag === m}
				title={m ? `Magnitude ${m} and more` : 'All magnitudes'}
				onclick={() => onchange({ quakeMinMag: m })}>{m ? `M${m}+` : 'All'}</button
			>
		{/each}
	</div>
	{#if strongest}
		<button
			class="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-start cursor-pointer hover:bg-white/[0.06]"
			title="The strongest in this time, anywhere"
			onclick={() => onpick(strongest)}
		>
			<span class="text-white/45">Strongest</span>
			<span class="font-bold tabular-nums" style="color: {magColour(strongest.mag)}"
				>M{strongest.mag.toFixed(1)}</span
			>
			<span class="truncate text-white/75">{strongest.region}</span>
		</button>
	{/if}
</div>
<div class="flex items-center gap-2 pl-3.5 pr-1.5 h-10 shrink-0">
	<span class="text-sm font-bold">In view</span>
	<span class="text-xs tabular-nums text-white/50">{listed.length.toLocaleString()}</span>
	<div class="ms-auto flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
		{#each [['latest', 'Latest'], ['strongest', 'Strongest']] as [value, label] (value)}
			<button
				class="px-2 h-6 rounded-md cursor-pointer {sort === value
					? 'bg-white/15'
					: 'text-white/55 hover:text-white'}"
				aria-pressed={sort === value}
				onclick={() => onchange({ quakeSort: value })}>{label}</button
			>
		{/each}
	</div>
</div>
<div class="min-h-0 overflow-y-auto border-t border-white/[0.06] p-1">
	{#if !listed.length}
		<p class="px-3 py-3 text-xs text-white/50">
			{loaded
				? 'No quakes here in this time. Zoom out, or show a longer time.'
				: 'Loading the quakes…'}
		</p>
	{/if}
	{#each listed.slice(0, LIST_MAX) as q (q.id)}
		<button
			class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-start cursor-pointer transition {selectedId ===
			q.id
				? 'bg-white/10'
				: 'hover:bg-white/[0.06]'}"
			onclick={() => onpick(q)}
		>
			<span
				class="grid place-items-center w-10 h-7 shrink-0 rounded-lg text-xs font-extrabold tabular-nums text-black"
				style="background: {magColour(q.mag)}">{q.mag.toFixed(1)}</span
			>
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-semibold truncate">{q.region || 'Earthquake'}</span>
				<span class="block text-[11px] text-white/55 truncate tabular-nums"
					>{quakeAgo(q.time, now)} · {depthText(q.depth)} deep{home
						? ` · ${Math.round(distanceKm(home, q)).toLocaleString()} km away`
						: ''}</span
				>
			</span>
		</button>
	{/each}
	{#if listed.length > LIST_MAX}
		<p class="px-3 py-2 text-[11px] text-white/45">
			And {(listed.length - LIST_MAX).toLocaleString()} more · zoom in or choose a magnitude
		</p>
	{/if}
</div>
