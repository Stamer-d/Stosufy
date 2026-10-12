<script>
	// The weather where you are (Open-Meteo, no account needed): now and today's high and low
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import { widgetData, placeOf, detectedPlace } from '#lib/stores/widgetData.ts';
	import PlacePicker from './PlacePicker.svelte';

	/** @type {{ uid?: string }} */
	let { uid = 'weather' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let weather = $state(null);
	let error = $state('');
	let asking = $state(false);

	// WMO weather codes as icons and words
	/** @type {[number[], string, string][]} */
	const KINDS = [
		[[0], 'icon-[mingcute--sun-fill]', 'Clear'],
		[[1, 2], 'icon-[mingcute--sun-cloudy-fill]', 'Partly cloudy'],
		[[3], 'icon-[mingcute--cloud-fill]', 'Cloudy'],
		[[45, 48], 'icon-[mingcute--fog-fill]', 'Fog'],
		[[51, 53, 55, 56, 57], 'icon-[mingcute--drizzle-fill]', 'Drizzle'],
		[[61, 63, 65, 66, 67, 80, 81, 82], 'icon-[mingcute--rain-fill]', 'Rain'],
		[[71, 73, 75, 77, 85, 86], 'icon-[mingcute--snow-fill]', 'Snow'],
		[[95, 96, 99], 'icon-[mingcute--thunderstorm-fill]', 'Thunderstorm']
	];
	const kind = (code) => KINDS.find(([codes]) => codes.includes(code)) ?? KINDS[2];

	async function load() {
		if (!place) return;
		try {
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
			const data = await (await fetch(url)).json();
			weather = {
				temp: Math.round(data.current.temperature_2m),
				code: data.current.weather_code,
				high: Math.round(data.daily.temperature_2m_max[0]),
				low: Math.round(data.daily.temperature_2m_min[0])
			};
			error = '';
		} catch {
			error = "Couldn't load the weather";
		}
	}

	$effect(() => {
		void place;
		load();
	});
	onMount(() => {
		const timer = setInterval(load, 15 * 60 * 1000);
		return () => clearInterval(timer);
	});
</script>

<Widget size="small" label="Weather" icon="icon-[mingcute--sun-fill]">
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<PlacePicker {uid} label="Show weather" ondone={() => (asking = false)} />
	{:else if weather}
		{@const [, icon, word] = kind(weather.code)}
		<span class="{icon} size-9 text-amber-300"></span>
		<p class="mt-auto text-4xl font-extrabold tabular-nums leading-none">{weather.temp}°</p>
		<button
			class="text-start text-sm font-semibold truncate cursor-pointer hover:underline"
			title="Change the city"
			onclick={() => (asking = true)}>{place.name}</button
		>
		<p class="text-xs text-white/60">{word} · {weather.high}° / {weather.low}°</p>
	{:else}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading…'}</p>
	{/if}
</Widget>
