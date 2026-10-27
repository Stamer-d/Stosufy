<script>
	// A place looked at in the weather: its forecast (now, the next two hours, hour by hour, two
	// weeks), and its storm analysis the way storm chasers read it: the outlook for the next 24
	// hours (energy, instability, shear, the risk hour by hour), the model sounding and
	// hodograph, and the DWD warnings there (and those of the area clicked).
	import { untrack } from 'svelte';
	import { fastFetch as tauriFetch } from '#lib/fastFetch.ts';
	import Hodograph from '#lib/components/storm/Hodograph.svelte';
	import SkewT from '#lib/components/storm/SkewT.svelte';
	import PlaceForecast from '#lib/components/storm/PlaceForecast.svelte';
	import WeatherIcon from '#lib/components/storm/WeatherIcon.svelte';
	import {
		stormOutlook,
		stormProfile,
		levelOf,
		LEVELS,
		SEVERITY_COLOURS,
		compass
	} from '#lib/storm.ts';
	import { skyOf } from '#lib/weather.ts';

	/**
	 * @type {{
	 *   place: { lat: number, lon: number },
	 *   label: string,
	 *   areas?: import('#lib/storm.ts').WarningArea[],
	 *   forecast: import('#lib/weather.ts').PlaceWeather | null,
	 *   forecastError?: string,
	 *   onclose: () => void
	 * }}
	 */
	let { place, label, areas = [], forecast, forecastError = '', onclose } = $props();

	let outlook = $state(null);
	let alerts = $state(null);
	let probeError = $state('');
	let profile = $state(null);
	let profileAt = $state('peak');
	let tab = $state('weather');
	let air = $state('skewt');
	// Answers for a place looked at before are dropped
	let probeId = 0;
	$effect(() => {
		const p = place;
		const a = areas;
		untrack(() => load(p, a));
	});
	function load(p, a) {
		outlook = null;
		alerts = null;
		profile = null;
		probeError = '';
		if (a.length) tab = 'warnings';
		const id = ++probeId;
		stormOutlook(p.lat, p.lon)
			.then((result) => {
				if (id !== probeId) return;
				outlook = result;
				loadProfile(id);
			})
			.catch(
				(error) =>
					id === probeId &&
					(probeError = `Couldn't load the forecast${error?.message ? `: ${error.message}` : ''}`)
			);
		tauriFetch(`https://api.brightsky.dev/alerts?lat=${p.lat}&lon=${p.lon}`)
			.then((response) => (response.ok ? response.json() : { alerts: [] }))
			.then((data) => id === probeId && (alerts = data.alerts ?? []))
			.catch(() => id === probeId && (alerts = []));
	}
	function loadProfile(id = probeId) {
		const time = profileAt === 'peak' && outlook ? outlook.peak.time : Date.now();
		stormProfile(place.lat, place.lon, time)
			.then((result) => id === probeId && (profile = result))
			.catch(() => id === probeId && (profile = null));
	}
	let probeLevel = $derived(outlook ? LEVELS[outlook.level] : null);
	let widest = $derived(Math.max(500, ...(outlook?.hours.map((x) => x.cape) ?? [])));
	let nowSky = $derived(forecast ? skyOf(forecast.now.code) : null);

	const clock = (ms) =>
		new Date(ms).toLocaleString(undefined, {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	const when = (value) => (value ? clock(value) : '');
	const PANEL_TABS = [
		{ id: 'weather', label: 'Weather' },
		{ id: 'overview', label: 'Storms' },
		{ id: 'sounding', label: 'Sounding' },
		{ id: 'warnings', label: 'Warnings' }
	];
</script>

<header class="px-4 pt-3.5 pb-3 border-b border-white/[0.06]">
	<div class="flex items-center gap-3">
		<span class="grid place-items-center size-11 shrink-0 rounded-xl bg-white/[0.05]">
			{#if forecast}
				<WeatherIcon code={forecast.now.code} day={forecast.now.isDay} size={38} animated={false} />
			{:else if forecastError}
				<span class="icon-[mingcute--warning-line] size-5 text-rose-400"></span>
			{:else}
				<span class="icon-[mingcute--loading-line] size-5 animate-spin text-white/40"></span>
			{/if}
		</span>
		<div class="min-w-0 flex-1">
			<p class="font-bold truncate">{label || 'Click the map'}</p>
			<p class="text-sm text-white/60 truncate">
				{#if forecast && nowSky}
					{nowSky.label} · {Math.round(forecast.now.temp)}°
				{:else}
					{forecastError || 'Loading…'}
				{/if}
			</p>
		</div>
		<button
			class="grid place-items-center size-8 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Hide the forecast"
			onclick={onclose}><span class="icon-[mingcute--close-line] size-4"></span></button
		>
	</div>
	<div class="mt-3 grid grid-cols-4 p-1 rounded-xl bg-white/[0.05] text-xs font-semibold">
		{#each PANEL_TABS as t (t.id)}
			<button
				class="relative h-7 rounded-lg cursor-pointer transition {tab === t.id
					? 'bg-white/15 text-white'
					: 'text-white/55 hover:text-white'}"
				onclick={() => (tab = t.id)}
			>
				{t.label}
				{#if t.id === 'warnings' && (alerts?.length || areas.length)}
					<span class="absolute top-1 right-1.5 size-1.5 rounded-full bg-amber-400"></span>
				{:else if t.id === 'overview' && outlook && outlook.level > 0}
					<span
						class="absolute top-1 right-1.5 size-1.5 rounded-full"
						style="background: {LEVELS[outlook.level].colour}"
					></span>
				{/if}
			</button>
		{/each}
	</div>
</header>

<div class="flex-1 min-h-0 overflow-y-auto p-3">
	{#if tab === 'weather'}
		<PlaceForecast weather={forecast} error={forecastError} />
	{:else if tab === 'overview'}
		{#if outlook && probeLevel}
			<div class="flex items-center gap-3 p-3 mb-3 rounded-2xl bg-white/[0.04]">
				<span
					class="grid place-items-center size-10 shrink-0 rounded-xl text-black"
					style="background: {probeLevel.colour}"
				>
					<span class="icon-[mingcute--thunderstorm-fill] size-6"></span>
				</span>
				<div class="min-w-0">
					<p class="font-extrabold" style="color: {probeLevel.colour}">{probeLevel.label}</p>
					<p class="text-xs text-white/60">
						{outlook.thunder
							? `Thunder possible from ${outlook.thunder.hour}:00`
							: `Most energy at ${outlook.peak.hour}:00`}
					</p>
				</div>
			</div>
			<div class="grid grid-cols-3 gap-2">
				{#each [['CAPE', Math.round(outlook.peak.cape), 'J/kg', 'Energy for storms (500+: storms, 2000+: violent)'], ['LI', outlook.li.toFixed(1), '', 'Lifted index: below 0 unstable, below −4 very'], ['Shear', Math.round(outlook.shear), 'm/s', 'Deep shear: 20+ supercells'], ['Gusts', Math.round(outlook.gust * 3.6), 'km/h', 'Strongest gust'], ['Dew point', Math.round(outlook.dew), '°C', 'Moisture: 15+ fuels strong storms'], ['Rain', Math.max(...outlook.hours.map((x) => x.rain)), '%', 'Highest chance of rain']] as [name, value, unit, hint] (name)}
					<div class="p-2.5 rounded-xl bg-white/[0.04]" title={hint}>
						<p class="text-[10px] font-bold uppercase tracking-wide text-white/45">{name}</p>
						<p class="text-lg font-extrabold tabular-nums leading-tight">
							{value} <span class="text-[10px] font-semibold text-white/45">{unit}</span>
						</p>
					</div>
				{/each}
			</div>
			<p class="mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
				Next 24 hours · CAPE, coloured by risk
			</p>
			<div class="flex items-end gap-px h-20">
				{#each outlook.hours as h, i (i)}
					{@const level = LEVELS[levelOf(h.cape, h.li, h.shear, h.thunder)]}
					<span
						class="relative flex-1 flex flex-col justify-end h-full"
						title="{h.hour}:00 · CAPE {Math.round(h.cape)} · LI {h.li.toFixed(
							1
						)} · shear {Math.round(h.shear)} m/s · {h.rain}% rain"
					>
						{#if h.thunder}
							<span
								class="absolute -top-0.5 left-1/2 -translate-x-1/2 icon-[mingcute--flash-fill] size-2.5 text-yellow-300"
							></span>
						{/if}
						<span
							class="block rounded-sm"
							style="height: {Math.max(4, (h.cape / widest) * 100)}%; background: {level.colour}"
						></span>
					</span>
				{/each}
			</div>
			<p class="mt-1 flex justify-between text-[10px] text-white/40 tabular-nums">
				<span>{outlook.hours[0]?.hour}:00</span><span>+12 h</span><span>+24 h</span>
			</p>
			{#if profile}
				<p class="mt-5 mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
					Severe ingredients · {clock(profile.time)}
				</p>
				<div class="flex flex-wrap gap-1.5 mb-2">
					{#if profile.stp >= 1}
						<span
							class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-fuchsia-500 text-black"
							>Tornado possible</span
						>
					{/if}
					{#if profile.scp >= 1}
						<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-rose-500 text-black"
							>Supercells</span
						>
					{/if}
					{#if profile.hail}
						<span class="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-sky-300 text-black"
							>Large hail</span
						>
					{/if}
					{#if profile.cin < -100}
						<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/10"
							>Capped (CIN {Math.round(profile.cin)})</span
						>
					{/if}
					{#if profile.stp < 1 && profile.scp < 1 && !profile.hail}
						<span
							class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/[0.06] text-white/60"
							>No severe signals</span
						>
					{/if}
				</div>
				<div class="grid grid-cols-4 gap-1.5">
					{#each [['SRH 1', Math.round(profile.srh1), 'Helicity 0–1 km (100+: tornadoes)'], ['SRH 3', Math.round(profile.srh3), 'Helicity 0–3 km (150+: supercells)'], ['STP', profile.stp.toFixed(1), 'Significant tornado parameter (1+)'], ['SCP', profile.scp.toFixed(1), 'Supercell composite (1+)'], ['LCL', `${Math.round(profile.lcl)}m`, 'Cloud base (under 1000 m: tornadoes likelier)'], ['CIN', Math.round(profile.cin), 'Inhibition: the lid on storms'], ['0 °C', `${Math.round(profile.freezing)}m`, 'Freezing level (low: hail reaches the ground)'], ['Motion', `${Math.round(profile.motion.speed * 3.6)} ${compass(profile.motion.towards)}`, 'Where a right-moving supercell goes, km/h (Bunkers)']] as [name, value, hint] (name)}
						<div class="p-1.5 rounded-lg bg-white/[0.04]" title={hint}>
							<p class="text-[9px] font-bold uppercase text-white/45">{name}</p>
							<p class="text-sm font-extrabold tabular-nums truncate">{value}</p>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<p class="text-sm text-white/50">{probeError || 'Loading the outlook…'}</p>
		{/if}
	{:else if tab === 'sounding'}
		<div class="flex items-center gap-2 mb-3">
			<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
				{#each [['skewt', 'Skew-T'], ['hodograph', 'Hodograph']] as [value, name] (value)}
					<button
						class="px-2 h-6 rounded-md cursor-pointer {air === value
							? 'bg-white/15'
							: 'text-white/55 hover:text-white'}"
						onclick={() => (air = value)}>{name}</button
					>
				{/each}
			</div>
			<p class="flex-1 text-xs text-white/50 truncate">
				{profile ? clock(profile.time) : 'Loading…'}
			</p>
			<div class="flex p-0.5 rounded-lg bg-white/[0.05] text-[11px] font-semibold">
				{#each [['peak', 'Peak'], ['now', 'Now']] as [value, name] (value)}
					<button
						class="px-2 h-6 rounded-md cursor-pointer {profileAt === value
							? 'bg-white/15'
							: 'text-white/55 hover:text-white'}"
						onclick={() => {
							profileAt = value;
							profile = null;
							loadProfile();
						}}>{name}</button
					>
				{/each}
			</div>
		</div>
		{#if profile}
			<div class="grid place-items-center">
				{#if air === 'skewt'}
					<SkewT {profile} width={350} height={380} />
					<p class="mt-2 text-[11px] text-white/45">
						Red: temperature · green: dew point · dashed: a rising parcel · LCL: cloud base
					</p>
				{:else}
					<Hodograph {profile} size={350} />
					<p class="mt-2 text-[11px] text-white/45">
						Wind with height: red 0–1 km, green 1–3, yellow 3–6, blue above · RM: supercell motion
					</p>
				{/if}
			</div>
		{/if}
	{:else}
		{#if areas.length}
			<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">Clicked area</p>
			<div class="flex flex-col gap-2 mb-4">
				{#each areas as area, i (i)}
					<div
						class="p-3 rounded-xl bg-white/[0.04]"
						style="box-shadow: inset 3px 0 0 {SEVERITY_COLOURS[area.severity]}"
					>
						<p class="font-semibold">{area.headline || area.event}</p>
						<p class="text-[11px] text-white/50">{when(area.onset)} – {when(area.expires)}</p>
						{#if area.description}
							<p class="mt-1 text-xs text-white/70">{area.description}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		<p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
			DWD warnings here
		</p>
		{#if alerts === null}
			<p class="text-sm text-white/50">Loading…</p>
		{:else if !alerts.length}
			<p class="flex items-center gap-2 text-sm text-white/70">
				<span class="icon-[mingcute--check-circle-fill] size-4 text-green-400"></span>
				None (warnings cover Germany)
			</p>
		{:else}
			<div class="flex flex-col gap-2">
				{#each alerts as alert (alert.id ?? alert.alert_id ?? alert.event_en)}
					<div
						class="p-3 rounded-xl bg-white/[0.04]"
						style="box-shadow: inset 3px 0 0 {SEVERITY_COLOURS[alert.severity] ?? '#facc15'}"
					>
						<p class="font-semibold">{alert.event_en ?? alert.event_de}</p>
						<p class="text-[11px] text-white/50">
							{when(alert.onset)} – {when(alert.expires)}
						</p>
						{#if alert.description_en}
							<p class="mt-1 text-xs text-white/70">{alert.description_en}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
<footer class="px-4 py-2.5 border-t border-white/[0.06] text-[11px] text-white/40">
	Click the map for any place · drag to move · scroll to zoom
</footer>
