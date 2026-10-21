<script>
	// The forecast at the place under the pointer, at the time shown: everything the maps have
	// for it at once (the map shown first and marked), next to the pointer
	import { valuesAt, valueAt, onGrid } from '#lib/weatherField.ts';
	import { beaufort, direction, temperatureCss, windCss } from '#lib/weather.ts';
	import { LEVELS } from '#lib/storm.ts';
	import WindArrow from './WindArrow.svelte';
	import { limit } from '#lib/weatherLayers.ts';

	/**
	 * @type {{
	 *   weather: import('#lib/weather.ts').WeatherGrid | null,
	 *   storm: import('#lib/weather.ts').WeatherGrid | null,
	 *   time: number,
	 *   place: { lat: number, lon: number },
	 *   point: { x: number, y: number },
	 *   width: number,
	 *   height: number,
	 *   layer: string,
	 *   where?: string
	 * }}
	 */
	let { weather, storm, time, place, point, width, height, layer, where = '' } = $props();

	function at(grid, key) {
		if (!grid) return null;
		const p = onGrid(grid, place.lat, place.lon);
		const values = p ? valuesAt(grid, key, time) : null;
		return values ? limit(key, valueAt(values, grid.columns, grid.rows, p.gx, p.gy)) : null;
	}

	let rows = $derived.by(() => {
		const list = [];
		const temp = at(weather, 'temp');
		if (temp != null) {
			const wind = Math.max(0, at(weather, 'wind'));
			const u = at(weather, 'u');
			const v = at(weather, 'v');
			const from = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
			const rain = Math.max(0, at(weather, 'rain'));
			const snow = at(weather, 'snowShare') > 0.5;
			list.push(
				{
					id: 'temp',
					icon: 'icon-[mingcute--high-temperature-line]',
					label: 'Temperature',
					value: `${temp.toFixed(1)}°`,
					colour: temperatureCss(temp)
				},
				{
					id: 'wind',
					icon: 'icon-[mingcute--wind-line]',
					label: 'Wind',
					value: `${Math.round(wind)} km/h`,
					sub: `${direction(from)} · Bft ${beaufort(wind)}`,
					colour: windCss(wind),
					towards: from + 180
				},
				{
					id: 'gust',
					icon: 'icon-[mingcute--tornado-line]',
					label: 'Gusts',
					value: `${Math.round(Math.max(0, at(weather, 'gust')))} km/h`,
					colour: windCss(at(weather, 'gust'))
				},
				{
					id: 'rain',
					icon: snow ? 'icon-[mingcute--snowflake-line]' : 'icon-[mingcute--rain-line]',
					label: snow ? 'Snow' : 'Rain',
					value: rain < 0.05 ? 'Dry' : `${rain.toFixed(1)} mm/h`,
					colour: rain < 0.05 ? null : snow ? '#e9d5ff' : '#7dd3fc'
				},
				{
					id: 'clouds',
					icon: 'icon-[mingcute--clouds-line]',
					label: 'Clouds',
					value: `${Math.round(Math.max(0, Math.min(100, at(weather, 'clouds'))))}%`
				},
				{
					id: 'pressure',
					icon: 'icon-[mingcute--dashboard-3-line]',
					label: 'Pressure',
					value: `${Math.round(at(weather, 'pressure'))} hPa`
				}
			);
		}
		const cape = at(storm, 'cape');
		if (cape != null) {
			const level = LEVELS[Math.max(0, Math.min(4, Math.round(at(storm, 'risk'))))];
			list.push(
				{
					id: 'risk',
					icon: 'icon-[mingcute--thunderstorm-line]',
					label: 'Storm risk',
					value: level.label,
					colour: level.colour
				},
				{
					id: 'cape',
					icon: 'icon-[mingcute--fire-line]',
					label: 'CAPE',
					value: `${Math.round(Math.max(0, cape))} J/kg`
				},
				{
					id: 'li',
					icon: 'icon-[mingcute--arrow-up-circle-line]',
					label: 'Lifted index',
					value: at(storm, 'li').toFixed(1)
				},
				{
					id: 'shear',
					icon: 'icon-[mingcute--cloud-windy-line]',
					label: 'Deep shear',
					value: `${Math.round(at(storm, 'shear'))} m/s`
				}
			);
		}
		// The map shown first
		return list.sort((a, b) => (b.id === layer ? 1 : 0) - (a.id === layer ? 1 : 0));
	});

	const W = 232;
	let left = $derived(point.x + 18 + W > width - 8 ? point.x - W - 18 : point.x + 18);
	let top = $derived(Math.max(64, Math.min(height - rows.length * 30 - 70, point.y - 20)));
</script>

{#if rows.length}
	<div
		class="absolute z-10 p-2 rounded-2xl bg-[#15181d]/90 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl shadow-black/40 pointer-events-none"
		style="left: {left}px; top: {top}px; width: {W}px"
	>
		<p class="px-1.5 pb-1.5 text-[11px] text-white/55 truncate">
			{new Date(time).toLocaleString(undefined, {
				weekday: 'short',
				hour: '2-digit',
				minute: '2-digit'
			})}{where ? ` · ${where}` : ''}
		</p>
		{#each rows as row (row.id)}
			<div
				class="flex items-center gap-2 h-[30px] px-1.5 rounded-lg {row.id === layer
					? 'bg-white/[0.08]'
					: ''}"
			>
				<span class="{row.icon} size-4 shrink-0 text-white/50"></span>
				<span class="flex-1 min-w-0 text-xs text-white/70 truncate">{row.label}</span>
				{#if row.towards != null}
					<WindArrow towards={row.towards} size={15} colour={row.colour} />
				{/if}
				<span class="text-right leading-none">
					<span
						class="block text-[13px] font-extrabold tabular-nums"
						style={row.colour ? `color: ${row.colour}` : ''}>{row.value}</span
					>
					{#if row.sub}<span class="block text-[10px] text-white/45 mt-0.5">{row.sub}</span>{/if}
				</span>
			</div>
		{/each}
	</div>
{/if}
