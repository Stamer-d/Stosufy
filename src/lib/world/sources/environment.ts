// The environment: maps of the air (European air quality index, fine dust, NO₂, ozone,
// pollen, UV) and of the sea (waves) from Open-Meteo, the community's fine dust sensors
// (Sensor.Community) and Germany's radiation probes (BfS).

import type { Area, Feature, FieldSource, LayerSource } from '../types';
import { getJson } from '../http';
import { ago, clockTime, scale } from '../features';

type Rgba = [number, number, number, number];

/** Places over the area in rows (north to south) and columns (west to east) */
function grid(a: Area, columns = 14, rows = 10) {
	const points: { lat: number; lon: number }[] = [];
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns; c++)
			points.push({
				lat: Math.round((a.north - ((a.north - a.south) * r) / (rows - 1)) * 100) / 100,
				lon: Math.round((a.west + ((a.east - a.west) * c) / (columns - 1)) * 100) / 100
			});
	return { points, columns, rows };
}

/** Current values of Open-Meteo over the area, as the map's rows */
async function openMeteoField(
	url: string,
	variables: string[],
	value: (current: Record<string, number | null>) => number,
	a: Area,
	signal: AbortSignal
) {
	const { points, columns, rows } = grid(a);
	const data = await getJson(
		`${url}?latitude=${points.map((p) => p.lat).join(',')}&longitude=${points.map((p) => p.lon).join(',')}&current=${variables.join(',')}&timezone=GMT`,
		signal
	);
	if (data?.error) throw new Error(data.reason ?? 'Open-Meteo refused');
	const list = Array.isArray(data) ? data : [data];
	const values = points.map((p, i) => {
		const current = list[i]?.current;
		return { ...p, value: current ? value(current) : NaN };
	});
	const out = [];
	for (let r = 0; r < rows; r++) out.push(values.slice(r * columns, (r + 1) * columns));
	const time = list[0]?.current?.time ? Date.parse(`${list[0].current.time}Z`) : undefined;
	return { rows: out, time };
}

const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const num = (v: number | null | undefined) => (v == null ? NaN : v);

/** The colours of the European air quality index, from good to extremely poor */
const AQ_COLOURS: Rgba[] = [
	[80, 240, 230, 0.35],
	[80, 204, 170, 0.42],
	[240, 230, 65, 0.48],
	[255, 80, 80, 0.55],
	[150, 0, 50, 0.6],
	[125, 33, 129, 0.65]
];
/** A scale through the six colours at the bands' limits */
const bands = (limits: number[]) => (v: number) =>
	scale(
		limits.map((limit, i) => [limit, AQ_COLOURS[i]] as [number, Rgba]),
		v
	);

