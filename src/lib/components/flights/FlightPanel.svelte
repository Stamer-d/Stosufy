<script>
	// A flight, like Flightradar24 shows it: a photo of the plane, where it flies from and to
	// (and how far it is), and what it does now: height, speed, climb, squawk.
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import { flightInfo, kmBetween, planeNow, altitudeColour } from '#lib/flights.ts';

	/**
	 * @type {{
	 *   plane: import('#lib/flights.ts').Plane,
	 *   track?: import('#lib/flights.ts').TrailPoint[] | null,
	 *   why?: string,
	 *   compact?: boolean,
	 *   onclose?: () => void,
	 *   onopen?: (() => void) | null
	 * }}
	 */
	let {
		plane,
		track = null,
		why = '',
		compact = false,
		onclose = () => {},
		onopen = null
	} = $props();

	let info = $state(null);
	let infoFor = '';
	$effect(() => {
		const key = `${plane.hex}/${plane.callsign}`;
		if (key === infoFor) return;
		infoFor = key;
		info = null;
		const asked = key;
		flightInfo(plane).then((result) => {
			if (infoFor === asked) info = result;
		});
	});

	let photoBroken = $state(false);
	$effect(() => {
		void info?.photo?.large;
		photoBroken = false;
	});

	// Ticks so the distances follow the plane
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	let route = $derived.by(() => {
		const from = info?.origin;
		const to = info?.destination;
		if (!from || !to) return null;
		const at = planeNow(plane, now);
		const flown = kmBetween(from, at);
		const left = kmBetween(at, to);
		const share = Math.max(0, Math.min(1, flown / Math.max(1, flown + left)));
		const minutes = plane.speed > 50 ? Math.round((left / (plane.speed * 1.852)) * 60) : null;
		return { from, to, flown, left, share, minutes };
	});

	const title = $derived(plane.callsign || plane.registration || plane.hex.toUpperCase());
	const typeName = $derived(
		info?.aircraft?.type
			? `${info.aircraft.manufacturer ? info.aircraft.manufacturer + ' ' : ''}${info.aircraft.type}`.replace(
					/^(\w+) \1/i,
					'$1'
				)
			: plane.desc || plane.type || 'Unknown type'
	);
	const emergency = $derived(['7500', '7600', '7700'].includes(plane.squawk) || !!plane.emergency);

	// The height over the last hour, as a line
	let profile = $derived.by(() => {
		// The whole flight when the networks have it, else what was seen of it
		const end = track?.at(-1)?.time ?? 0;
		const points = track?.length
			? [...track, ...plane.trail.filter((p) => p.time > end)]
			: plane.trail.filter((p) => p.time > now - 60 * 60 * 1000);
		if (points.length < 3 || points.at(-1).time - points[0].time < 2 * 60 * 1000) return null;
		const t0 = points[0].time;
		const t1 = Math.max(t0 + 1, points.at(-1).time);
		const top = Math.max(10000, ...points.map((p) => p.alt));
		const line = points
			.map(
				(p) =>
					`${(((p.time - t0) / (t1 - t0)) * 100).toFixed(2)},${(40 - (p.alt / top) * 36).toFixed(2)}`
			)
			.join(' ');
		return { line, top, minutes: Math.round((t1 - t0) / 60000) };
	});

	const fmt = (n) => Math.round(n).toLocaleString();
	const duration = (minutes) =>
		minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
</script>

