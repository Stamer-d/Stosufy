<script>
	// A place's weather like the weather apps show it: now (on a sky that looks like it: rain
	// falling, snow, stars, the sun's rays), rain in the next two hours, hour by hour with the
	// temperature as a curve, rain and the wind's direction and strength, the wind as a compass,
	// two weeks with their highs and lows, and the sun, UV, humidity, pressure and visibility
	import WeatherIcon from './WeatherIcon.svelte';
	import WindArrow from './WindArrow.svelte';
	import {
		skyOf,
		beaufort,
		BEAUFORT_NAMES,
		direction,
		temperatureCss,
		windCss,
		moodOf,
		SKY_GRADIENTS,
		WHITE
	} from '#lib/weather.ts';

	/**
	 * @type {{
	 *   weather: import('#lib/weather.ts').PlaceWeather | null,
	 *   error?: string
	 * }}
	 */
	let { weather, error = '' } = $props();
	const id = $props.id();

	let now = $derived(weather?.now ?? null);
	let today = $derived(weather?.days[0] ?? null);
	let sky = $derived(now ? skyOf(now.code) : null);
	let zone = $derived(weather?.timezone ?? 'UTC');

	const time = (ms) =>
		new Date(ms).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: zone
		});
	const dayName = (day, short = true) => {
		const index = weather?.days.findIndex((d) => d.day === day) ?? -1;
		if (index === 0) return 'Today';
		if (index === 1) return 'Tomorrow';
		return new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, {
			weekday: short ? 'short' : 'long',
			timeZone: 'UTC'
		});
	};
	const date = (day) =>
		new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const LONG = [
		'north',
		'northeast',
		'east',
		'southeast',
		'south',
		'southwest',
		'west',
		'northwest'
	];
	const from = (degrees) => LONG[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];

	// --- The sky behind "now" --------------------------------------------------------------------
	let mood = $derived(now ? moodOf(now.code, now.isDay) : 'cloudy');
	// Spread evenly, not at random (the same each time)
	const RAIN_FX = Array.from({ length: 36 }, (_, i) => ({
		left: (i * 37) % 100,
		delay: -((i * 0.27) % 1.1),
		duration: 0.55 + ((i * 7) % 5) * 0.07,
		length: 12 + ((i * 13) % 14),
		opacity: 0.18 + ((i * 11) % 5) * 0.07
	}));
	const SNOW_FX = Array.from({ length: 30 }, (_, i) => ({
		left: (i * 41) % 100,
		delay: -((i * 0.9) % 7),
		duration: 5 + ((i * 7) % 5),
		size: 2 + ((i * 3) % 3),
		sway: ((i * 17) % 20) - 10
	}));
	const STARS = Array.from({ length: 26 }, (_, i) => ({
		left: (i * 43) % 100,
		top: (i * 29) % 70,
		delay: -((i * 0.7) % 4),
		size: 1 + (i % 3) * 0.5
	}));

	// --- Rain in the next two hours ------------------------------------------------------------
	let quarters = $derived(weather?.quarters ?? []);
	let quarterMax = $derived(Math.max(0.4, ...quarters.map((q) => q.rain)));
	let soon = $derived.by(() => {
		if (!quarters.length) return null;
		const wet = (q) => q.rain >= 0.05;
		const strength = (mm) => (mm * 4 < 1 ? 'Light rain' : mm * 4 < 4 ? 'Rain' : 'Heavy rain');
		const snowy = now && WHITE.includes(skyOf(now.code).sky);
		const word = (mm) => (snowy ? 'Snow' : strength(mm));
		const first = quarters.findIndex(wet);
		if (first < 0) return { dry: true, text: 'No rain in the next two hours' };
		const peak = Math.max(...quarters.map((q) => q.rain));
		if (first === 0) {
			const end = quarters.findIndex((q) => !wet(q));
			return {
				dry: false,
				text:
					end < 0
						? `${word(peak)} for the next two hours`
						: `${word(peak)} now, stopping around ${time(quarters[end].time)}`
			};
		}
		return { dry: false, text: `${word(peak)} from ${time(quarters[first].time)}` };
	});

	// --- Hour by hour --------------------------------------------------------------------------
	const COLUMN = 54;
	const CURVE = 62;
	let hours = $derived(weather?.hours ?? []);
	let lowest = $derived(Math.min(...hours.map((h) => h.temp)));
	let highest = $derived(Math.max(...hours.map((h) => h.temp)));
	let points = $derived(
		hours.map((h, i) => ({
			x: i * COLUMN + COLUMN / 2,
			y: 20 + (1 - (h.temp - lowest) / Math.max(1, highest - lowest)) * (CURVE - 30)
		}))
	);
	/** A smooth line through points (Catmull-Rom as Bézier curves) */
	function curve(list) {
		if (!list.length) return '';
		let d = `M${list[0].x},${list[0].y}`;
		for (let i = 0; i < list.length - 1; i++) {
			const p0 = list[i - 1] ?? list[i];
			const p1 = list[i];
			const p2 = list[i + 1];
			const p3 = list[i + 2] ?? p2;
			d += ` C${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
		}
		return d;
	}
	let line = $derived(curve(points));
	let rainTop = $derived(Math.max(2, ...hours.map((h) => h.rain)));
	let strip = $state();
	/** The mouse wheel scrolls the hours sideways */
	function wheel(event) {
		if (!strip || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		const max = strip.scrollWidth - strip.clientWidth;
		if (
			(event.deltaY < 0 && strip.scrollLeft <= 0) ||
			(event.deltaY > 0 && strip.scrollLeft >= max)
		)
			return;
		event.preventDefault();
		strip.scrollLeft += event.deltaY;
	}
	let pickedDay = $state('');
	function showDay(day) {
		const index = hours.findIndex((h) => h.day === day);
		if (index < 0 || !strip) return;
		pickedDay = day;
		strip.scrollTo({ left: Math.max(0, index * COLUMN - 4), behavior: 'smooth' });
		strip.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	// --- Two weeks ---------------------------------------------------------------------------
	let days = $derived(weather?.days ?? []);
	let weekLow = $derived(Math.min(...days.map((d) => d.min)));
	let weekHigh = $derived(Math.max(...days.map((d) => d.max)));
	const along = (value) => ((value - weekLow) / Math.max(1, weekHigh - weekLow)) * 100;

	// --- Details ---------------------------------------------------------------------------
	let force = $derived(now ? beaufort(now.wind) : 0);
	let uvLabel = $derived.by(() => {
		const uv = today?.uv ?? 0;
		return uv < 3
			? 'Low'
			: uv < 6
				? 'Moderate'
				: uv < 8
					? 'High'
					: uv < 11
						? 'Very high'
						: 'Extreme';
	});
	let trend = $derived.by(() => {
		const later = hours[3];
		if (!now || !later) return 0;
		const change = later.pressure - now.pressure;
		return change > 1 ? 1 : change < -1 ? -1 : 0;
	});
	let sunAt = $derived.by(() => {
		if (!today?.sunrise || !today?.sunset || !now) return null;
		const t = (now.time - today.sunrise) / (today.sunset - today.sunrise);
		const a = Math.PI * (1 - Math.max(0, Math.min(1, t)));
		return { t, x: 70 + 58 * Math.cos(a), y: 54 - 42 * Math.sin(a) };
	});
	let dayLength = $derived.by(() => {
		if (!today?.sunrise || !today?.sunset) return '';
		const minutes = Math.round((today.sunset - today.sunrise) / 60000);
		return `${Math.floor(minutes / 60)} h ${minutes % 60} min of daylight`;
	});

	const card = 'rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.06]';
	const heading = 'text-[10px] font-bold uppercase tracking-wider text-white/45';
</script>

{#if !weather}
	<div class="flex flex-col gap-3" aria-busy="true">
		{#if error}
			<p class="flex items-center gap-2 text-sm text-rose-200">
				<span class="icon-[mingcute--warning-line] size-4 shrink-0 text-rose-400"></span>{error}
			</p>
		{:else}
			<div class="h-48 rounded-2xl bg-white/[0.05] animate-pulse"></div>
			<div class="h-20 rounded-2xl bg-white/[0.04] animate-pulse"></div>
			<div class="h-52 rounded-2xl bg-white/[0.04] animate-pulse"></div>
		{/if}
	</div>
{:else}
	<div class="flex flex-col gap-3">
		<!-- Now -->
		<section
			class="relative overflow-hidden rounded-2xl p-4 bg-linear-to-br {SKY_GRADIENTS[
				mood
			]} shadow-lg shadow-black/30"
		>
			<div class="absolute inset-0 pointer-events-none" aria-hidden="true">
				{#if mood === 'sun' || mood === 'partly'}
					<div class="sunrays"></div>
					<div class="sunglow"></div>
				{/if}
				{#if mood === 'night'}
					{#each STARS as star, i (i)}
						<span
							class="star"
							style="left: {star.left}%; top: {star.top}%; width: {star.size}px; height: {star.size}px; animation-delay: {star.delay}s"
						></span>
					{/each}
				{/if}
				{#if ['cloudy', 'dark', 'partly', 'rain', 'storm', 'snow'].includes(mood)}
					<div class="puff one"></div>
					<div class="puff two"></div>
				{/if}
				{#if mood === 'rain' || mood === 'storm'}
					{#each RAIN_FX as drop, i (i)}
						<span
							class="streak"
							style="left: {drop.left}%; height: {drop.length}px; opacity: {drop.opacity}; animation-duration: {drop.duration}s; animation-delay: {drop.delay}s"
						></span>
					{/each}
				{/if}
				{#if mood === 'snow'}
					{#each SNOW_FX as flake, i (i)}
						<span
							class="flake"
							style="left: {flake.left}%; width: {flake.size}px; height: {flake.size}px; animation-duration: {flake.duration}s; animation-delay: {flake.delay}s; --sway: {flake.sway}px"
						></span>
					{/each}
				{/if}
				{#if mood === 'storm'}
					<div class="lightning"></div>
				{/if}
			</div>
			<div class="relative flex items-start gap-2">
				<div class="flex-1 min-w-0">
					<p class="text-xs font-semibold text-white/75">Now · {time(now.time)}</p>
					<p class="mt-1 text-[64px] font-extrabold tabular-nums leading-none tracking-tight">
						{Math.round(now.temp)}°
					</p>
					<p class="mt-2 font-bold text-[15px] leading-tight">{sky.label}</p>
					<p class="text-[13px] text-white/75">
						Feels like {Math.round(now.feels)}° ·
						<span class="font-semibold">{Math.round(today.max)}°</span>
						/ {Math.round(today.min)}°
					</p>
				</div>
				<WeatherIcon
					code={now.code}
					day={now.isDay}
					size={104}
					class="-mt-2 -me-2 drop-shadow-xl"
				/>
			</div>
			<div class="relative mt-4 grid grid-cols-3 gap-1.5">
				<div class="px-2.5 py-2 rounded-xl bg-black/25">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase text-white/60">
						<WindArrow towards={now.windFrom + 180} size={12} />Wind
					</p>
					<p class="text-sm font-extrabold tabular-nums">
						{Math.round(now.wind)} <span class="text-[10px] font-semibold text-white/60">km/h</span>
					</p>
					<p class="text-[10px] text-white/60 truncate">{direction(now.windFrom)} · Bft {force}</p>
				</div>
				<div class="px-2.5 py-2 rounded-xl bg-black/25">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase text-white/60">
						<span class="icon-[mingcute--drop-fill] size-3"></span>Humidity
					</p>
					<p class="text-sm font-extrabold tabular-nums">{Math.round(now.humidity)}%</p>
					<p class="text-[10px] text-white/60 truncate">Dew point {Math.round(now.dew)}°</p>
				</div>
				<div class="px-2.5 py-2 rounded-xl bg-black/25">
					<p class="flex items-center gap-1 text-[10px] font-bold uppercase text-white/60">
						<span class="icon-[mingcute--umbrella-fill] size-3"></span>Today
					</p>
					<p class="text-sm font-extrabold tabular-nums">
						{today.rain >= 10 ? Math.round(today.rain) : today.rain.toFixed(1)}
						<span class="text-[10px] font-semibold text-white/60">mm</span>
					</p>
					<p class="text-[10px] text-white/60 truncate">{today.rainChance}% chance</p>
				</div>
			</div>
		</section>

		<!-- The next two hours -->
		{#if soon}
			<section class="{card} p-3.5">
				<div class="flex items-center gap-2">
					<span
						class="grid place-items-center size-7 rounded-full {soon.dry
							? 'bg-emerald-400/15 text-emerald-300'
							: 'bg-sky-400/20 text-sky-300'}"
					>
						<span
							class="{soon.dry
								? 'icon-[mingcute--check-line]'
								: 'icon-[mingcute--rain-line]'} size-4"
						></span>
					</span>
					<div class="min-w-0">
						<p class={heading}>Next 2 hours</p>
						<p class="text-sm font-semibold leading-tight">{soon.text}</p>
					</div>
				</div>
				<div class="mt-3 flex items-end gap-1 h-12">
					{#each quarters as q, i (q.time)}
						<div
							class="relative flex-1 h-full flex flex-col justify-end"
							title="{time(q.time)} · {q.rain} mm"
						>
							<div
								class="rounded-t-[4px] bar-grow {q.rain >= 0.05
									? 'bg-linear-to-t from-blue-600 to-sky-400'
									: 'bg-white/10'}"
								style="height: {q.rain >= 0.05
									? Math.max(10, (q.rain / quarterMax) * 100)
									: 6}%; animation-delay: {i * 40}ms"
							></div>
						</div>
					{/each}
				</div>
				<div class="mt-1 flex justify-between text-[10px] text-white/45 tabular-nums">
					<span>Now</span><span>+30</span><span>+60</span><span>+90</span><span>+120 min</span>
				</div>
			</section>
		{/if}

		<!-- Hour by hour -->
		<section class="{card} py-3">
			<p class="{heading} px-3.5 mb-1">Hour by hour</p>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="overflow-x-auto overflow-y-hidden pb-1.5" bind:this={strip} onwheel={wheel}>
				<div class="relative" style="width: {hours.length * COLUMN}px">
					{#each hours as h, i (h.time)}
						{#if i > 0 && h.hour === 0}
							<div
								class="absolute top-0 bottom-0 w-px bg-white/10"
								style="left: {i * COLUMN}px"
							></div>
						{/if}
					{/each}
					<div class="relative h-4">
						{#each hours as h, i (h.time)}
							{#if i === 0 || h.hour === 0}
								<span
									class="absolute top-0 ps-1.5 text-[10px] font-bold uppercase tracking-wide whitespace-nowrap {pickedDay ===
									h.day
										? 'text-sky-300'
										: 'text-white/55'}"
									style="left: {i * COLUMN}px">{dayName(h.day)} · {date(h.day)}</span
								>
							{/if}
						{/each}
					</div>
					<div class="flex">
						{#each hours as h, i (h.time)}
							<div class="flex flex-col items-center shrink-0" style="width: {COLUMN}px">
								<span
									class="text-[11px] font-semibold tabular-nums {i
										? 'text-white/60'
										: 'text-white'}">{i ? `${String(h.hour).padStart(2, '0')}` : 'Now'}</span
								>
								<WeatherIcon code={h.code} day={h.isDay} size={34} animated={false} />
							</div>
						{/each}
					</div>
					<svg width={hours.length * COLUMN} height={CURVE} class="block overflow-visible">
						<defs>
							<linearGradient id="{id}-temp" x1="0" y1="0" x2="1" y2="0">
								{#each hours as h, i (h.time)}
									<stop
										offset="{(i / Math.max(1, hours.length - 1)) * 100}%"
										stop-color={temperatureCss(h.temp)}
									/>
								{/each}
							</linearGradient>
							<linearGradient id="{id}-fade" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0%" stop-color="white" stop-opacity="0.22" />
								<stop offset="100%" stop-color="white" stop-opacity="0" />
							</linearGradient>
							<mask id="{id}-area">
								<rect width={hours.length * COLUMN} height={CURVE} fill="url(#{id}-fade)" />
							</mask>
						</defs>
						{#if points.length}
							<path
								d="{line} L{points[points.length - 1].x},{CURVE} L{points[0].x},{CURVE} Z"
								fill="url(#{id}-temp)"
								mask="url(#{id}-area)"
							/>
							<path
								class="draw"
								d={line}
								fill="none"
								stroke="url(#{id}-temp)"
								stroke-width="2.5"
								stroke-linecap="round"
							/>
						{/if}
						{#each hours as h, i (h.time)}
							<circle cx={points[i].x} cy={points[i].y} r="2.6" fill={temperatureCss(h.temp)} />
							<text
								x={points[i].x}
								y={points[i].y - 7}
								text-anchor="middle"
								class="fill-white text-[12px] font-bold tabular-nums">{Math.round(h.temp)}°</text
							>
						{/each}
					</svg>
					<!-- Rain -->
					<div class="flex items-end h-11 mt-1">
						{#each hours as h (h.time)}
							<div
								class="relative shrink-0 h-full flex flex-col items-center justify-end"
								style="width: {COLUMN}px"
								title="{h.rainChance}% · {h.rain} mm"
							>
								{#if h.rainChance >= 10 || h.rain >= 0.1}
									<span class="text-[10px] font-semibold tabular-nums text-sky-300/90"
										>{h.rainChance}%</span
									>
								{/if}
								<div
									class="w-5 rounded-t-[3px] bg-linear-to-t from-blue-600/90 to-sky-400/90"
									style="height: {h.rain >= 0.05 ? Math.max(3, (h.rain / rainTop) * 26) : 0}px"
								></div>
							</div>
						{/each}
					</div>
					<div class="flex border-t border-white/[0.06]">
						{#each hours as h (h.time)}
							<span
								class="shrink-0 text-center text-[10px] tabular-nums pt-0.5 {h.rain >= 0.1
									? 'text-sky-200/80'
									: 'text-white/25'}"
								style="width: {COLUMN}px"
								>{h.rain >= 0.1
									? `${h.rain >= 10 ? Math.round(h.rain) : h.rain.toFixed(1)} mm`
									: '–'}</span
							>
						{/each}
					</div>
					<!-- Wind -->
					<div class="flex mt-2">
						{#each hours as h (h.time)}
							<div class="shrink-0 flex flex-col items-center gap-0.5" style="width: {COLUMN}px">
								<span
									class="grid place-items-center size-6 rounded-full"
									style="background: {windCss(h.wind)}"
									title="From {direction(h.windFrom)}"
								>
									<WindArrow towards={h.windFrom + 180} size={14} colour="rgba(0, 0, 0, 0.8)" />
								</span>
								<span class="text-[11px] font-bold tabular-nums leading-none mt-0.5"
									>{Math.round(h.wind)}</span
								>
								<span
									class="text-[9px] tabular-nums leading-none {h.gust >= 50
										? 'text-amber-300 font-bold'
										: 'text-white/40'}">↑{Math.round(h.gust)}</span
								>
							</div>
						{/each}
					</div>
				</div>
			</div>
			<p class="px-3.5 mt-1.5 text-[10px] text-white/35">Wind and gusts in km/h</p>
		</section>

		<!-- Wind -->
		<section class="{card} p-3.5 flex items-center gap-4">
			<svg viewBox="0 0 120 120" class="size-28 shrink-0">
				<circle
					cx="60"
					cy="60"
					r="54"
					fill="rgba(255,255,255,0.03)"
					stroke="rgba(255,255,255,0.12)"
				/>
				{#each Array.from({ length: 36 }, (_, i) => i * 10) as a (a)}
					<line
						x1="60"
						y1={a % 90 === 0 ? 9 : 8}
						x2="60"
						y2={a % 90 === 0 ? 16 : a % 30 === 0 ? 13 : 11}
						stroke={a % 90 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.22)'}
						stroke-width={a % 90 === 0 ? 2 : 1}
						transform="rotate({a} 60 60)"
					/>
				{/each}
				{#each [['N', 60, 27], ['E', 94, 64], ['S', 60, 100], ['W', 26, 64]] as [name, x, y] (name)}
					<text {x} {y} text-anchor="middle" class="fill-white/60 text-[10px] font-bold"
						>{name}</text
					>
				{/each}
				<g class="needle" style="transform: rotate({now.windFrom + 180}deg)">
					<g class="sway">
						<path d="M60 20 L68 44 L60 39 L52 44 Z" fill={windCss(now.wind)} />
						<line
							x1="60"
							y1="40"
							x2="60"
							y2="92"
							stroke={windCss(now.wind)}
							stroke-width="3"
							stroke-linecap="round"
						/>
						<circle
							cx="60"
							cy="96"
							r="3.5"
							fill="none"
							stroke={windCss(now.wind)}
							stroke-width="2"
						/>
					</g>
				</g>
				<circle cx="60" cy="60" r="17" fill="#15181d" stroke="rgba(255,255,255,0.12)" />
				<text
					x="60"
					y="62"
					text-anchor="middle"
					class="fill-white text-[15px] font-extrabold tabular-nums">{Math.round(now.wind)}</text
				>
				<text x="60" y="72" text-anchor="middle" class="fill-white/50 text-[7px] font-semibold"
					>km/h</text
				>
			</svg>
			<div class="min-w-0 flex-1">
				<p class={heading}>Wind</p>
				<p class="text-lg font-extrabold leading-tight">{BEAUFORT_NAMES[force]}</p>
				<p class="text-[13px] text-white/70">From the {from(now.windFrom)} · Beaufort {force}</p>
				<p class="mt-1 text-[13px]">
					Gusts up to <span class="font-bold" style="color: {windCss(now.gust)}"
						>{Math.round(now.gust)} km/h</span
					>
				</p>
				<div class="mt-2 flex gap-[2px]" title="Beaufort scale">
					{#each Array.from({ length: 13 }, (_, i) => i) as b (b)}
						<span
							class="h-1.5 flex-1 rounded-full transition"
							style="background: {windCss(
								[0, 3, 9, 16, 24, 34, 44, 56, 68, 82, 96, 110, 125][b]
							)}; opacity: {b <= force ? 1 : 0.18}"
						></span>
					{/each}
				</div>
			</div>
		</section>

		<!-- Two weeks -->
		<section class="{card} py-2">
			<p class="{heading} px-3.5 pt-1 pb-1.5">14 days</p>
			{#each days as d, i (d.day)}
				{@const reachable = hours.some((h) => h.day === d.day)}
				<button
					class="w-full flex items-center gap-2 px-3.5 h-11 text-start transition {reachable
						? 'cursor-pointer hover:bg-white/[0.05]'
						: 'cursor-default'} {pickedDay === d.day ? 'bg-white/[0.06]' : ''}"
					title={reachable ? 'Show its hours' : ''}
					onclick={() => reachable && showDay(d.day)}
				>
					<span class="w-[4.6rem] shrink-0 leading-tight">
						<span class="block text-[13px] font-bold truncate">{dayName(d.day)}</span>
						<span class="block text-[10px] text-white/45">{date(d.day)}</span>
					</span>
					<WeatherIcon code={d.code} size={30} animated={false} />
					<span class="w-9 shrink-0 text-[11px] font-semibold tabular-nums text-sky-300">
						{#if d.rainChance >= 10}{d.rainChance}%{/if}
					</span>
					<span class="w-8 shrink-0 text-end text-[13px] tabular-nums text-white/55"
						>{Math.round(d.min)}°</span
					>
					<span class="relative flex-1 h-1.5 rounded-full bg-white/[0.08]">
						<span
							class="absolute inset-y-0 rounded-full"
							style="left: {along(d.min)}%; right: {100 -
								along(d.max)}%; background: linear-gradient(90deg, {temperatureCss(
								d.min
							)}, {temperatureCss(d.max)})"
						></span>
						{#if i === 0}
							<span
								class="absolute top-1/2 size-2.5 -mt-[5px] -ml-[5px] rounded-full bg-white ring-2 ring-[#15181d]"
								style="left: {along(now.temp)}%"
								title="Now"
							></span>
						{/if}
					</span>
					<span class="w-8 shrink-0 text-[13px] font-bold tabular-nums">{Math.round(d.max)}°</span>
					<span title="Wind up to {Math.round(d.wind)} km/h, gusts {Math.round(d.gust)} km/h">
						<WindArrow towards={d.windFrom + 180} size={13} colour={windCss(d.wind)} />
					</span>
				</button>
			{/each}
		</section>

		<!-- Details -->
		<div class="grid grid-cols-2 gap-3">
			<section class="{card} p-3.5 col-span-2">
				<div class="flex items-center justify-between">
					<p class={heading}>Sun</p>
					<p class="text-[11px] text-white/45">{dayLength}</p>
				</div>
				<div class="flex items-end gap-3">
					<div class="w-[4.5rem] shrink-0 whitespace-nowrap">
						<p class="flex items-center gap-1 text-[10px] text-white/50">
							<span class="icon-[mingcute--sunrise-line] size-3.5 text-amber-300"></span>Sunrise
						</p>
						<p class="font-bold tabular-nums">{today.sunrise ? time(today.sunrise) : '–'}</p>
					</div>
					<svg viewBox="0 0 140 60" class="flex-1 h-16 overflow-visible">
						<line x1="4" y1="54" x2="136" y2="54" stroke="rgba(255,255,255,0.15)" />
						<path
							d="M12 54 A58 42 0 0 1 128 54"
							fill="none"
							stroke="rgba(255,255,255,0.18)"
							stroke-dasharray="3 4"
						/>
						{#if sunAt && sunAt.t > 0}
							<path
								d="M12 54 A58 42 0 0 1 128 54"
								fill="none"
								stroke="#fbbf24"
								stroke-width="2"
								pathLength="100"
								stroke-dasharray="100"
								stroke-dashoffset={100 - Math.min(1, sunAt.t) * 100}
							/>
						{/if}
						{#if sunAt && sunAt.t >= 0 && sunAt.t <= 1}
							<circle
								class="sun-pulse"
								cx={sunAt.x}
								cy={sunAt.y}
								r="9"
								fill="#fde047"
								opacity="0.25"
							/>
							<circle cx={sunAt.x} cy={sunAt.y} r="5" fill="#fde047" />
						{/if}
					</svg>
					<div class="w-[4.5rem] shrink-0 text-end whitespace-nowrap">
						<p class="flex items-center justify-end gap-1 text-[10px] text-white/50">
							Sunset<span class="icon-[mingcute--sunset-line] size-3.5 text-orange-300"></span>
						</p>
						<p class="font-bold tabular-nums">{today.sunset ? time(today.sunset) : '–'}</p>
					</div>
				</div>
			</section>
			<section class="{card} p-3.5">
				<p class={heading}>UV index</p>
				<p class="mt-1 text-2xl font-extrabold tabular-nums leading-none">
					{Math.round(today.uv)}
				</p>
				<p class="text-xs text-white/60">{uvLabel} today</p>
				<div
					class="relative mt-2.5 h-1.5 rounded-full"
					style="background: linear-gradient(90deg, #4ade80, #facc15, #fb923c, #ef4444, #c026d3)"
				>
					<span
						class="absolute top-1/2 size-2.5 -mt-[5px] -ml-[5px] rounded-full bg-white ring-2 ring-[#15181d]"
						style="left: {Math.min(100, (today.uv / 11) * 100)}%"
					></span>
				</div>
			</section>
			<section class="{card} p-3.5">
				<p class={heading}>Pressure</p>
				<p class="mt-1 text-2xl font-extrabold tabular-nums leading-none">
					{Math.round(now.pressure)} <span class="text-xs font-semibold text-white/50">hPa</span>
				</p>
				<p class="flex items-center gap-1 text-xs text-white/60">
					<span
						class="icon-[mingcute--arrow-up-line] size-3.5 {trend > 0
							? 'text-emerald-300'
							: trend < 0
								? 'rotate-180 text-rose-300'
								: 'rotate-90 text-white/50'}"
					></span>{trend > 0 ? 'Rising' : trend < 0 ? 'Falling' : 'Steady'}
				</p>
			</section>
			<section class="{card} p-3.5">
				<p class={heading}>Visibility</p>
				<p class="mt-1 text-2xl font-extrabold tabular-nums leading-none">
					{now.visibility >= 10000
						? Math.round(now.visibility / 1000)
						: (now.visibility / 1000).toFixed(1)}
					<span class="text-xs font-semibold text-white/50">km</span>
				</p>
				<p class="text-xs text-white/60">
					{now.visibility < 1000 ? 'Fog' : now.visibility < 5000 ? 'Hazy' : 'Clear view'}
				</p>
			</section>
			<section class="{card} p-3.5">
				<p class={heading}>Clouds</p>
				<p class="mt-1 text-2xl font-extrabold tabular-nums leading-none">
					{Math.round(now.clouds)}<span class="text-xs font-semibold text-white/50">%</span>
				</p>
				<p class="text-xs text-white/60">
					{today.sunshine >= 0.5
						? `${today.sunshine.toFixed(1)} h of sun today`
						: 'Hardly any sun today'}
				</p>
			</section>
		</div>
		<p class="text-[10px] text-white/35 text-center">
			Forecast by Open-Meteo · updated {time(weather.loaded)}
		</p>
	</div>
{/if}

<style>
	.sunrays {
		position: absolute;
		right: -40%;
		top: -60%;
		width: 140%;
		aspect-ratio: 1;
		background: repeating-conic-gradient(
			from 0deg,
			rgba(255, 255, 255, 0.09) 0deg 5deg,
			transparent 5deg 15deg
		);
		mask-image: radial-gradient(circle, black 0%, transparent 60%);
		animation: turn 90s linear infinite;
	}
	.sunglow {
		position: absolute;
		right: -10%;
		top: -25%;
		width: 60%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(253, 224, 71, 0.45), transparent 65%);
		animation: glow 5s ease-in-out infinite;
	}
	.star {
		position: absolute;
		border-radius: 50%;
		background: white;
		animation: twinkle 3.5s ease-in-out infinite;
	}
	.puff {
		position: absolute;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(255, 255, 255, 0.16), transparent 70%);
		filter: blur(6px);
	}
	.puff.one {
		width: 70%;
		aspect-ratio: 2;
		top: -10%;
		left: -20%;
		animation: float 26s ease-in-out infinite alternate;
	}
	.puff.two {
		width: 60%;
		aspect-ratio: 2;
		bottom: 5%;
		right: -25%;
		animation: float 34s ease-in-out infinite alternate-reverse;
	}
	.streak {
		position: absolute;
		top: -15%;
		width: 1.5px;
		border-radius: 1px;
		background: linear-gradient(to bottom, transparent, rgba(186, 220, 255, 0.95));
		transform: rotate(12deg);
		animation: rain linear infinite;
	}
	.flake {
		position: absolute;
		top: -5%;
		border-radius: 50%;
		background: white;
		opacity: 0.8;
		animation: snow linear infinite;
	}
	.lightning {
		position: absolute;
		inset: 0;
		background: radial-gradient(circle at 70% 20%, rgba(255, 255, 255, 0.55), transparent 60%);
		opacity: 0;
		animation: lightning 7s linear infinite;
	}
	.needle {
		transform-origin: 60px 60px;
		transition: transform 1.2s cubic-bezier(0.3, 1.4, 0.5, 1);
	}
	.sway {
		transform-origin: 60px 60px;
		animation: sway 3.2s ease-in-out infinite;
	}
	.draw {
		stroke-dasharray: 20000;
		stroke-dashoffset: 20000;
		animation: draw 2.2s ease-out forwards;
	}
	.bar-grow {
		transform-origin: bottom;
		animation: grow 0.6s ease-out backwards;
	}
	.sun-pulse {
		transform-box: fill-box;
		transform-origin: center;
		animation: glow 3s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.sunrays,
		.sunglow,
		.star,
		.puff,
		.streak,
		.flake,
		.lightning,
		.sway,
		.draw,
		.bar-grow,
		.sun-pulse {
			animation: none;
		}
		.draw {
			stroke-dashoffset: 0;
		}
		.streak,
		.flake {
			display: none;
		}
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes glow {
		50% {
			transform: scale(1.15);
			opacity: 0.7;
		}
	}
	@keyframes twinkle {
		50% {
			opacity: 0.2;
		}
	}
	@keyframes float {
		to {
			transform: translateX(30%);
		}
	}
	@keyframes rain {
		from {
			transform: translateY(0) rotate(12deg);
		}
		to {
			transform: translateY(260px) rotate(12deg);
		}
	}
	@keyframes snow {
		from {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(var(--sway), 120px);
		}
		to {
			transform: translate(0, 260px);
		}
	}
	@keyframes lightning {
		0%,
		60%,
		64%,
		100% {
			opacity: 0;
		}
		61%,
		63% {
			opacity: 1;
		}
		62% {
			opacity: 0.2;
		}
	}
	@keyframes sway {
		0%,
		100% {
			transform: rotate(-4deg);
		}
		50% {
			transform: rotate(4deg);
		}
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes grow {
		from {
			transform: scaleY(0);
		}
	}
</style>
