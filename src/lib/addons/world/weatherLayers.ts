// The maps of the forecast: what each colours (a value of the weather grid), its colours,
// its legend and the numbers written on it. The weather's maps (temperature, wind, rain and
// snow, clouds, gusts, pressure) and the storm chasers' (risk, CAPE, lifted index, shear).

import { TEMPERATURE, WIND, type Stops, type Rgba } from './weather';
import { LEVELS } from './storm';

export interface MapLayer {
	id: string;
	label: string;
	icon: string;
	group: 'weather' | 'storm';
	/** The grid's value it colours */
	key: string;
	unit: string;
	/** What it shows, in a few words */
	hint: string;
	stops: Stops;
	/** Colours that jump from stop to stop (levels) */
	steps?: boolean;
	/** A second set of colours, mixed in by a share the grid has (snow in the rain) */
	blend?: { key: string; stops: Stops };
	/** Coloured under it (the clouds under the rain) */
	under?: { key: string; stops: Stops };
	/** The marks on the legend */
	legend: number[];
	/** A legend's mark in words (else the number) */
	legendText?: (value: number) => string;
	/** A value as written on the map ('' for none) */
	text: (value: number) => string;
	/** The numbers on the map show the wind's direction too */
	arrows?: boolean;
	/** The pressure's lines (isobars) come with it */
	isobars?: boolean;
}

const hex = (colour: string, alpha: number): Rgba => [
	...(colour
		.slice(1)
		.match(/../g)!
		.map((x) => parseInt(x, 16)) as [number, number, number]),
	alpha
];

export const RAIN: Stops = [
	[0.03, [90, 160, 255, 0]],
	[0.15, [120, 190, 255, 0.42]],
	[0.5, [72, 150, 250, 0.62]],
	[1, [40, 110, 240, 0.72]],
	[2, [32, 72, 214, 0.78]],
	[4, [112, 52, 222, 0.82]],
	[8, [200, 44, 200, 0.85]],
	[15, [250, 64, 120, 0.88]],
	[30, [255, 200, 64, 0.9]]
];
const SNOW: Stops = [
	[0.03, [255, 255, 255, 0]],
	[0.15, [236, 238, 255, 0.5]],
	[0.5, [222, 216, 255, 0.68]],
	[1, [204, 184, 255, 0.76]],
	[3, [184, 142, 250, 0.84]],
	[6, [240, 140, 230, 0.88]]
];
const CLOUDS: Stops = [
	[5, [255, 255, 255, 0]],
	[25, [228, 234, 244, 0.14]],
	[50, [226, 232, 242, 0.36]],
	[80, [222, 228, 238, 0.56]],
	[100, [236, 240, 247, 0.72]]
];
/** The clouds faint, under the rain */
const CLOUDS_UNDER: Stops = CLOUDS.map(([at, [r, g, b, a]]) => [at, [r, g, b, a * 0.55]]);

const round = (value: number) => `${Math.round(value)}`;

