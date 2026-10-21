<script>
	// All about an earthquake: how strong and what that usually does, when, how deep, how far
	// from you, the energy, who located it and the others around it this week (aftershocks)
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import { magColour, magClass, depthClass, energyTnt, quakeAgo } from '#lib/quakes.ts';
	import { distanceKm, bearing } from '#lib/map.ts';
	import { compass } from '#lib/storm.ts';

	/**
	 * @type {{
	 *   quake: import('#lib/quakes.ts').Quake,
	 *   all: import('#lib/quakes.ts').Quake[],
	 *   home: { lat: number, lon: number, name: string } | null,
	 *   now: number,
	 *   onclose: () => void,
	 *   onpick: (quake: import('#lib/quakes.ts').Quake) => void
	 * }}
	 */
	let { quake, all, home, now, onclose, onpick } = $props();

	let size = $derived(magClass(quake.mag));
	let km = $derived(home ? distanceKm(home, quake) : null);
	// Others around it this week: aftershocks, or a swarm
	let around = $derived(
		all.filter(
			(other) =>
				other.id !== quake.id &&
				Math.abs(other.lat - quake.lat) < 0.6 &&
				distanceKm(quake, other) <= 50
		)
	);
	let strongestAround = $derived(
		around.reduce((best, other) => (!best || other.mag > best.mag ? other : best), null)
	);
	let fromUsgs = $derived(quake.id.startsWith('usgs:'));

	const depthText = (depth) => `${depth < 10 ? depth.toFixed(1) : Math.round(depth)} km`;
	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	const utc = (ms) => `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
	const coords = (q) =>
		`${Math.abs(q.lat).toFixed(2)}° ${q.lat >= 0 ? 'N' : 'S'}, ${Math.abs(q.lon).toFixed(2)}° ${q.lon >= 0 ? 'E' : 'W'}`;
</script>

<header class="p-4 pb-3 border-b border-white/[0.06]">
	<div class="flex items-start gap-3">
		<span
			class="flex flex-col items-center justify-center size-14 shrink-0 rounded-2xl text-black"
			style="background: {magColour(quake.mag)}"
		>
			<span class="text-xl font-extrabold leading-none tabular-nums">{quake.mag.toFixed(1)}</span>
			<span class="text-[10px] font-bold">{quake.magType}</span>
		</span>
		<div class="min-w-0 flex-1">
			<p class="font-bold leading-tight">{quake.region || 'Earthquake'}</p>
			<p class="mt-0.5 text-sm text-white/60">
				<span class="font-semibold" style="color: {magColour(quake.mag)}">{size.label}</span>
				· {quakeAgo(quake.time, now)}
			</p>
		</div>
		<button
			class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Close"
			onclick={onclose}><span class="icon-[mingcute--close-line] size-4"></span></button
		>
	</div>
</header>
<div class="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
	<p class="text-sm text-white/75">
		{size.effect}<span class="text-white/40"
			>{quake.depth >= 70 ? ' (but it was deep: felt less)' : ''}</span
		>
	</p>
	<div class="grid grid-cols-2 gap-2">
		{#each [['Time', clock(quake.time), utc(quake.time)], ['Depth', depthText(quake.depth), depthClass(quake.depth)], ['Distance', km == null ? '–' : `${Math.round(km).toLocaleString()} km ${compass(bearing(home, quake))}`, home ? `from ${home.name}` : ''], ['Where', coords(quake), ''], ['Energy', `≈ ${energyTnt(quake.mag)} TNT`, 'set free by the quake'], ['Located by', quake.source, fromUsgs ? 'via the USGS' : quake.source === 'EMSC' ? '' : 'via the EMSC']] as [label, value, hint] (label)}
			<div class="p-2.5 rounded-xl bg-white/[0.04] min-w-0">
				<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">{label}</p>
				<p class="text-sm font-bold tabular-nums leading-snug">{value}</p>
				{#if hint}<p class="text-[11px] text-white/45 truncate">{hint}</p>{/if}
			</div>
		{/each}
	</div>
	<div class="p-3 rounded-xl bg-white/[0.04]">
		<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">Around it this week</p>
		{#if strongestAround}
			<p class="mt-0.5 text-sm">
				<strong class="tabular-nums">{around.length}</strong> more within 50 km, the strongest
				<button
					class="font-bold tabular-nums cursor-pointer hover:underline"
					style="color: {magColour(strongestAround.mag)}"
					onclick={() => onpick(strongestAround)}>M{strongestAround.mag.toFixed(1)}</button
				>
				{quakeAgo(strongestAround.time, now)}
			</p>
			<p class="mt-0.5 text-[11px] text-white/45">Aftershocks, or a swarm of quakes</p>
		{:else}
			<p class="mt-0.5 text-sm text-white/70">No other quakes within 50 km</p>
		{/if}
	</div>
	{#if quake.url}
		<button
			class="flex items-center justify-center gap-2 h-10 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-semibold cursor-pointer"
			onclick={() => openUrl(quake.url)}
			><span class="icon-[mingcute--external-link-line] size-4"></span>More at the {fromUsgs
				? 'USGS'
				: 'EMSC'}</button
		>
	{/if}
</div>
<footer class="px-4 py-2.5 border-t border-white/[0.06] text-[11px] text-white/40">
	Times in your time zone · effects are what a quake of this size usually does near its centre
</footer>
