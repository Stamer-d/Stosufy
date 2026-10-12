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

// --- The air above a place: sounding, hodograph and the parameters chasers use -------------

export const LEVELS_HPA = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200];

export interface ProfileLevel {
	/** hPa */
	p: number;
	/** °C */
	t: number;
	td: number;
	/** Height above ground, m */
	h: number;
	/** Wind, m/s (u to the east, v to the north) */
	u: number;
	v: number;
	speed: number;
}

export interface StormProfile {
	time: number;
	/** From the ground up (levels below the ground left out) */
	levels: ProfileLevel[];
	surface: { t: number; td: number; p: number; u: number; v: number };
	cape: number;
	cin: number;
	li: number;
	/** Cloud base, m above ground */
	lcl: number;
	freezing: number;
	/** Bulk shear 0–1 km and 0–6 km, m/s */
	shear1: number;
	shear6: number;
	/** Storm relative helicity, m²/s² */
	srh1: number;
	srh3: number;
	/** How a right-moving supercell would move (Bunkers), m/s */
	motion: { u: number; v: number; speed: number; towards: number };
	/** Significant tornado and supercell composite */
	stp: number;
	scp: number;
	hail: boolean;
}

const uv = (speed: number, from: number) => {
	const rad = (from * Math.PI) / 180;
	return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad) };
};

/** The wind at a height above ground, between the levels */
function windAt(levels: ProfileLevel[], height: number) {
	if (height <= levels[0].h) return { u: levels[0].u, v: levels[0].v };
	for (let i = 1; i < levels.length; i++) {
		if (levels[i].h >= height) {
			const a = levels[i - 1];
			const b = levels[i];
			const t = (height - a.h) / (b.h - a.h || 1);
			return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t };
		}
	}
	const last = levels[levels.length - 1];
	return { u: last.u, v: last.v };
}

/** Storm relative helicity from the ground to a height, for a storm motion */
function helicity(levels: ProfileLevel[], top: number, motion: { u: number; v: number }) {
	const points: { u: number; v: number }[] = [];
	for (let h = 0; h <= top; h += 250) points.push(windAt(levels, h));
	let srh = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		srh += (b.u - motion.u) * (a.v - motion.v) - (a.u - motion.u) * (b.v - motion.v);
	}
	return srh;
}

