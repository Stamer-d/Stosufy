<script>
	// What storm chasers look at, for the next 24 hours where you are (Open-Meteo): the energy
	// for storms (CAPE), how unstable the air is (lifted index), the wind shear that
	// organizes them, gusts and dew point, as one risk level
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf } from '#lib/stores/widgetData.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'storm' } = $props();

	let place = $derived(placeOf($widgetData, uid));
	let asking = $state(false);
	let storm = $state(null);
	let error = $state('');

	const LEVELS = [
		{ label: 'Quiet', colour: '#4ade80' },
		{ label: 'Marginal', colour: '#facc15' },
		{ label: 'Slight', colour: '#fb923c' },
		{ label: 'Enhanced', colour: '#f43f5e' },
		{ label: 'High', colour: '#d946ef' }
	];

	/** The wind vector (m/s, the way it blows to) */
	const vector = (speed, from) => {
		const rad = (from * Math.PI) / 180;
		return [-speed * Math.sin(rad), -speed * Math.cos(rad)];
	};

	async function load() {
		if (!place) return;
		try {
			const hourly = [
				'cape',
				'lifted_index',
				'wind_gusts_10m',
				'dew_point_2m',
				'precipitation_probability',
				'wind_speed_10m',
				'wind_direction_10m',
				'wind_speed_500hPa',
				'wind_direction_500hPa',
				'weather_code'
			].join(',');
			const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&hourly=${hourly}&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
			const data = await (await fetch(url)).json();
			const h = data.hourly;
			// The next 24 hours from now (times are local to the place)
			const now = Date.now();
			const offset = (data.utc_offset_seconds ?? 0) * 1000;
			const start = Math.max(
				0,
				h.time.findIndex((t) => new Date(t + 'Z').getTime() - offset > now - 3600e3)
			);
			const hours = h.time.slice(start, start + 24).map((t, j) => {
				const i = start + j;
				const [u1, v1] = vector(h.wind_speed_10m[i] ?? 0, h.wind_direction_10m[i] ?? 0);
				const [u2, v2] = vector(h.wind_speed_500hPa[i] ?? 0, h.wind_direction_500hPa[i] ?? 0);
				return {
					hour: Number(t.slice(11, 13)),
					cape: h.cape[i] ?? 0,
					li: h.lifted_index[i] ?? 0,
					gust: h.wind_gusts_10m[i] ?? 0,
					dew: h.dew_point_2m[i] ?? 0,
					rain: h.precipitation_probability[i] ?? 0,
					shear: Math.hypot(u2 - u1, v2 - v1),
					thunder: (h.weather_code[i] ?? 0) >= 95
				};
			});
			const peak = hours.reduce((a, b) => (b.cape > a.cape ? b : a), hours[0]);
			const shear = Math.max(...hours.map((x) => x.shear));
			const li = Math.min(...hours.map((x) => x.li));
			const thunder = hours.find((x) => x.thunder);
			let level = 0;
			if (peak.cape >= 100 || thunder) level = 1;
			if (peak.cape >= 500 && (peak.shear >= 10 || li <= -2)) level = 2;
			if (peak.cape >= 1000 && peak.shear >= 15) level = 3;
			if (peak.cape >= 2000 && peak.shear >= 20) level = 4;
			storm = {
				hours,
				peak,
				shear,
				li,
				thunder,
				level,
				gust: Math.max(...hours.map((x) => x.gust)),
				dew: Math.max(...hours.map((x) => x.dew))
			};
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
			<span
				class="ms-auto px-2 py-0.5 rounded-full text-[11px] font-extrabold text-black"
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