export const FIELDS: FieldSource[] = [
	{
		id: 'aqi',
		label: 'Air quality',
		icon: 'icon-[mingcute--leaf-line]',
		hint: 'The European air quality index: 0–20 good, 20–40 fair, 40–60 moderate, 60–80 poor, 80+ very poor',
		unit: 'EAQI',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [20, 40, 60, 80, 100],
		colour: bands([0, 20, 40, 60, 80, 100]),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['european_aqi'], (c) => num(c.european_aqi), a, s)
	},
	{
		id: 'pm25',
		label: 'Fine dust PM2.5',
		icon: 'icon-[mingcute--cloud-windy-line]',
		hint: 'Particles under 2.5 µm (µg/m³): from 25 poor for health',
		unit: 'µg/m³',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [10, 20, 25, 50, 75],
		colour: bands([0, 10, 20, 25, 50, 75]),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['pm2_5'], (c) => num(c.pm2_5), a, s)
	},
	{
		id: 'pm10',
		label: 'Dust PM10',
		icon: 'icon-[mingcute--cloud-windy-line]',
		hint: 'Particles under 10 µm (µg/m³), also Saharan dust: from 50 poor',
		unit: 'µg/m³',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [20, 40, 50, 100, 150],
		colour: bands([0, 20, 40, 50, 100, 150]),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['pm10'], (c) => num(c.pm10), a, s)
	},
	{
		id: 'no2',
		label: 'Nitrogen dioxide',
		icon: 'icon-[mingcute--car-line]',
		hint: 'NO₂ (µg/m³), mostly from traffic: from 120 poor',
		unit: 'µg/m³',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [40, 90, 120, 230, 340],
		colour: bands([0, 40, 90, 120, 230, 340]),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['nitrogen_dioxide'], (c) => num(c.nitrogen_dioxide), a, s)
	},
	{
		id: 'o3',
		label: 'Ozone',
		icon: 'icon-[mingcute--sun-line]',
		hint: 'Ground ozone (µg/m³), on hot sunny days: from 130 poor',
		unit: 'µg/m³',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [50, 100, 130, 240, 380],
		colour: bands([0, 50, 100, 130, 240, 380]),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['ozone'], (c) => num(c.ozone), a, s)
	},
	{
		id: 'pollen',
		label: 'Pollen',
		icon: 'icon-[mingcute--flower-line]',
		hint: 'The most pollen of any kind (birch, grass, alder, mugwort, ragweed, olive) in grains/m³; Europe only',
		unit: 'grains/m³',
		attribution: 'Open-Meteo, CAMS Europe',
		legend: [10, 50, 150, 500],
		colour: (v) =>
			scale(
				[
					[1, [0, 0, 0, 0]],
					[10, [163, 230, 53, 0.35]],
					[50, [250, 204, 21, 0.5]],
					[150, [249, 115, 22, 0.58]],
					[500, [220, 38, 38, 0.65]]
				],
				v
			),
		every: 60 * 60 * 1000,
		load: (a, s) => {
			const kinds = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'].map(
				(k) => `${k}_pollen`
			);
			return openMeteoField(
				AIR,
				kinds,
				(c) => {
					const values = kinds.map((k) => c[k]).filter((v) => v != null) as number[];
					return values.length ? Math.max(...values) : NaN;
				},
				a,
				s
			);
		}
	},
	{
		id: 'uv',
		label: 'UV index',
		icon: 'icon-[mingcute--sun-fill]',
		hint: 'How strong the sun burns: 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme',
		unit: '',
		attribution: 'Open-Meteo, CAMS (Copernicus)',
		legend: [3, 6, 8, 11],
		colour: (v) =>
			scale(
				[
					[0.5, [0, 0, 0, 0]],
					[2, [74, 222, 128, 0.3]],
					[5, [250, 204, 21, 0.45]],
					[7, [249, 115, 22, 0.55]],
					[10, [220, 38, 38, 0.6]],
					[12, [168, 85, 247, 0.65]]
				],
				v
			),
		format: (v) => v.toFixed(1),
		every: 30 * 60 * 1000,
		load: (a, s) => openMeteoField(AIR, ['uv_index'], (c) => num(c.uv_index), a, s)
	},
	{
		id: 'waves',
		label: 'Waves',
		icon: 'icon-[mingcute--wave-line]',
		hint: 'The height of the waves at sea (m): from 4 rough, from 9 very high',
		unit: 'm',
		attribution: 'Open-Meteo Marine',
		legend: [1, 2, 4, 6, 9],
		colour: (v) =>
			scale(
				[
					[0.2, [0, 0, 0, 0]],
					[1, [56, 189, 248, 0.3]],
					[2, [45, 212, 191, 0.42]],
					[4, [250, 204, 21, 0.5]],
					[6, [249, 115, 22, 0.58]],
					[9, [220, 38, 38, 0.65]],
					[14, [168, 85, 247, 0.7]]
				],
				v
			),
		format: (v) => v.toFixed(1),
		every: 60 * 60 * 1000,
		load: (a, s) => openMeteoField(MARINE, ['wave_height'], (c) => num(c.wave_height), a, s)
	}
];