<div class="flex flex-col min-h-0">
	<!-- Header -->
	<div class="flex items-start gap-3 p-4 pb-3">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<p class="text-xl font-extrabold tracking-tight truncate">{title}</p>
				{#if info?.airlineCode && plane.callsign}
					<span class="px-1.5 py-0.5 rounded-md bg-white/10 text-[11px] font-bold"
						>{info.airlineCode}</span
					>
				{/if}
				{#if plane.military}
					<span
						class="px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[11px] font-bold"
						>MIL</span
					>
				{/if}
			</div>
			<p class="text-sm text-white/60 truncate">
				{info?.airline ??
					(plane.operator ||
						info?.aircraft?.owner ||
						(info ? 'Private / unknown operator' : 'Loading…'))}
			</p>
			{#if why}
				<p class="mt-1 text-xs font-semibold text-amber-300">{why}</p>
			{/if}
		</div>
		<button
			class="grid place-items-center size-8 shrink-0 rounded-lg text-white/50 hover:text-white hover:bg-white/10 cursor-pointer"
			aria-label="Close the flight"
			onclick={onclose}><span class="icon-[mingcute--close-line] size-4"></span></button
		>
	</div>

	{#if emergency}
		<div
			class="mx-4 mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/20 text-red-200 text-sm font-semibold"
		>
			<span class="icon-[mingcute--alert-fill] size-4 text-red-400"></span>
			{plane.squawk === '7700'
				? 'Emergency (squawk 7700)'
				: plane.squawk === '7600'
					? 'Radio failure (squawk 7600)'
					: plane.squawk === '7500'
						? 'Unlawful interference (squawk 7500)'
						: `Emergency: ${plane.emergency}`}
		</div>
	{/if}

	<!-- Photo -->
	<div
		class="relative mx-4 rounded-xl overflow-hidden bg-white/[0.04] {compact
			? 'aspect-[16/8]'
			: 'aspect-[16/10]'}"
	>
		{#if info?.photo && !photoBroken}
			<img
				src={info.photo.large}
				alt="{typeName} {plane.registration}"
				class="size-full object-cover"
				onerror={() => (photoBroken = true)}
			/>
			{#if info.photo.by}
				<button
					class="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/60 text-[10px] text-white/80 hover:text-white cursor-pointer"
					onclick={() => info.photo.link && openUrl(info.photo.link)}>© {info.photo.by}</button
				>
			{/if}
		{:else}
			<div class="absolute inset-0 grid place-items-center text-white/30">
				{#if info}
					<div class="flex flex-col items-center gap-1">
						<span class="icon-[mingcute--airplane-line] size-10"></span>
						<span class="text-xs">No photo of this plane</span>
					</div>
				{:else}
					<span class="icon-[mingcute--loading-line] size-6 animate-spin"></span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Route -->
	<div class="mx-4 mt-3 p-3 rounded-xl bg-white/[0.04]">
		{#if route}
			<div class="flex items-center gap-2">
				<div class="min-w-0 flex-1">
					<p class="text-2xl font-extrabold leading-none">{route.from.iata || route.from.icao}</p>
					<p class="mt-1 text-xs text-white/55 truncate" title={route.from.name}>
						{route.from.city || route.from.name}
					</p>
				</div>
				<span class="icon-[mingcute--airplane-fill] size-5 text-amber-300 rotate-45"></span>
				<div class="min-w-0 flex-1 text-end">
					<p class="text-2xl font-extrabold leading-none">{route.to.iata || route.to.icao}</p>
					<p class="mt-1 text-xs text-white/55 truncate" title={route.to.name}>
						{route.to.city || route.to.name}
					</p>
				</div>
			</div>
			<div class="relative mt-3 h-1.5 rounded-full bg-white/10">
				<div
					class="absolute inset-y-0 left-0 rounded-full bg-amber-300"
					style="width: {route.share * 100}%"
				></div>
				<span
					class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 icon-[mingcute--airplane-fill] size-3.5 text-amber-300 rotate-90"
					style="left: {route.share * 100}%"
				></span>
			</div>
			<p class="mt-2 flex justify-between text-[11px] text-white/55 tabular-nums">
				<span>{fmt(route.flown)} km flown</span>
				<span>
					{fmt(route.left)} km to go{route.minutes != null && !plane.ground
						? ` · ~${duration(route.minutes)}`
						: ''}
				</span>
			</p>
		{:else}
			<p class="text-sm text-white/50">
				{info
					? 'Route unknown (not a scheduled flight, or not in the database)'
					: 'Finding the route…'}
			</p>
		{/if}
	</div>

	<!-- Now -->
	<div class="mx-4 mt-3 grid grid-cols-3 gap-1.5">
		{#each [['Altitude', plane.ground ? 'Ground' : `${fmt(plane.alt)} ft`, plane.ground ? '' : `${fmt(plane.alt * 0.3048)} m`], ['Speed', `${fmt(plane.speed)} kt`, `${fmt(plane.speed * 1.852)} km/h`], ['Vertical', `${plane.vrate > 0 ? '+' : ''}${fmt(plane.vrate)}`, plane.vrate > 300 ? 'ft/min ↑' : plane.vrate < -300 ? 'ft/min ↓' : 'ft/min level'], ['Track', `${Math.round(plane.track)}°`, ''], ['Squawk', plane.squawk || '–', ''], ['ICAO', plane.hex.toUpperCase(), '']] as [label, value, sub] (label)}
			<div class="p-2 rounded-lg bg-white/[0.04]">
				<p class="text-[9px] font-bold uppercase tracking-wide text-white/45">{label}</p>
				<p
					class="text-sm font-extrabold tabular-nums truncate {label === 'Squawk' && emergency
						? 'text-red-400'
						: ''}"
					style={label === 'Altitude' ? `color: ${altitudeColour(plane.alt, plane.ground)}` : ''}
				>
					{value}
				</p>
				{#if sub}<p class="text-[10px] text-white/45 tabular-nums">{sub}</p>{/if}
			</div>
		{/each}
	</div>

	{#if !compact}
		<!-- The aircraft -->
		<div class="mx-4 mt-3 p-3 rounded-xl bg-white/[0.04] text-sm">
			<p class="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-2">Aircraft</p>
			<div class="grid grid-cols-[6rem_1fr] gap-y-1">
				<span class="text-white/50">Type</span><span class="font-semibold truncate"
					>{typeName}{plane.type ? ` (${plane.type})` : ''}</span
				>
				<span class="text-white/50">Registration</span><span class="font-semibold"
					>{plane.registration || info?.aircraft?.registration || '–'}</span
				>
				<span class="text-white/50">Operator</span><span class="font-semibold truncate"
					>{info?.aircraft?.owner || plane.operator || '–'}</span
				>
				<span class="text-white/50">Country</span><span class="font-semibold truncate"
					>{info?.aircraft?.country || '–'}</span
				>
			</div>
		</div>

		<!-- Height over time -->
		{#if profile}
			<div class="mx-4 mt-3 p-3 rounded-xl bg-white/[0.04]">
				<p
					class="flex justify-between text-[10px] font-bold uppercase tracking-wider text-white/45 mb-1"
				>
					<span>Altitude</span><span
						>{track?.length ? 'this flight' : 'last'} · {duration(profile.minutes)}</span
					>
				</p>
				<svg viewBox="0 0 100 42" preserveAspectRatio="none" class="w-full h-16">
					<polyline
						points={profile.line}
						fill="none"
						stroke="#fcd34d"
						stroke-width="1.5"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
				<p class="text-[10px] text-white/40 text-end tabular-nums">top {fmt(profile.top)} ft</p>
			</div>
		{/if}
	{/if}

	{#if onopen}
		<button
			class="mx-4 mt-3 flex items-center justify-center gap-2 h-9 rounded-xl bg-white text-black text-sm font-bold cursor-pointer hover:bg-white/90"
			onclick={onopen}
			><span class="icon-[mingcute--airplane-line] size-4"></span>Open in flight radar</button
		>
	{/if}
	<div class="h-4 shrink-0"></div>
</div>
