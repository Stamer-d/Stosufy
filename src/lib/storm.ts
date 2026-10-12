// Storm chasing numbers from Open-Meteo (no account needed): the energy for storms (CAPE),
// how unstable the air is (lifted index), the wind shear that organizes storms, gusts and
// dew point, and from them a risk level like the outlooks of storm prediction centres.

export const LEVELS = [
	{ label: 'Quiet', colour: '#4ade80' },
	{ label: 'Marginal', colour: '#facc15' },
	{ label: 'Slight', colour: '#fb923c' },
	{ label: 'Enhanced', colour: '#f43f5e' },
	{ label: 'High', colour: '#d946ef' }
];

export interface StormHour {
	/** Local hour of the day */
	hour: number;
	/** ms */
	time: number;
	cape: number;
	li: number;
	gust: number;
	dew: number;
	rain: number;
	/** 10 m to 500 hPa (about 6 km), m/s */
	shear: number;
	thunder: boolean;
}

export interface StormOutlook {
	hours: StormHour[];
	peak: StormHour;
	shear: number;
	li: number;
	gust: number;
	dew: number;
	thunder: StormHour | undefined;
	level: number;
}

const HOURLY = [
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

/** The wind vector (m/s, the way it blows to) */
function vector(speed: number, from: number) {
	const rad = (from * Math.PI) / 180;
	return [-speed * Math.sin(rad), -speed * Math.cos(rad)];
}

function hoursOf(data: any): StormHour[] {
	const h = data.hourly;
	const offset = (data.utc_offset_seconds ?? 0) * 1000;
	const now = Date.now();
	const all = h.time.map((t: string, i: number) => {
		const [u1, v1] = vector(h.wind_speed_10m[i] ?? 0, h.wind_direction_10m[i] ?? 0);
		const [u2, v2] = vector(h.wind_speed_500hPa[i] ?? 0, h.wind_direction_500hPa[i] ?? 0);
		return {
			hour: Number(t.slice(11, 13)),
			time: new Date(t + 'Z').getTime() - offset,
			cape: h.cape[i] ?? 0,
			li: h.lifted_index[i] ?? 0,
			gust: h.wind_gusts_10m[i] ?? 0,
			dew: h.dew_point_2m[i] ?? 0,
			rain: h.precipitation_probability[i] ?? 0,
			shear: Math.hypot(u2 - u1, v2 - v1),
			thunder: (h.weather_code[i] ?? 0) >= 95
		};
	});
	// From the current hour on
	const start = Math.max(
		0,
		all.findIndex((hour: StormHour) => hour.time > now - 3600e3)
	);
	return all.slice(start);
}

/** The level of storms: energy, instability and shear together */
export function levelOf(cape: number, li: number, shear: number, thunder: boolean) {
	let level = 0;
	if (cape >= 100 || thunder) level = 1;
	if (cape >= 500 && (shear >= 10 || li <= -2)) level = 2;
	if (cape >= 1000 && shear >= 15) level = 3;
	if (cape >= 2000 && shear >= 20) level = 4;
	return level;
}

function outlookOf(hours: StormHour[]): StormOutlook {
	const peak = hours.reduce((a, b) => (b.cape > a.cape ? b : a), hours[0]);
	const li = Math.min(...hours.map((x) => x.li));
	const thunder = hours.find((x) => x.thunder);
	return {
		hours,
		peak,
		shear: Math.max(...hours.map((x) => x.shear)),
		li,
		gust: Math.max(...hours.map((x) => x.gust)),
		dew: Math.max(...hours.map((x) => x.dew)),
		thunder,
		level: levelOf(peak.cape, li, peak.shear, !!thunder)
	};
}

/** The next 24 hours at a place */
export async function stormOutlook(lat: number, lon: number): Promise<StormOutlook> {
	const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${HOURLY}&wind_speed_unit=ms&timezone=auto&forecast_days=2`;
	const data = await (await fetch(url)).json();
	return outlookOf(hoursOf(data).slice(0, 24));
}

/** A grid of places over an area, each with its next 24 hours (for the CAPE map) */
export async function stormGrid(
	north: number,
	south: number,
	west: number,
	east: number,
	columns: number,
	rows: number
): Promise<{ lat: number; lon: number; hours: StormHour[] }[]> {
	const points: { lat: number; lon: number }[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < columns; c++) {
			points.push({
				lat: Math.round((north - ((north - south) * r) / (rows - 1)) * 100) / 100,
				lon: Math.round((west + ((east - west) * c) / (columns - 1)) * 100) / 100
			});
		}
	}
	const url =
		`https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat).join(',')}` +
		`&longitude=${points.map((p) => p.lon).join(',')}&hourly=${HOURLY}&wind_speed_unit=ms&timezone=GMT&forecast_days=2`;
	const data = await (await fetch(url)).json();
	const list = Array.isArray(data) ? data : [data];
	return points.map((point, i) => ({
		...point,
		hours: list[i] ? hoursOf(list[i]).slice(0, 24) : []
	}));
}

/** CAPE as colour, like on convection maps */
export function capeColour(cape: number): [number, number, number, number] {
	const stops: [number, [number, number, number, number]][] = [
		[0, [0, 0, 0, 0]],
		[100, [74, 222, 128, 0.25]],
		[500, [250, 204, 21, 0.5]],
		[1000, [251, 146, 60, 0.6]],
		[2000, [244, 63, 94, 0.65]],
		[3000, [217, 70, 239, 0.7]],
		[4500, [255, 255, 255, 0.75]]
	];
	if (cape <= 0) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [at, colour] = stops[i];
		if (cape <= at) {
			const [from, previous] = stops[i - 1];
			const t = (cape - from) / (at - from);
			return previous.map((v, k) => v + (colour[k] - v) * t) as [number, number, number, number];
		}
	}
	return stops[stops.length - 1][1];
}