/** The air at a place now (for its widget) */
export async function airNow(lat: number, lon: number, signal?: AbortSignal) {
	const pollen = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'].map(
		(k) => `${k}_pollen`
	);
	const data = await getJson(
		`${AIR}?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,uv_index,${pollen.join(',')}&timezone=GMT`,
		signal
	);
	const c = data?.current ?? {};
	const pollenValues = pollen.map((k) => c[k]).filter((v) => v != null) as number[];
	return {
		aqi: num(c.european_aqi),
		pm25: num(c.pm2_5),
		pm10: num(c.pm10),
		no2: num(c.nitrogen_dioxide),
		o3: num(c.ozone),
		uv: num(c.uv_index),
		pollen: pollenValues.length ? Math.max(...pollenValues) : NaN,
		time: c.time ? Date.parse(`${c.time}Z`) : null
	};
}

/** The European air quality index's words and colours */
export function aqiLevel(aqi: number) {
	const levels: [number, string, string][] = [
		[20, 'Good', '#50f0e6'],
		[40, 'Fair', '#50ccaa'],
		[60, 'Moderate', '#f0e641'],
		[80, 'Poor', '#ff5050'],
		[100, 'Very poor', '#960032'],
		[Infinity, 'Extremely poor', '#7d2181']
	];
	const [, label, colour] = levels.find(([limit]) => aqi < limit) ?? levels[levels.length - 1];
	return { label, colour };
}

// --- The community's fine dust sensors ---------------------------------------------------------

/** PM2.5 in the European index's colours */
function pmColour(pm25: number) {
	if (pm25 < 10) return '#50f0e6';
	if (pm25 < 20) return '#50ccaa';
	if (pm25 < 25) return '#f0e641';
	if (pm25 < 50) return '#ff5050';
	if (pm25 < 75) return '#960032';
	return '#7d2181';
}

export const sensors: LayerSource = {
	id: 'sensors',
	category: 'environment',
	label: 'Dust sensors',
	icon: 'icon-[ri--sensor-line]',
	hint: 'The fine dust sensors people run outside their homes, now (zoom in to see them)',
	attribution: 'Sensor.Community',
	byArea: true,
	minZoom: 8,
	every: 5 * 60 * 1000,
	legend: [
		{ label: 'Good', colour: '#50f0e6' },
		{ label: 'Fair', colour: '#50ccaa' },
		{ label: 'Moderate', colour: '#f0e641' },
		{ label: 'Poor', colour: '#ff5050' },
		{ label: 'Very poor', colour: '#960032' }
	],
	async load(a, signal) {
		const km = Math.min(
			120,
			Math.ceil(
				(Math.hypot(a.north - a.south, (a.east - a.west) * Math.cos((a.lat * Math.PI) / 180)) *
					111) /
					2
			)
		);
		const list = await getJson<any[]>(
			`https://data.sensor.community/airrohr/v1/filter/area=${a.lat.toFixed(4)},${a.lon.toFixed(4)},${km}`,
			signal
		);
		// The newest of each sensor
		const latest = new Map<string, any>();
		for (const m of list ?? []) {
			if (m.location?.indoor == 1) continue;
			const values = Object.fromEntries(
				(m.sensordatavalues ?? []).map((v: any) => [v.value_type, Number(v.value)])
			);
			if (!isFinite(values.P2)) continue;
			const key = String(m.sensor?.id ?? m.location?.id);
			const before = latest.get(key);
			if (!before || before.timestamp < m.timestamp) latest.set(key, { ...m, values });
		}
		return [...latest.values()].map((m) => ({
			id: `sensor:${m.sensor?.id ?? m.location?.id}`,
			lat: Number(m.location.latitude),
			lon: Number(m.location.longitude),
			shape: 'dot' as const,
			size: 4,
			colour: pmColour(m.values.P2),
			label: `${Math.round(m.values.P2)}`,
			labelZoom: 13,
			data: m
		}));
	},
	details(f) {
		const m = f.data;
		const time = Date.parse(`${String(m.timestamp).replace(' ', 'T')}Z`);
		return {
			title: `Sensor ${m.sensor?.id ?? ''}`,
			subtitle: [m.sensor?.sensor_type?.name, m.location?.country].filter(Boolean).join(' · '),
			badge: { text: String(Math.round(m.values.P2)), colour: f.colour, small: 'PM2.5' },
			stats: [
				{ label: 'PM2.5', value: `${m.values.P2.toFixed(1)} µg/m³` },
				...(isFinite(m.values.P1)
					? [{ label: 'PM10', value: `${m.values.P1.toFixed(1)} µg/m³` }]
					: []),
				...(isFinite(time) ? [{ label: 'Measured', value: clockTime(time), hint: ago(time) }] : [])
			],
			links: [
				{
					label: 'On the Sensor.Community map',
					url: `https://maps.sensor.community/#13/${f.lat}/${f.lon}`
				}
			],
			source: 'Sensor.Community (citizen science)'
		};
	}
};

