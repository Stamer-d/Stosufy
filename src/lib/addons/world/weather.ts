// The weather from Open-Meteo (no account needed): a place's forecast the way weather apps
// show it (now, rain in the next two hours, hour by hour, two weeks), and the weather over an
// area as a grid of points for the maps (temperature, wind, rain and snow, clouds, gusts,
// pressure), hour by hour for the next three days.

/** Open-Meteo's answer, or an error with its reason (e.g. too many requests today) */
export async function openMeteo(url: string) {
	const response = await fetch(url);
	const data = await response.json().catch(() => null);
	if (!response.ok || !data || data.error)
		throw new Error(data?.reason ?? `Open-Meteo answered ${response.status}`);
	return data;
}

// --- What the sky does (WMO weather codes) ---------------------------------------------------

export type Sky =
	| 'clear'
	| 'partly'
	| 'cloudy'
	| 'overcast'
	| 'fog'
	| 'drizzle'
	| 'rain'
	| 'heavy-rain'
	| 'showers'
	| 'sleet'
	| 'snow'
	| 'snow-showers'
	| 'thunder'
	| 'hail';

const CODES: Record<number, [Sky, string]> = {
	0: ['clear', 'Clear'],
	1: ['partly', 'Mostly clear'],
	2: ['partly', 'Partly cloudy'],
	3: ['overcast', 'Overcast'],
	45: ['fog', 'Fog'],
	48: ['fog', 'Freezing fog'],
	51: ['drizzle', 'Light drizzle'],
	53: ['drizzle', 'Drizzle'],
	55: ['drizzle', 'Heavy drizzle'],
	56: ['sleet', 'Freezing drizzle'],
	57: ['sleet', 'Freezing drizzle'],
	61: ['rain', 'Light rain'],
	63: ['rain', 'Rain'],
	65: ['heavy-rain', 'Heavy rain'],
	66: ['sleet', 'Freezing rain'],
	67: ['sleet', 'Heavy freezing rain'],
	71: ['snow', 'Light snow'],
	73: ['snow', 'Snow'],
	75: ['snow', 'Heavy snow'],
	77: ['snow', 'Snow grains'],
	80: ['showers', 'Showers'],
	81: ['showers', 'Rain showers'],
	82: ['heavy-rain', 'Violent showers'],
	85: ['snow-showers', 'Snow showers'],
	86: ['snow-showers', 'Heavy snow showers'],
	95: ['thunder', 'Thunderstorm'],
	96: ['hail', 'Thunderstorm, hail'],
	99: ['hail', 'Thunderstorm, heavy hail']
};

/** A weather code as what the sky does and in words */
export function skyOf(code: number): { sky: Sky; label: string } {
	const [sky, label] = CODES[code] ?? CODES[3];
	return { sky, label };
}

/** Wet weather (for the backgrounds) */
export const WET: Sky[] = ['drizzle', 'rain', 'heavy-rain', 'showers', 'sleet', 'thunder', 'hail'];
export const WHITE: Sky[] = ['snow', 'snow-showers'];

export type Mood = 'sun' | 'partly' | 'night' | 'cloudy' | 'dark' | 'rain' | 'storm' | 'snow';

/** How the sky looks (for the backgrounds of the weather now) */
export function moodOf(code: number, isDay: boolean): Mood {
	const { sky } = skyOf(code);
	if (sky === 'thunder' || sky === 'hail') return 'storm';
	if (WHITE.includes(sky)) return 'snow';
	if (WET.includes(sky)) return 'rain';
	if (sky === 'clear') return isDay ? 'sun' : 'night';
	if (sky === 'partly') return isDay ? 'partly' : 'night';
	return isDay ? 'cloudy' : 'dark';
}

/** The sky's colours, as a gradient's (Tailwind) */
export const SKY_GRADIENTS: Record<Mood, string> = {
	sun: 'from-[#3a9cf0] via-[#2a78d6] to-[#1b4fa6]',
	partly: 'from-[#4a90d0] via-[#3a6fab] to-[#2a4b7c]',
	night: 'from-[#1d2a5e] via-[#141c40] to-[#0a0f24]',
	cloudy: 'from-[#66788f] via-[#4b5a6f] to-[#2d3747]',
	dark: 'from-[#323c4d] via-[#232b38] to-[#151a23]',
	rain: 'from-[#46607c] via-[#334659] to-[#1c2633]',
	storm: 'from-[#433a5c] via-[#2a2440] to-[#14111f]',
	snow: 'from-[#8193ac] via-[#5f6f88] to-[#3a475c]'
};

