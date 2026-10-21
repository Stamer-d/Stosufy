<script>
	// The weather where you are (Open-Meteo, no account needed): now, on a sky that looks like
	// it, with today's high and low; it opens the weather center
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import WeatherIcon from '../storm/WeatherIcon.svelte';
	import { widgetData, placeOf, detectedPlace } from '#lib/stores/widgetData.ts';
	import { skyOf, moodOf, SKY_GRADIENTS } from '#lib/weather.ts';
	import PlacePicker from './PlacePicker.svelte';

	/** @type {{ uid?: string }} */
	let { uid = 'weather' } = $props();

	let place = $derived(placeOf($widgetData, uid) ?? $detectedPlace);
	let weather = $state(null);
	let error = $state('');
	let asking = $state(false);

	async function load() {
		if (!place) return;
		try {
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
			const data = await (await fetch(url)).json();
			weather = {
				temp: Math.round(data.current.temperature_2m),
				code: data.current.weather_code,
				day: data.current.is_day === 1,
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

<Widget
	size="small"
	label={weather && !asking ? '' : 'Weather'}
	icon="icon-[mingcute--sun-fill]"
	class={weather && !asking
		? `bg-linear-to-br ${SKY_GRADIENTS[moodOf(weather.code, weather.day)]}`
		: ''}
>
	{#if !place && !asking}
		<p class="mt-auto text-sm text-white/60">Finding where you are…</p>
	{:else if asking}
		<PlacePicker {uid} label="Show weather" ondone={() => (asking = false)} />
	{:else if weather}
		<div class="flex items-start justify-between gap-1">
			<button
				class="min-w-0 text-start text-sm font-bold truncate cursor-pointer hover:underline"
				title="Change the city"
				onclick={() => (asking = true)}>{place.name}</button
			>
			<button
				class="grid place-items-center size-6 shrink-0 -me-1 -mt-0.5 rounded-full text-white/70 hover:text-white hover:bg-white/15 cursor-pointer"
				title="Open the weather"
				aria-label="Open the weather"
				onclick={() => goto('/storm?mode=forecast')}
				><span class="icon-[mingcute--fullscreen-2-line] size-3.5"></span></button
			>
		</div>
		<WeatherIcon
			code={weather.code}
			day={weather.day}
			size={58}
			class="absolute right-2.5 top-8 drop-shadow-lg"
		/>
		<p class="mt-auto text-[2.6rem] font-extrabold tabular-nums leading-none tracking-tight">
			{weather.temp}°
		</p>
		<p class="mt-1 text-xs font-semibold truncate">{skyOf(weather.code).label}</p>
		<p class="text-xs text-white/70 tabular-nums">H {weather.high}° · L {weather.low}°</p>
	{:else}
		<p class="mt-auto text-sm text-white/60">{error || 'Loading…'}</p>
	{/if}
</Widget>