// --- Radiation (Germany's gamma dose rate probes, BfS) --------------------------------------

function doseColour(v: number) {
	if (v < 0.1) return '#4ade80';
	if (v < 0.15) return '#a3e635';
	if (v < 0.2) return '#facc15';
	if (v < 0.3) return '#fb923c';
	return '#ef4444';
}

export const radiation: LayerSource = {
	id: 'radiation',
	category: 'environment',
	label: 'Radiation',
	icon: 'icon-[ri--atom-line]',
	hint: 'The gamma dose rate at Germany’s ~1,700 probes, the last hour (normal: 0.05–0.18 µSv/h)',
	attribution: 'Bundesamt für Strahlenschutz (BfS)',
	every: 30 * 60 * 1000,
	legend: [
		{ label: '< 0.1 µSv/h', colour: '#4ade80' },
		{ label: '< 0.2', colour: '#facc15' },
		{ label: '≥ 0.3', colour: '#ef4444' }
	],
	async load(_, signal) {
		const data = await getJson(
			'https://www.imis.bfs.de/ogc/opendata/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=opendata:odlinfo_odl_1h_latest&outputFormat=application/json',
			signal
		);
		return (data?.features ?? [])
			.map((f: any) => {
				const p = f.properties ?? {};
				const [lon, lat] = f.geometry?.coordinates ?? [];
				const value = Number(p.value ?? p.odl ?? p.value_terrestrial);
				if (typeof lat !== 'number' || !isFinite(value)) return null;
				return {
					id: `odl:${p.id ?? p.kenn ?? `${lat},${lon}`}`,
					lat,
					lon,
					shape: 'dot' as const,
					size: value >= 0.2 ? 4.5 : 3,
					colour: doseColour(value),
					rank: value >= 0.2 ? 2 : 1,
					label: value.toFixed(3),
					labelZoom: 10,
					data: { p, value }
				};
			})
			.filter(Boolean) as Feature[];
	},
	details(f) {
		const { p, value } = f.data;
		const end = Date.parse(p.end_measure ?? '');
		return {
			title: p.name ?? p.locality_name ?? 'Probe',
			subtitle: ['Gamma dose rate', p.plz].filter(Boolean).join(' · '),
			badge: { text: value.toFixed(2), colour: f.colour, small: 'µSv/h' },
			text:
				value < 0.2
					? 'Within the natural range (it varies with the ground and rain washing out radon).'
					: 'Above the usual range here; rain washing radon down raises it for hours.',
			stats: [
				{ label: 'Dose rate', value: `${value.toFixed(3)} µSv/h` },
				...(p.value_cosmic != null ? [{ label: 'Cosmic', value: `${p.value_cosmic} µSv/h` }] : []),
				...(p.value_terrestrial != null
					? [{ label: 'From the ground', value: `${p.value_terrestrial} µSv/h` }]
					: []),
				...(isFinite(end)
					? [{ label: 'Measured until', value: clockTime(end), hint: ago(end) }]
					: []),
				...(p.height_above_sea != null
					? [{ label: 'Height', value: `${p.height_above_sea} m` }]
					: [])
			],
			links: [{ label: 'ODL-Info (BfS)', url: 'https://odlinfo.bfs.de/' }],
			source: 'Bundesamt für Strahlenschutz, ODL-Messnetz'
		};
	}
};
