<script>
	// The air where you are now (Open-Meteo, from Copernicus' CAMS): the European air quality
	// index and what makes it, the pollen and the UV
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf, detectedPlace } from '#lib/stores/widgetData.ts';
	import { airNow, aqiLevel } from '#lib/world/sources/environment.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'air' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let asking = $state(false);
	let air = $state(null);
	let error = $state('');

	$effect(() => {
		const p = place;
		if (!p) return;
		const controller = new AbortController();
		const load = () =>
			airNow(p.lat, p.lon, controller.signal)
				.then((result) => {
					air = result;
					error = '';
				})
				.catch(() => {
					if (!controller.signal.aborted) error = "Couldn't load the air";
				});
		load();
		const timer = setInterval(load, 30 * 60 * 1000);
		return () => {
			controller.abort();
			clearInterval(timer);
		};
	});

	let level = $derived(air && isFinite(air.aqi) ? aqiLevel(air.aqi) : null);
	const shown = (v, digits = 0) => (isFinite(v) ? v.toFixed(digits) : '–');
	let parts = $derived(
		air
			? [
					['PM2.5', shown(air.pm25), 'µg/m³'],
					['PM10', shown(air.pm10), 'µg/m³'],
					['NO₂', shown(air.no2), 'µg/m³'],
					['Ozone', shown(air.o3), 'µg/m³'],
					['Pollen', shown(air.pollen), '/m³'],
					['UV', shown(air.uv, 1), '']
				]
			: []
	);
</script>

<Widget size="medium">
	<div class="flex items-center gap-1.5 mb-2">
		<span class="icon-[mingcute--leaf-line] size-3.5 text-primary-500"></span>
		<button
			class="text-[11px] font-bold uppercase tracking-wide text-primary-500 truncate cursor-pointer hover:underline"
			title="Change the city"
			onclick={() => (asking = true)}>Air · {place?.name ?? '…'}</button
		>
		<button
			class="ms-auto grid place-items-center size-5 rounded-full text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			title="Open the air quality map"
			aria-label="Open the air quality map"
			onclick={() => goto('/world?category=environment')}
			><span class="icon-[mingcute--fullscreen-2-line] size-3"></span></button
		>
	</div>
	{#if asking}
		<PlacePicker {uid} label="Show the air" ondone={() => (asking = false)} />
	{:else if !air}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading the air…'}</p>
	{:else}
		<div class="flex-1 flex items-center gap-4 min-h-0">
			<div class="flex flex-col items-center justify-center shrink-0 w-24">
				<span
					class="grid place-items-center size-16 rounded-full text-2xl font-extrabold tabular-nums text-black"
					style="background: {level?.colour ?? '#94a3b8'}">{shown(air.aqi)}</span
				>
				<span class="mt-1 text-xs font-semibold text-center leading-tight"
					>{level?.label ?? 'No data'}</span
				>
			</div>
			<div class="flex-1 grid grid-cols-3 gap-x-2 gap-y-1.5">
				{#each parts as [label, value, unit] (label)}
					<div>
						<p class="text-[9px] font-bold uppercase text-white/45">{label}</p>
						<p class="text-sm font-bold tabular-nums leading-tight">
							{value} <span class="text-[9px] font-normal text-white/45">{unit}</span>
						</p>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</Widget>