/** The sounding and parameters at a place, at the hour nearest a time */
export async function stormProfile(
	lat: number,
	lon: number,
	time = Date.now()
): Promise<StormProfile> {
	const levelVars = LEVELS_HPA.flatMap((p) => [
		`temperature_${p}hPa`,
		`dew_point_${p}hPa`,
		`wind_speed_${p}hPa`,
		`wind_direction_${p}hPa`,
		`geopotential_height_${p}hPa`
	]);
	const vars = [
		'temperature_2m',
		'dew_point_2m',
		'surface_pressure',
		'wind_speed_10m',
		'wind_direction_10m',
		'cape',
		'convective_inhibition',
		'lifted_index',
		'freezing_level_height',
		...levelVars
	].join(',');
	const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${vars}&wind_speed_unit=ms&timezone=GMT&forecast_days=3`;
	const data = await (await fetch(url)).json();
	const h = data.hourly;
	const elevation = data.elevation ?? 0;
	const times: number[] = h.time.map((t: string) => new Date(t + 'Z').getTime());
	let i = 0;
	for (let k = 0; k < times.length; k++)
		if (Math.abs(times[k] - time) < Math.abs(times[i] - time)) i = k;
	const value = (name: string) => h[name]?.[i] ?? null;

	const surfaceWind = uv(value('wind_speed_10m') ?? 0, value('wind_direction_10m') ?? 0);
	const surface = {
		t: value('temperature_2m') ?? 15,
		td: value('dew_point_2m') ?? 10,
		p: value('surface_pressure') ?? 1013,
		...surfaceWind
	};
	const levels: ProfileLevel[] = [
		{
			p: surface.p,
			t: surface.t,
			td: surface.td,
			h: 10,
			u: surface.u,
			v: surface.v,
			speed: Math.hypot(surface.u, surface.v)
		}
	];
	for (const p of LEVELS_HPA) {
		const z = value(`geopotential_height_${p}hPa`);
		if (p >= surface.p || z == null || z - elevation <= 10) continue;
		const wind = uv(value(`wind_speed_${p}hPa`) ?? 0, value(`wind_direction_${p}hPa`) ?? 0);
		levels.push({
			p,
			t: value(`temperature_${p}hPa`) ?? 0,
			td: value(`dew_point_${p}hPa`) ?? value(`temperature_${p}hPa`) - 20,
			h: z - elevation,
			...wind,
			speed: Math.hypot(wind.u, wind.v)
		});
	}

	// Bunkers: the mean wind of the lowest 6 km, 7.5 m/s to the right of the shear
	const mean = { u: 0, v: 0 };
	const samples = 25;
	for (let k = 0; k < samples; k++) {
		const w = windAt(levels, (6000 * k) / (samples - 1));
		mean.u += w.u / samples;
		mean.v += w.v / samples;
	}
	const top = windAt(levels, 6000);
	const low = windAt(levels, 0);
	const shearU = top.u - low.u;
	const shearV = top.v - low.v;
	const shear6 = Math.hypot(shearU, shearV);
	const motionU = mean.u + (7.5 * shearV) / (shear6 || 1);
	const motionV = mean.v - (7.5 * shearU) / (shear6 || 1);
	const motion = {
		u: motionU,
		v: motionV,
		speed: Math.hypot(motionU, motionV),
		towards: ((Math.atan2(motionU, motionV) * 180) / Math.PI + 360) % 360
	};
	const one = windAt(levels, 1000);
	const shear1 = Math.hypot(one.u - low.u, one.v - low.v);
	const srh1 = helicity(levels, 1000, motion);
	const srh3 = helicity(levels, 3000, motion);
	const cape = value('cape') ?? 0;
	const cin = value('convective_inhibition') ?? 0;
	// Cloud base from the spread of temperature and dew point
	const lcl = Math.max(0, 125 * (surface.t - surface.td));
	const freezing = value('freezing_level_height') ?? 0;

	const lclTerm = lcl < 1000 ? 1 : lcl > 2000 ? 0 : (2000 - lcl) / 1000;
	const cinTerm = cin > -50 ? 1 : cin < -200 ? 0 : (200 + cin) / 150;
	const shearTerm = shear6 < 12.5 ? 0 : Math.min(1.5, shear6 / 20);
	const stp = Math.max(0, (cape / 1500) * lclTerm * (srh1 / 150) * shearTerm * cinTerm);
	const scp = Math.max(
		0,
		(cape / 1000) * (srh3 / 50) * (shear6 < 10 ? 0 : Math.min(1, shear6 / 20))
	);
	return {
		time: times[i],
		levels,
		surface,
		cape,
		cin,
		li: value('lifted_index') ?? 0,
		lcl,
		freezing,
		shear1,
		shear6,
		srh1,
		srh3,
		motion,
		stp,
		scp,
		hail: cape >= 1000 && shear6 >= 15 && freezing > 0 && freezing < 4000
	};
}

/** A compass direction for degrees */
export function compass(degrees: number) {
	const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
	return names[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/**
 * Lightning on a map: older strikes fade from white to red, new ones flash as a cross
 * (like on lightning maps)
 */
export function drawStrikes(
	c: CanvasRenderingContext2D,
	list: { time: number; lat: number; lon: number }[],
	toScreen: (lat: number, lon: number) => { x: number; y: number },
	width: number,
	height: number,
	size = 1
) {
	const now = Date.now();
	for (const strike of list) {
		const age = (now - strike.time) / 60000;
		if (age > 30) continue;
		const { x, y } = toScreen(strike.lat, strike.lon);
		if (x < -10 || y < -10 || x > width + 10 || y > height + 10) continue;
		const colour =
			age < 1
				? '#ffffff'
				: age < 5
					? '#fde047'
					: age < 10
						? '#fb923c'
						: age < 20
							? '#ef4444'
							: '#7f1d1d';
		if (age < 0.25) {
			// Just now: a bright cross with a glow
			const grow = 1 + (0.25 - age) * 8;
			c.strokeStyle = '#ffffff';
			c.lineWidth = 2 * size;
			c.shadowColor = '#fde047';
			c.shadowBlur = 12;
			c.beginPath();
			c.moveTo(x - 6 * size * grow, y);
			c.lineTo(x + 6 * size * grow, y);
			c.moveTo(x, y - 6 * size * grow);
			c.lineTo(x, y + 6 * size * grow);
			c.stroke();
			c.shadowBlur = 0;
		} else {
			c.fillStyle = colour;
			c.beginPath();
			c.arc(x, y, (age < 5 ? 2.4 : 1.8) * size, 0, Math.PI * 2);
			c.fill();
		}
	}
}

// --- Map fields of the forecast (colour scales like on convection maps) ---------------------

type Rgba = [number, number, number, number];

function scale(stops: [number, Rgba][], value: number): Rgba {
	if (value <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [at, colour] = stops[i];
		if (value <= at) {
			const [from, previous] = stops[i - 1];
			const t = (value - from) / (at - from);
			return previous.map((v, k) => v + (colour[k] - v) * t) as Rgba;
		}
	}
	return stops[stops.length - 1][1];
}

export interface Field {
	id: string;
	label: string;
	unit: string;
	/** What it shows, in a few words */
	hint: string;
	/** Its value at a forecast hour of a point */
	value: (hour: StormHour) => number;
	colour: (value: number) => Rgba;
	/** Values for the legend */
	legend: number[];
}

export const FIELDS: Field[] = [
	{
		id: 'risk',
		label: 'Storm risk',
		unit: '',
		hint: 'Energy, instability and shear together, from quiet to high',
		value: (h) => levelOf(h.cape, h.li, h.shear, h.thunder),
		colour: (v) =>
			v < 0.5
				? [0, 0, 0, 0]
				: (([r, g, b]) => [r, g, b, 0.3 + v * 0.1])(
						LEVELS[Math.min(4, Math.round(v))].colour
							.slice(1)
							.match(/../g)!
							.map((x) => parseInt(x, 16))
					),
		legend: [1, 2, 3, 4]
	},
	{
		id: 'cape',
		label: 'CAPE',
		unit: 'J/kg',
		hint: 'Energy for storms: from 500 storms can grow, from 2000 they can be violent',
		value: (h) => h.cape,
		colour: capeColour,
		legend: [100, 500, 1000, 2000, 3000]
	},
	{
		id: 'li',
		label: 'Lifted index',
		unit: '',
		hint: 'How unstable the air is: below 0 storms can form, below −4 strong ones',
		value: (h) => h.li,
		colour: (v) =>
			scale(
				[
					[-8, [217, 70, 239, 0.7]],
					[-6, [244, 63, 94, 0.65]],
					[-4, [251, 146, 60, 0.6]],
					[-2, [250, 204, 21, 0.5]],
					[0, [74, 222, 128, 0.25]],
					[1, [0, 0, 0, 0]]
				],
				v
			),
		legend: [0, -2, -4, -6, -8]
	},
	{
		id: 'shear',
		label: 'Deep shear',
		unit: 'm/s',
		hint: 'Wind shear 0–6 km: it organises storms; from 20 supercells',
		value: (h) => h.shear,
		colour: (v) =>
			scale(
				[
					[8, [0, 0, 0, 0]],
					[12, [56, 189, 248, 0.35]],
					[16, [74, 222, 128, 0.45]],
					[20, [250, 204, 21, 0.55]],
					[25, [251, 146, 60, 0.6]],
					[30, [244, 63, 94, 0.65]],
					[40, [217, 70, 239, 0.7]]
				],
				v
			),
		legend: [12, 16, 20, 25, 30]
	},
	{
		id: 'gust',
		label: 'Gusts',
		unit: 'km/h',
		hint: 'The strongest gusts expected',
		value: (h) => h.gust * 3.6,
		colour: (v) =>
			scale(
				[
					[40, [0, 0, 0, 0]],
					[55, [250, 204, 21, 0.45]],
					[75, [251, 146, 60, 0.55]],
					[100, [244, 63, 94, 0.65]],
					[130, [217, 70, 239, 0.7]]
				],
				v
			),
		legend: [55, 75, 100, 130]
	}
];

// --- DWD warnings as areas ---------------------------------------------------------------------

export interface WarningArea {
	event: string;
	headline: string;
	description: string;
	severity: 'minor' | 'moderate' | 'severe' | 'extreme';
	onset: string | null;
	expires: string | null;
	/** Rings of [lon, lat] */
	rings: [number, number][][];
}

export const SEVERITY_COLOURS: Record<WarningArea['severity'], string> = {
	minor: '#facc15',
	moderate: '#fb923c',
	severe: '#ef4444',
	extreme: '#c026d3'
};

/** The DWD's current warnings for Germany as areas (merged municipalities) */
export async function warningAreas(
	fetcher: (url: string) => Promise<Response>
): Promise<WarningArea[]> {
	const url =
		'https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=1.0.0&request=GetFeature' +
		'&typeName=dwd:Warnungen_Gemeinden_vereinigt&outputFormat=application/json&srsName=EPSG:4326';
	const response = await fetcher(url);
	if (!response.ok) throw new Error(`DWD answered with HTTP ${response.status}`);
	const data = await response.json();
	const order = ['minor', 'moderate', 'severe', 'extreme'];
	return (data.features ?? [])
		.map((feature: any) => {
			const p = feature.properties ?? {};
			const severity = String(p.SEVERITY ?? 'Minor').toLowerCase();
			const geometry = feature.geometry ?? {};
			const polygons =
				geometry.type === 'MultiPolygon'
					? geometry.coordinates
					: geometry.type === 'Polygon'
						? [geometry.coordinates]
						: [];
			return {
				event: p.EVENT ?? '',
				headline: p.HEADLINE ?? p.EVENT ?? '',
				description: p.DESCRIPTION ?? '',
				severity: order.includes(severity) ? severity : 'minor',
				onset: p.ONSET ?? null,
				expires: p.EXPIRES ?? null,
				rings: polygons.flat()
			};
		})
		.filter((area: WarningArea) => area.rings.length)
		.sort(
			(a: WarningArea, b: WarningArea) => order.indexOf(a.severity) - order.indexOf(b.severity)
		);
}
