<script>
	// The weather where you are (Open-Meteo, no account needed): now and today's high and low
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import { widgetData, setWidgetData } from '#lib/stores/widgetData.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'weather' } = $props();

	let place = $derived($widgetData[uid]?.place ?? null);
	let weather = $state(null);
	let error = $state('');
	let asking = $state(false);
	let query = $state('');

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

	async function choose() {
		const name = query.trim();
		if (!name) return;
		try {
			const result = await (
				await fetch(
					`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`
				)
			).json();
			const found = result.results?.[0];
			if (!found) {
				error = `"${name}" wasn't found`;
				return;
			}
			setWidgetData(uid, {
				place: { name: found.name, lat: found.latitude, lon: found.longitude }
			});
			asking = false;
			query = '';
		} catch {
			error = "Couldn't look up the place";
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
	{#if !place || asking}
		<form
			class="mt-auto flex flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				choose();
			}}
		>
			<input
				bind:value={query}
				placeholder="Your city"
				class="h-8 px-2.5 rounded-lg bg-white/10 text-sm outline-none ring-1 ring-white/10 focus:ring-white/30"
			/>
			<button
				class="h-8 rounded-lg bg-white/15 text-sm font-semibold cursor-pointer hover:bg-white/25"
				>Show weather</button
			>
			{#if error}<p class="text-xs text-red-300">{error}</p>{/if}
		</form>
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
