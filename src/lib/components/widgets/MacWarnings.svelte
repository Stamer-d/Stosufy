<script>
	// The weather warnings of the German weather service (DWD) where you are, via Bright Sky
	import { onMount } from 'svelte';
	import { fetch } from '@tauri-apps/plugin-http';
	import Widget from './MacWidget.svelte';
	import PlacePicker from './PlacePicker.svelte';
	import { widgetData, placeOf } from '#lib/stores/widgetData.ts';

	/** @type {{ uid?: string }} */
	let { uid = 'warnings' } = $props();

	let place = $derived(placeOf($widgetData, uid));
	let asking = $state(false);
	let alerts = $state(null);
	let error = $state('');

	// The DWD's colours
	const SEVERITY = {
		minor: { colour: '#facc15', label: 'Minor' },
		moderate: { colour: '#fb923c', label: 'Moderate' },
		severe: { colour: '#ef4444', label: 'Severe' },
		extreme: { colour: '#c026d3', label: 'Extreme' }
	};
	const ORDER = ['extreme', 'severe', 'moderate', 'minor'];

	async function load() {
		if (!place) return;
		try {
			const response = await fetch(
				`https://api.brightsky.dev/alerts?lat=${place.lat}&lon=${place.lon}`
			);
			if (!response.ok) throw new Error(String(response.status));
			const data = await response.json();
			alerts = (data.alerts ?? [])
				.filter((alert) => !alert.expires || new Date(alert.expires).getTime() > Date.now())
				.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
			error = '';
		} catch {
			error = "Couldn't load the warnings";
		}
	}

	$effect(() => {
		void place;
		alerts = null;
		load();
	});
	onMount(() => {
		const timer = setInterval(load, 5 * 60 * 1000);
		return () => clearInterval(timer);
	});

	const time = (value) =>
		value
			? new Date(value).toLocaleString(undefined, {
					weekday: 'short',
					hour: '2-digit',
					minute: '2-digit'
				})
			: '';
	let outsideGermany = $derived(!!place?.country && place.country !== 'DE');
</script>

<Widget size="medium">
	{#if !place || asking}
		<p
			class="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-primary-500 mb-2"
		>
			<span class="icon-[mingcute--warning-line] size-3.5"></span> Weather warnings
		</p>
		<PlacePicker {uid} label="Show warnings" ondone={() => (asking = false)} />
	{:else}
		{@const top = alerts?.[0]}
		{@const severity = top ? (SEVERITY[top.severity] ?? SEVERITY.minor) : null}
		<div class="flex items-center gap-1.5">
			<span
				class="icon-[mingcute--warning-fill] size-4"
				style="color: {severity?.colour ?? '#4ade80'}"
			></span>
			<button
				class="text-[11px] font-bold uppercase tracking-wide truncate cursor-pointer hover:underline text-white/80"
				title="Change the city"
				onclick={() => (asking = true)}>Warnings · {place.name}</button
			>
			{#if alerts?.length > 1}
				<span class="ms-auto text-[11px] font-semibold text-white/50"
					>+{alerts.length - 1} more</span
				>
			{/if}
		</div>
		{#if outsideGermany}
			<p class="mt-auto text-sm text-white/60">
				Warnings come from the German weather service (DWD), so only for places in Germany.
			</p>
		{:else if alerts === null}
			<p class="mt-auto text-sm text-white/60">{error || 'Loading…'}</p>
		{:else if !alerts.length}
			<div class="mt-auto flex items-center gap-3">
				<span class="icon-[mingcute--check-circle-fill] size-8 text-green-400"></span>
				<div>
					<p class="font-semibold">No warnings</p>
					<p class="text-xs text-white/55">Nothing from the DWD for {place.name} right now.</p>
				</div>
			</div>
		{:else}
			<div class="mt-2 flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto">
				{#each alerts.slice(0, 3) as alert (alert.id ?? alert.alert_id ?? alert.headline_en)}
					{@const s = SEVERITY[alert.severity] ?? SEVERITY.minor}
					<div
						class="flex gap-2 p-2 rounded-xl bg-white/5"
						style="box-shadow: inset 3px 0 0 {s.colour}"
						title={alert.description_en ?? alert.description_de ?? ''}
					>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-semibold truncate">
								{alert.event_en ?? alert.event_de ?? alert.headline_en}
							</p>
							<p class="text-[11px] text-white/55 truncate">
								{s.label} · {time(alert.onset)} – {time(alert.expires)}
							</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</Widget>