// --- Wind --------------------------------------------------------------------------------------

const BEAUFORT_KMH = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
export const BEAUFORT_NAMES = [
	'Calm',
	'Light air',
	'Light breeze',
	'Gentle breeze',
	'Moderate breeze',
	'Fresh breeze',
	'Strong breeze',
	'Near gale',
	'Gale',
	'Strong gale',
	'Storm',
	'Violent storm',
	'Hurricane force'
];

/** The Beaufort number of a wind speed (km/h) */
export function beaufort(kmh: number) {
	let force = 0;
	while (force < BEAUFORT_KMH.length && kmh >= BEAUFORT_KMH[force]) force++;
	return force;
}

/** A direction in degrees as a name (16 of them) */
export function direction(degrees: number) {
	const names = [
		'N',
		'NNE',
		'NE',
		'ENE',
		'E',
		'ESE',
		'SE',
		'SSE',
		'S',
		'SSW',
		'SW',
		'WSW',
		'W',
		'WNW',
		'NW',
		'NNW'
	];
	return names[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** The wind's vector, m/s the way it blows to (u to the east, v to the north) */
export function windVector(speed: number, from: number) {
	const rad = (from * Math.PI) / 180;
	return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
}

// --- Colours of the weather (the maps and the forecast use the same) ---------------------------

export type Rgba = [number, number, number, number];
export type Stops = [number, Rgba][];

/** A colour between stops */
export function colourAt(stops: Stops, value: number, steps = false): Rgba {
	if (!(value > stops[0][0])) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [at, colour] = stops[i];
		if (value < at) {
			const [from, previous] = stops[i - 1];
			if (steps) return previous;
			const t = (value - from) / (at - from);
			return previous.map((v, k) => v + (colour[k] - v) * t) as Rgba;
		}
	}
	return stops[stops.length - 1][1];
}

export const TEMPERATURE: Stops = [
	[-40, [118, 32, 140, 0.78]],
	[-30, [150, 70, 210, 0.78]],
	[-20, [92, 88, 228, 0.78]],
	[-10, [52, 128, 240, 0.78]],
	[-5, [56, 168, 246, 0.78]],
	[0, [96, 208, 240, 0.78]],
	[5, [64, 196, 168, 0.78]],
	[10, [96, 202, 88, 0.78]],
	[15, [186, 218, 60, 0.78]],
	[20, [250, 208, 48, 0.78]],
	[25, [250, 148, 40, 0.78]],
	[30, [240, 80, 42, 0.78]],
	[35, [198, 30, 52, 0.78]],
	[40, [148, 20, 92, 0.78]]
];

export const WIND: Stops = [
	[0, [36, 58, 132, 0.72]],
	[10, [38, 108, 190, 0.72]],
	[20, [44, 158, 170, 0.72]],
	[30, [68, 180, 108, 0.72]],
	[40, [150, 200, 60, 0.74]],
	[50, [232, 200, 48, 0.76]],
	[65, [242, 140, 40, 0.78]],
	[80, [230, 70, 50, 0.8]],
	[100, [190, 40, 110, 0.82]],
	[130, [140, 40, 170, 0.84]]
];

/** A temperature as a CSS colour (fully opaque, for text and bars) */
export function temperatureCss(celsius: number) {
	const [r, g, b] = colourAt(TEMPERATURE, celsius);
	return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/** A wind speed (km/h) as a CSS colour */
export function windCss(kmh: number) {
	const [r, g, b] = colourAt(WIND, kmh);
	// Light winds a little brighter: they'd vanish on a dark background
	const lift = kmh < 20 ? 60 * (1 - kmh / 20) : 0;
	return `rgb(${Math.round(r + lift)}, ${Math.round(g + lift)}, ${Math.round(b + lift / 2)})`;
}

// --- A place's forecast --------------------------------------------------------------------------

export interface WeatherHour {
	/** ms */
	time: number;
	/** The hour of the day where the place is */
	hour: number;
	/** The day where the place is, YYYY-MM-DD */
	day: string;
	temp: number;
	feels: number;
	/** % */
	rainChance: number;
	/** mm */
	rain: number;
	/** cm */
	snow: number;
	code: number;
	isDay: boolean;
	/** km/h */
	wind: number;
	gust: number;
	/** Where the wind comes from, degrees */
	windFrom: number;
	humidity: number;
	uv: number;
	/** hPa */
	pressure: number;
	/** m */
	visibility: number;
	clouds: number;
	dew: number;
}

export interface WeatherDay {
	/** YYYY-MM-DD where the place is */
	day: string;
	code: number;
	max: number;
	min: number;
	/** mm */
	rain: number;
	rainChance: number;
	/** km/h */
	wind: number;
	gust: number;
	windFrom: number;
	/** ms */
	sunrise: number;
	sunset: number;
	uv: number;
	/** Hours of sunshine */
	sunshine: number;
}

export interface PlaceWeather {
	/** Right now */
	now: WeatherHour;
	/** Rain in quarter hours for the next two hours (mm in each) */
	quarters: { time: number; rain: number }[];
	/** From this hour on, three days */
	hours: WeatherHour[];
	/** Today and the next 13 days */
	days: WeatherDay[];
	/** The place's time zone (for showing its times) */
	timezone: string;
	/** ms */
	loaded: number;
}

const PLACE_HOURLY = [
	'temperature_2m',
	'apparent_temperature',
	'precipitation_probability',
	'precipitation',
	'snowfall',
	'weather_code',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m',
	'is_day',
	'relative_humidity_2m',
	'uv_index',
	'pressure_msl',
	'visibility',
	'cloud_cover',
	'dew_point_2m'
];
const PLACE_DAILY = [
	'weather_code',
	'temperature_2m_max',
	'temperature_2m_min',
	'precipitation_sum',
	'precipitation_probability_max',
	'wind_speed_10m_max',
	'wind_gusts_10m_max',
	'wind_direction_10m_dominant',
	'sunrise',
	'sunset',
	'uv_index_max',
	'sunshine_duration'
];
const PLACE_CURRENT = [
	'temperature_2m',
	'apparent_temperature',
	'relative_humidity_2m',
	'is_day',
	'weather_code',
	'cloud_cover',
	'pressure_msl',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m',
	'precipitation',
	'snowfall',
	'dew_point_2m',
	'visibility',
	'uv_index'
];

/** The forecast for a place */
export async function placeForecast(lat: number, lon: number): Promise<PlaceWeather> {
	const url =
		`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
		`&current=${PLACE_CURRENT.join(',')}&minutely_15=precipitation&forecast_minutely_15=12` +
		`&hourly=${PLACE_HOURLY.join(',')}&daily=${PLACE_DAILY.join(',')}` +
		`&timezone=auto&forecast_days=14`;
	const data = await openMeteo(url);
	const offset = (data.utc_offset_seconds ?? 0) * 1000;
	const ms = (local: string) => new Date(local + 'Z').getTime() - offset;
	const h = data.hourly;
	const at = (name: string, i: number) => h[name]?.[i] ?? 0;
	const hourAt = (i: number): WeatherHour => ({
		time: ms(h.time[i]),
		hour: Number(h.time[i].slice(11, 13)),
		day: h.time[i].slice(0, 10),
		temp: at('temperature_2m', i),
		feels: at('apparent_temperature', i),
		rainChance: at('precipitation_probability', i),
		rain: at('precipitation', i),
		snow: at('snowfall', i),
		code: at('weather_code', i),
		isDay: at('is_day', i) === 1,
		wind: at('wind_speed_10m', i),
		gust: at('wind_gusts_10m', i),
		windFrom: at('wind_direction_10m', i),
		humidity: at('relative_humidity_2m', i),
		uv: at('uv_index', i),
		pressure: at('pressure_msl', i),
		visibility: at('visibility', i),
		clouds: at('cloud_cover', i),
		dew: at('dew_point_2m', i)
	});
	const now = Date.now();
	const all: WeatherHour[] = h.time.map((_: string, i: number) => hourAt(i));
	const first = Math.max(
		0,
		all.findIndex((hour) => hour.time > now - 3600e3)
	);
	const hours = all.slice(first, first + 72);

	const c = data.current ?? {};
	const current = hours[0] ?? all[all.length - 1];
	const nowHour: WeatherHour = {
		...current,
		time: c.time ? ms(c.time) : now,
		temp: c.temperature_2m ?? current.temp,
		feels: c.apparent_temperature ?? current.feels,
		humidity: c.relative_humidity_2m ?? current.humidity,
		isDay: c.is_day != null ? c.is_day === 1 : current.isDay,
		code: c.weather_code ?? current.code,
		clouds: c.cloud_cover ?? current.clouds,
		pressure: c.pressure_msl ?? current.pressure,
		wind: c.wind_speed_10m ?? current.wind,
		windFrom: c.wind_direction_10m ?? current.windFrom,
		gust: c.wind_gusts_10m ?? current.gust,
		rain: c.precipitation ?? current.rain,
		snow: c.snowfall ?? current.snow,
		dew: c.dew_point_2m ?? current.dew,
		visibility: c.visibility ?? current.visibility,
		uv: c.uv_index ?? current.uv
	};

	const m = data.minutely_15 ?? { time: [], precipitation: [] };
	const quarters = (m.time as string[])
		.map((t, i) => ({ time: ms(t), rain: m.precipitation[i] ?? 0 }))
		.filter((q) => q.time > now - 15 * 60e3)
		.slice(0, 9);

	const d = data.daily;
	const days: WeatherDay[] = (d.time as string[]).map((day, i) => ({
		day,
		code: d.weather_code[i] ?? 3,
		max: d.temperature_2m_max[i] ?? 0,
		min: d.temperature_2m_min[i] ?? 0,
		rain: d.precipitation_sum[i] ?? 0,
		rainChance: d.precipitation_probability_max[i] ?? 0,
		wind: d.wind_speed_10m_max[i] ?? 0,
		gust: d.wind_gusts_10m_max[i] ?? 0,
		windFrom: d.wind_direction_10m_dominant[i] ?? 0,
		sunrise: d.sunrise[i] ? ms(d.sunrise[i]) : 0,
		sunset: d.sunset[i] ? ms(d.sunset[i]) : 0,
		uv: d.uv_index_max[i] ?? 0,
		sunshine: (d.sunshine_duration[i] ?? 0) / 3600
	}));

	return {
		now: nowHour,
		quarters,
		hours,
		days,
		timezone: data.timezone ?? 'UTC',
		loaded: now
	};
}

// --- The weather over an area, as a grid (for the maps) ------------------------------------------

export interface Area {
	north: number;
	south: number;
	west: number;
	east: number;
}

export interface WeatherGrid extends Area {
	columns: number;
	rows: number;
	/** Degrees between the columns and between the rows */
	step: number;
	latStep: number;
	/** The hours, ms */
	times: number[];
	/** By name: a value per hour, row (the north first) and column */
	values: Record<string, Float32Array>;
	/** When it was loaded, ms */
	loaded: number;
}

/**
 * How many columns across the view: each point counts as a request with Open-Meteo (600 a
 * minute, 10 000 a day are free), and the smooth curves between them make up for the rest
 */
const ACROSS = 9;
/** How much more than the view a grid covers (so moving a little doesn't load it again) */
const MARGIN = 0.2;

const round = (value: number) => Math.round(value * 1000) / 1000;
/** A step of the grid that's a round number of degrees */
function niceStep(degrees: number) {
	const nice = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
	return nice.find((step) => step >= degrees) ?? 12;
}

/** The grid that suits a view: its area (a bit more than the view) and its steps */
export function gridFor(view: Area) {
	const span = Math.max(0.1, view.east - view.west);
	const step = niceStep(span / ACROSS);
	const middle = (((view.north + view.south) / 2) * Math.PI) / 180;
	// Rows about as far apart on the screen as the columns (the map stretches the north)
	const latStep = niceStep(step * Math.max(0.25, Math.cos(middle)));
	const latSpan = Math.max(latStep, view.north - view.south);
	const north = Math.min(85, Math.ceil((view.north + latSpan * MARGIN) / latStep) * latStep);
	const south = Math.max(-85, Math.floor((view.south - latSpan * MARGIN) / latStep) * latStep);
	const west = Math.floor((view.west - span * MARGIN) / step) * step;
	const east = Math.ceil((view.east + span * MARGIN) / step) * step;
	return {
		north: round(north),
		south: round(south),
		west: round(west),
		east: round(east),
		step,
		latStep,
		columns: Math.round((east - west) / step) + 1,
		rows: Math.round((north - south) / latStep) + 1
	};
}

export type GridArea = ReturnType<typeof gridFor>;

/** Whether a grid shows a view well: all of it, and fine enough */
export function gridFits(grid: WeatherGrid, view: Area) {
	const span = Math.max(0.1, view.east - view.west);
	if (grid.step > 1.6 * niceStep(span / ACROSS)) return false;
	if (view.north > grid.north + 0.01 && grid.north < 85) return false;
	if (view.south < grid.south - 0.01 && grid.south > -85) return false;
	// The world repeats east and west
	return [0, -360, 360].some(
		(shift) => view.west + shift >= grid.west - 0.01 && view.east + shift <= grid.east + 0.01
	);
}

/** A longitude as Open-Meteo takes it (−180 to 180) */
const wrap = (lon: number) => round(((((lon + 180) % 360) + 360) % 360) - 180);

/**
 * The points of an area from Open-Meteo, each hour from this one on: `read` makes the values
 * of an hour of a point
 */
export async function loadGrid(
	area: GridArea,
	hourly: string[],
	hours: number,
	read: (h: any, i: number) => Record<string, number>
): Promise<WeatherGrid> {
	const { columns, rows } = area;
	const lats: number[] = [];
	const lons: number[] = [];
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < columns; c++) {
			lats.push(round(area.north - r * area.latStep));
			lons.push(wrap(area.west + c * area.step));
		}
	const url =
		`https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
		`&hourly=${hourly.join(',')}&wind_speed_unit=ms&timezone=GMT&forecast_hours=${hours}`;
	const data = await openMeteo(url);
	const list = Array.isArray(data) ? data : [data];
	const now = Date.now();
	const first = list[0].hourly.time.map((t: string) => new Date(t + 'Z').getTime());
	const start = Math.max(
		0,
		first.findIndex((time: number) => time > now - 3600e3)
	);
	const times: number[] = first.slice(start, start + hours);
	const count = columns * rows;
	const values: Record<string, Float32Array> = {};
	list.forEach((point: any, p: number) => {
		for (let k = 0; k < times.length; k++) {
			const hour = read(point.hourly, start + k);
			for (const key in hour) {
				values[key] ??= new Float32Array(times.length * count);
				values[key][k * count + p] = hour[key];
			}
		}
	});
	return {
		north: area.north,
		south: area.south,
		west: area.west,
		east: area.east,
		columns,
		rows,
		step: area.step,
		latStep: area.latStep,
		times,
		values,
		loaded: now
	};
}

const GRID_HOURLY = [
	'temperature_2m',
	'precipitation',
	'snowfall',
	'cloud_cover',
	'pressure_msl',
	'wind_speed_10m',
	'wind_direction_10m',
	'wind_gusts_10m'
];

/** The weather of the next three days over an area */
export function weatherGrid(area: GridArea) {
	return loadGrid(area, GRID_HOURLY, 72, (h, i) => {
		const speed = h.wind_speed_10m[i] ?? 0;
		const { u, v } = windVector(speed, h.wind_direction_10m[i] ?? 0);
		const rain = h.precipitation[i] ?? 0;
		// Snow in cm, as water in mm (7 cm are about 10 mm)
		const snow = (h.snowfall[i] ?? 0) / 0.7;
		return {
			temp: h.temperature_2m[i] ?? 0,
			rain,
			snowShare: snow > 0 ? Math.min(1, snow / Math.max(rain, snow, 0.01)) : 0,
			clouds: h.cloud_cover[i] ?? 0,
			pressure: h.pressure_msl[i] ?? 1013,
			wind: speed * 3.6,
			gust: (h.wind_gusts_10m[i] ?? 0) * 3.6,
			u,
			v
		};
	});
}

/**
 * Keeps the grids loaded for the views (for half an hour): a view that one of them shows well
 * doesn't load another
 */
export function gridCache(load: (area: GridArea) => Promise<WeatherGrid>) {
	let grids: WeatherGrid[] = [];
	const pending = new Map<string, Promise<WeatherGrid>>();
	return {
		/** A grid that's here for a view */
		find(view: Area) {
			const now = Date.now();
			grids = grids.filter((grid) => now - grid.loaded < 30 * 60e3);
			// The finest one that fits
			return (
				grids.filter((grid) => gridFits(grid, view)).sort((a, b) => a.step - b.step)[0] ?? null
			);
		},
		/** The grid for a view, loaded if none is here */
		async get(view: Area) {
			const found = this.find(view);
			if (found) return found;
			const area = gridFor(view);
			const key = JSON.stringify(area);
			let loading = pending.get(key);
			if (!loading) {
				loading = load(area).finally(() => pending.delete(key));
				pending.set(key, loading);
			}
			const grid = await loading;
			if (!grids.includes(grid)) grids = [...grids.slice(-7), grid];
			return grid;
		}
	};
}