export const MAP_LAYERS: MapLayer[] = [
	{
		id: 'temp',
		label: 'Temperature',
		icon: 'icon-[mingcute--high-temperature-line]',
		group: 'weather',
		key: 'temp',
		unit: '°C',
		hint: 'The air 2 m above the ground',
		stops: TEMPERATURE,
		legend: [-20, 0, 10, 20, 30, 40],
		text: (v) => `${Math.round(v)}°`
	},
	{
		id: 'wind',
		label: 'Wind',
		icon: 'icon-[mingcute--wind-line]',
		group: 'weather',
		key: 'wind',
		unit: 'km/h',
		hint: 'The mean wind 10 m above the ground, and where it blows',
		stops: WIND,
		legend: [0, 20, 40, 65, 100],
		text: round,
		arrows: true
	},
	{
		id: 'rain',
		label: 'Rain & snow',
		icon: 'icon-[mingcute--rain-line]',
		group: 'weather',
		key: 'rain',
		unit: 'mm/h',
		hint: 'Rain and snow in the hour (snow in white and lilac), the clouds faint under it',
		stops: RAIN,
		blend: { key: 'snowShare', stops: SNOW },
		under: { key: 'clouds', stops: CLOUDS_UNDER },
		legend: [0.5, 1, 2, 4, 8, 15, 30],
		text: (v) => (v < 0.1 ? '' : v < 1 ? v.toFixed(1) : `${Math.round(v)}`)
	},
	{
		id: 'clouds',
		label: 'Clouds',
		icon: 'icon-[mingcute--clouds-line]',
		group: 'weather',
		key: 'clouds',
		unit: '%',
		hint: 'How much of the sky is covered by clouds',
		stops: CLOUDS,
		legend: [0, 25, 50, 75, 100],
		text: (v) => `${Math.round(v)}%`
	},
	{
		id: 'gust',
		label: 'Gusts',
		icon: 'icon-[mingcute--tornado-line]',
		group: 'weather',
		key: 'gust',
		unit: 'km/h',
		hint: 'The strongest gusts in the hour',
		stops: WIND,
		legend: [0, 20, 40, 65, 100],
		text: round,
		arrows: true
	},
	{
		id: 'pressure',
		label: 'Pressure',
		icon: 'icon-[mingcute--dashboard-3-line]',
		group: 'weather',
		key: 'pressure',
		unit: 'hPa',
		hint: 'Air pressure at sea level, with its lines (isobars), highs and lows',
		stops: [
			[970, [120, 60, 200, 0.6]],
			[990, [60, 116, 230, 0.55]],
			[1005, [70, 176, 220, 0.45]],
			[1013, [110, 196, 160, 0.4]],
			[1020, [226, 200, 92, 0.45]],
			[1030, [240, 140, 60, 0.55]],
			[1045, [220, 70, 70, 0.6]]
		],
		legend: [970, 990, 1005, 1013, 1020, 1030],
		text: () => '',
		isobars: true
	},
	{
		id: 'risk',
		label: 'Storm risk',
		icon: 'icon-[mingcute--thunderstorm-line]',
		group: 'storm',
		key: 'risk',
		unit: '',
		hint: 'Energy, instability and shear together, from quiet to high',
		stops: [
			[0, [0, 0, 0, 0]],
			[0.5, hex(LEVELS[1].colour, 0.42)],
			[1.5, hex(LEVELS[2].colour, 0.5)],
			[2.5, hex(LEVELS[3].colour, 0.58)],
			[3.5, hex(LEVELS[4].colour, 0.66)]
		],
		steps: true,
		legend: [1, 2, 3, 4],
		legendText: (v) => LEVELS[v].label,
		text: () => ''
	},
	{
		id: 'cape',
		label: 'CAPE',
		icon: 'icon-[mingcute--fire-line]',
		group: 'storm',
		key: 'cape',
		unit: 'J/kg',
		hint: 'Energy for storms: from 500 storms can grow, from 2000 they can be violent',
		stops: [
			[0, [0, 0, 0, 0]],
			[100, [74, 222, 128, 0.3]],
			[500, [250, 204, 21, 0.55]],
			[1000, [251, 146, 60, 0.65]],
			[2000, [244, 63, 94, 0.7]],
			[3000, [217, 70, 239, 0.75]],
			[4500, [255, 255, 255, 0.8]]
		],
		legend: [100, 500, 1000, 2000, 3000],
		text: (v) => (v < 100 ? '' : round(v))
	},
	{
		id: 'li',
		label: 'Lifted index',
		icon: 'icon-[mingcute--arrow-up-circle-line]',
		group: 'storm',
		key: 'li',
		unit: '',
		hint: 'How unstable the air is: below 0 storms can form, below −4 strong ones',
		stops: [
			[-8, [217, 70, 239, 0.75]],
			[-6, [244, 63, 94, 0.7]],
			[-4, [251, 146, 60, 0.65]],
			[-2, [250, 204, 21, 0.55]],
			[0, [74, 222, 128, 0.3]],
			[1, [0, 0, 0, 0]]
		],
		legend: [-8, -6, -4, -2, 0],
		text: (v) => (v > 0 ? '' : v.toFixed(0))
	},
	{
		id: 'shear',
		label: 'Deep shear',
		icon: 'icon-[mingcute--cloud-windy-line]',
		group: 'storm',
		key: 'shear',
		unit: 'm/s',
		hint: 'Wind shear 0–6 km: it organises storms; from 20 supercells',
		stops: [
			[8, [0, 0, 0, 0]],
			[12, [56, 189, 248, 0.4]],
			[16, [74, 222, 128, 0.5]],
			[20, [250, 204, 21, 0.6]],
			[25, [251, 146, 60, 0.65]],
			[30, [244, 63, 94, 0.7]],
			[40, [217, 70, 239, 0.75]]
		],
		legend: [12, 16, 20, 25, 30, 40],
		text: (v) => (v < 12 ? '' : round(v))
	}
];

/** What a value of the grid can be: the smooth curves between its points can overshoot */
const LIMITS: Record<string, [number, number]> = {
	rain: [0, Infinity],
	snowShare: [0, 1],
	clouds: [0, 100],
	wind: [0, Infinity],
	gust: [0, Infinity],
	cape: [0, Infinity],
	shear: [0, Infinity],
	risk: [0, 4]
};
export function limit(key: string, value: number) {
	const [min, max] = LIMITS[key] ?? [-Infinity, Infinity];
	return Math.max(min, Math.min(max, value));
}

/** Where a value is on a layer's legend (0–1): its stops are spread evenly along it */
export function legendAt(layer: MapLayer, value: number) {
	const stops = layer.stops;
	const n = stops.length;
	if (layer.steps) {
		const i = stops.findIndex(([at]) => at > value);
		return ((i < 0 ? n - 1 : Math.max(0, i - 1)) + 0.5) / n;
	}
	if (value <= stops[0][0]) return 0;
	for (let i = 1; i < n; i++)
		if (value <= stops[i][0])
			return (i - 1 + (value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])) / (n - 1);
	return 1;
}

/** A layer's colours as a CSS gradient (for its legend) */
export function legendGradient(layer: MapLayer) {
	const stops = layer.stops;
	const n = stops.length;
	// Strong enough to see on the bar (the map's are see-through)
	const css = ([r, g, b, a]: Rgba) =>
		`rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.min(1, Math.max(a, 0.15) * 1.3)})`;
	const parts = stops.map(([, colour], i) =>
		layer.steps
			? `${css(colour)} ${(i / n) * 100}% ${((i + 1) / n) * 100}%`
			: `${css(colour)} ${(i / (n - 1)) * 100}%`
	);
	return `linear-gradient(90deg, ${parts.join(', ')})`;
}
