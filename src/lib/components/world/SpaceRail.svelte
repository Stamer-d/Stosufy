<script>
	// Under the space layers: the space weather now (the K index and NOAA's storm scales: how
	// likely the aurora is far south) and the next rocket launches, counting down
	import { onMount } from 'svelte';
	import { spaceWeather, launchList, countdown } from '#lib/world/sources/space.ts';

	/** @type {{ launches: boolean, onlaunch: (id: string) => void }} */
	let { launches, onlaunch } = $props();

	let weather = $state(null);
	let next = $state([]);
	let now = $state(Date.now());

	onMount(() => {
		const controller = new AbortController();
		const load = () => {
			spaceWeather(controller.signal)
				.then((w) => (weather = w))
				.catch(() => {});
		};
		load();
		const timer = setInterval(load, 10 * 60 * 1000);
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			controller.abort();
			clearInterval(timer);
			clearInterval(tick);
		};
	});
	$effect(() => {
		if (!launches) return;
		const controller = new AbortController();
		launchList(controller.signal)
			.then(
				(list) => (next = list.filter((l) => Date.parse(l.net) > Date.now() - 3600000).slice(0, 6))
			)
			.catch(() => (next = []));
		return () => controller.abort();
	});

	/** Kp: 5 is a minor storm (G1), 9 an extreme one (G5) */
	const kpColour = (kp) =>
		kp >= 7 ? '#ef4444' : kp >= 5 ? '#f97316' : kp >= 4 ? '#facc15' : '#4ade80';
</script>

<div class="border-t border-white/[0.06] p-1.5 flex flex-col gap-1.5">
	<p class="px-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
		Space weather
	</p>
	{#if weather}
		<div class="mx-1 grid grid-cols-4 gap-1.5 text-center">
			<div class="col-span-1 p-1.5 rounded-lg bg-white/[0.05]" title="Planetary K index (0–9)">
				<p class="text-[9px] font-bold uppercase text-white/45">Kp</p>
				<p class="text-base font-extrabold tabular-nums" style="color: {kpColour(weather.kp ?? 0)}">
					{weather.kp != null ? weather.kp.toFixed(1) : '–'}
				</p>
			</div>
			{#each [['G', 'Geomagnetic storms'], ['S', 'Solar radiation storms'], ['R', 'Radio blackouts']] as [key, label] (key)}
				<div class="p-1.5 rounded-lg bg-white/[0.05]" title="{label} (NOAA scale 0–5)">
					<p class="text-[9px] font-bold uppercase text-white/45">{key}</p>
					<p
						class="text-base font-extrabold tabular-nums {Number(weather.scales?.[key]) > 0
							? 'text-amber-300'
							: ''}"
					>
						{weather.scales?.[key] ?? '–'}
					</p>
				</div>
			{/each}
		</div>
		<p class="px-2 text-[11px] text-white/55">
			{#if weather.scales?.text}
				{weather.scales.text} geomagnetic storm: aurora further south than usual
			{:else if (weather.kp ?? 0) >= 5}
				A geomagnetic storm: aurora further south than usual
			{:else}
				Quiet: aurora only far north and south
			{/if}
		</p>
	{:else}
		<p class="px-2 text-xs text-white/45">Loading…</p>
	{/if}
	{#if launches}
		<p class="px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
			Next launches
		</p>
		{#each next as l (l.id)}
			<button
				class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-start cursor-pointer hover:bg-white/[0.06]"
				onclick={() => onlaunch(`launch:${l.id}`)}
			>
				<span class="icon-[mingcute--rocket-line] size-4 shrink-0 text-white/50"></span>
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-semibold truncate">{l.name}</span>
					<span class="block text-[11px] text-white/50 truncate"
						>{l.launch_service_provider?.name ?? ''} · {l.pad?.location?.name ?? ''}</span
					>
				</span>
				<span class="text-[11px] font-bold tabular-nums whitespace-nowrap"
					>{countdown(Date.parse(l.net), now)}</span
				>
			</button>
		{:else}
			<p class="px-2 pb-1 text-xs text-white/45">Loading the launches…</p>
		{/each}
	{/if}
</div>
