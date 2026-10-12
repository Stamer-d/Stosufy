<script>
	// What storm chasers look at, for the next 24 hours where you are (Open-Meteo): the energy
	// for storms (CAPE), how unstable the air is (lifted index), the wind shear that
	// organizes them, gusts and dew point, as one risk level
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf } from '#lib/stores/widgetData.ts';
	import { goto } from '$app/navigation';
	import { LEVELS, stormOutlook } from '#lib/storm.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'storm' } = $props();

	let place = $derived(placeOf($widgetData, uid));
	let asking = $state(false);
	let storm = $state(null);
	let error = $state('');

	async function load() {
		if (!place) return;
		try {
			storm = await stormOutlook(place.lat, place.lon);
			error = '';
		} catch {
			error = "Couldn't load the forecast";
		}
	}

	$effect(() => {
		void place;
		load();
	});
	onMount(() => {
		const timer = setInterval(load, 30 * 60 * 1000);
		return () => clearInterval(timer);
	});

	const widest = $derived(Math.max(500, ...(storm?.hours.map((x) => x.cape) ?? [])));
	const capeColour = (cape) =>
		cape >= 2000
			? '#d946ef'
			: cape >= 1000
				? '#f43f5e'
				: cape >= 500
					? '#fb923c'
					: cape >= 100
						? '#facc15'
						: '#4ade8066';
</script>

<Widget size="medium">
	{#if !place || asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[mingcute--thunderstorm-line] size-3.5"></span> Storm potential
		</p>
		<PlacePicker {uid} label="Show storm potential" ondone={() => (asking = false)} />
	{:else if storm}
		{@const level = LEVELS[storm.level]}
		<div class="flex items-center gap-2">
			<span class="icon-[mingcute--thunderstorm-fill] size-4" style="color: {level.colour}"></span>
			<button
				class="text-[11px] font-bold uppercase tracking-wide truncate cursor-pointer hover:underline"
				style="color: {level.colour}"
				title="Change the city"
				onclick={() => (asking = true)}>Storms · {place.name}</button
			>
			<button
				class="grid place-items-center size-6 shrink-0 ms-auto rounded-full text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
				title="Open the storm center"
				aria-label="Open the storm center"
				onclick={() => goto('/storm')}
				><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
			>
			<span
				class="px-2 py-0.5 rounded-full text-[11px] font-extrabold text-black"
				style="background: {level.colour}">{level.label}</span
			>
		</div>
		<div class="mt-2 grid grid-cols-4 gap-2">
			{#each [['CAPE', `${Math.round(storm.peak.cape)}`, 'J/kg'], ['LI', storm.li.toFixed(1), ''], ['Shear', `${Math.round(storm.shear)}`, 'm/s'], ['Gusts', `${Math.round(storm.gust * 3.6)}`, 'km/h']] as [label, value, unit] (label)}
				<div>
					<p class="text-[10px] font-bold uppercase text-white/50">{label}</p>
					<p class="text-lg font-extrabold tabular-nums leading-tight">
						{value}<span class="text-[10px] font-semibold text-white/50"> {unit}</span>
					</p>
				</div>
			{/each}
		</div>
		<!-- CAPE over the next 24 hours, a bolt where thunder is expected -->
		<div class="mt-auto flex items-end gap-px h-9">
			{#each storm.hours as hour, i (i)}
				<span
					class="relative flex-1 flex flex-col justify-end h-full"
					title="{hour.hour}:00 · {Math.round(hour.cape)} J/kg · {hour.rain}% rain"
				>
					{#if hour.thunder}
						<span
							class="absolute -top-0.5 left-1/2 -translate-x-1/2 icon-[mingcute--flash-fill] size-2.5 text-yellow-300"
						></span>
					{/if}
					<span
						class="block rounded-sm"
						style="height: {Math.max(6, (hour.cape / widest) * 100)}%; background: {capeColour(
							hour.cape
						)}"
					></span>
				</span>
			{/each}
		</div>
		<p class="mt-1 flex justify-between text-[10px] text-white/45 tabular-nums">
			<span>{storm.hours[0]?.hour}:00</span>
			<span>peak {storm.peak.hour}:00 · dew {Math.round(storm.dew)}°</span>
			<span>+24h</span>
		</p>
	{:else}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading…'}</p>
	{/if}
</Widget>
