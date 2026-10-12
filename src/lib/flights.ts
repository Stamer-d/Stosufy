// Flights, like on Flightradar24: live positions from the ADS-B community networks
// (airplanes.live, adsb.lol as a fallback), the aircraft and its route from adsbdb, photos
// from planespotters.net. Plus how they're drawn on a map.

import { fastFetch } from './fastFetch';

export interface TrailPoint {
	lat: number;
	lon: number;
	/** ft, 0 on the ground */
	alt: number;
	/** ms */
	time: number;
}

export interface Plane {
	/** ICAO 24-bit address */
	hex: string;
	lat: number;
	lon: number;
	/** Degrees from north */
	track: number;
	/** Ground speed, knots */
	speed: number;
	/** Barometric altitude, ft */
	alt: number;
	/** ft/min */
	vrate: number;
	ground: boolean;
	callsign: string;
	/** ICAO type code (A320, B77W…) */
	type: string;
	registration: string;
	/** The type in words (AIRBUS A-320) */
	desc: string;
	operator: string;
	squawk: string;
	emergency: string;
	/** ADS-B emitter category (A1 light … A5 heavy, A7 helicopter) */
	category: string;
	military: boolean;
	/** When the position was (ms) */
	at: number;
	trail: TrailPoint[];
}

/** One aircraft of the networks' answers as a plane */
export function planeOf(ac: any, received = Date.now(), old?: Plane): Plane | null {
	if (typeof ac?.lat !== 'number' || typeof ac?.lon !== 'number') return null;
	const ground = ac.alt_baro === 'ground';
	const alt = ground ? 0 : typeof ac.alt_baro === 'number' ? ac.alt_baro : (ac.alt_geom ?? 0);
	const at = received - (ac.seen_pos ?? 0) * 1000;
	let trail = old?.trail ?? [];
	const last = trail.at(-1);
	if (!last || last.lat !== ac.lat || last.lon !== ac.lon)
		trail = [...trail, { lat: ac.lat, lon: ac.lon, alt, time: at }];
	// The last hour of where it flew
	if (trail.length > 2 && trail[0].time < at - 60 * 60 * 1000)
		trail = trail.filter((p) => p.time >= at - 60 * 60 * 1000);
	return {
		hex: String(ac.hex ?? '').toLowerCase(),
		lat: ac.lat,
		lon: ac.lon,
		track: ac.track ?? ac.true_heading ?? ac.mag_heading ?? old?.track ?? 0,
		speed: ac.gs ?? 0,
		alt,
		vrate: ac.baro_rate ?? ac.geom_rate ?? 0,
		ground,
		callsign: String(ac.flight ?? '').trim(),
		type: ac.t ?? old?.type ?? '',
		registration: ac.r ?? old?.registration ?? '',
		desc: ac.desc ?? old?.desc ?? '',
		operator: ac.ownOp ?? old?.operator ?? '',
		squawk: ac.squawk ?? '',
		emergency: ac.emergency && ac.emergency !== 'none' ? ac.emergency : '',
		category: ac.category ?? '',
		military: !!((ac.dbFlags ?? 0) & 1),
		at,
		trail
	};
}

/** Where a plane is now: on from its last position along its track at its speed */
export function planeNow(plane: Plane, time = Date.now()) {
	if (plane.ground || !plane.speed) return { lat: plane.lat, lon: plane.lon };
	const seconds = Math.max(0, Math.min(40, (time - plane.at) / 1000));
	const km = (plane.speed * 1.852 * seconds) / 3600;
	const rad = (plane.track * Math.PI) / 180;
	return {
		lat: plane.lat + (km * Math.cos(rad)) / 111.32,
		lon: plane.lon + (km * Math.sin(rad)) / (111.32 * Math.cos((plane.lat * Math.PI) / 180))
	};
}

// --- The networks ---------------------------------------------------------------------------

// airplanes.live allows about a request a second: all its requests wait their turn
let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;
function inTurn<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = lastRequest + 1100 - Date.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		lastRequest = Date.now();
		return task();
	});
	queue = run.catch(() => {});
	return run;
}

async function aircraftList(path: string, fallback?: string): Promise<any[]> {
	const sources = [
		() => inTurn(() => fastFetch(`https://api.airplanes.live/v2/${path}`)),
		...(fallback ? [() => fastFetch(`https://api.adsb.lol/v2/${fallback}`)] : [])
	];
	let failure: unknown = null;
	for (const source of sources) {
		try {
			const response = await source();
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			return data.ac ?? data.aircraft ?? [];
		} catch (error) {
			failure = error;
		}
	}
	throw failure ?? new Error("Couldn't reach the flight data");
}

/** The planes within a radius (nautical miles, 250 at most) of a place */
export const planesAround = (lat: number, lon: number, radiusNm: number) => {
	const r = Math.max(1, Math.min(250, Math.round(radiusNm)));
	const la = lat.toFixed(3);
	const lo = lon.toFixed(3);
	return aircraftList(`point/${la}/${lo}/${r}`, `lat/${la}/lon/${lo}/dist/${r}`);
};
export const planeByHex = (hex: string) => aircraftList(`hex/${hex}`, `hex/${hex}`);
export const planesByCallsign = (callsign: string) =>
	aircraftList(
		`callsign/${encodeURIComponent(callsign)}`,
		`callsign/${encodeURIComponent(callsign)}`
	);
export const planesByRegistration = (reg: string) =>
	aircraftList(`reg/${encodeURIComponent(reg)}`, `reg/${encodeURIComponent(reg)}`);

/** A plane looked for by callsign, registration or ICAO hex */
export async function findPlanes(query: string) {
	const q = query.trim().toUpperCase().replace(/\s+/g, '');
	if (!q) return [];
	if (/^[0-9A-F]{6}$/.test(q)) {
		const byHex = await planeByHex(q.toLowerCase()).catch(() => []);
		if (byHex.length) return byHex;
	}
	const byCallsign = await planesByCallsign(q).catch(() => []);
	if (byCallsign.length) return byCallsign;
	return planesByRegistration(q).catch(() => []);
}

// --- The ones everybody watches -----------------------------------------------------------------

/** What makes a flight one to watch, by ICAO type: the giants and rarities */
const SPECIAL_TYPES: Record<string, { score: number; why: string }> = {
	A124: { score: 70, why: 'Antonov An-124, giant freighter' },
	A225: { score: 90, why: 'Antonov An-225' },
	BLCF: { score: 66, why: 'Boeing Dreamlifter' },
	A3ST: { score: 64, why: 'Airbus Beluga' },
	A337: { score: 66, why: 'Airbus BelugaXL' },
	B748: { score: 52, why: 'Boeing 747-8' },
	A388: { score: 48, why: 'Airbus A380' },
	C5M: { score: 58, why: 'Lockheed C-5 Galaxy' },
	B52: { score: 66, why: 'Boeing B-52 bomber' },
	U2: { score: 72, why: 'Lockheed U-2 spy plane' },
	E3TF: { score: 55, why: 'AWACS radar plane' },
	E3CF: { score: 55, why: 'AWACS radar plane' },
	R135: { score: 54, why: 'RC-135 reconnaissance' },
	Q4: { score: 56, why: 'RQ-4 Global Hawk drone' },
	K35R: { score: 34, why: 'KC-135 tanker' },
	A400: { score: 36, why: 'Airbus A400M' },
	C17: { score: 38, why: 'Boeing C-17 Globemaster' },
	VC25: { score: 95, why: 'Air Force One (VC-25)' }
};
const SQUAWKS: Record<string, { score: number; why: string }> = {
	'7500': { score: 120, why: 'Squawk 7500: hijack' },
	'7700': { score: 100, why: 'Squawk 7700: emergency' },
	'7600': { score: 80, why: 'Squawk 7600: radio failure' }
};

export interface TopFlight {
	plane: Plane;
	why: string;
	score: number;
}

/**
 * The flights most worth watching right now, worldwide, like the "most tracked" list of
 * flight radars: emergencies first, then the giants, rarities and special military planes.
 * About a dozen requests (they wait their turn), so it's for every minute or two.
 */
export async function topFlights(count = 10): Promise<TopFlight[]> {
	const found = new Map<string, TopFlight>();
	const now = Date.now();
	const add = (ac: any, score: number, why: string) => {
		const plane = planeOf(ac, now);
		if (!plane || plane.ground) return;
		const old = found.get(plane.hex);
		if (!old || old.score < score) found.set(plane.hex, { plane, why, score });
	};
	for (const [squawk, info] of Object.entries(SQUAWKS)) {
		const list = await aircraftList(`squawk/${squawk}`, `sqk/${squawk}`).catch(() => []);
		for (const ac of list) add(ac, info.score, info.why);
	}
	for (const type of ['A124', 'BLCF', 'A337', 'A3ST', 'B748', 'A388']) {
		const list = await aircraftList(`type/${type}`, `type/${type}`).catch(() => []);
		const info = SPECIAL_TYPES[type];
		// The highest and fastest of a common type first
		for (const ac of list) add(ac, info.score + Math.min(5, (ac.gs ?? 0) / 120), info.why);
	}
	const military = await aircraftList('mil', 'mil').catch(() => []);
	for (const ac of military) {
		const info = SPECIAL_TYPES[ac.t];
		if (info) add(ac, info.score, info.why);
	}
	return [...found.values()].sort((a, b) => b.score - a.score).slice(0, count);
}

// --- More about a plane -----------------------------------------------------------------------

export interface Airport {
	iata: string;
	icao: string;
	name: string;
	city: string;
	country: string;
	lat: number;
	lon: number;
}
export interface FlightInfo {
	airline: string | null;
	airlineCode: string | null;
	origin: Airport | null;
	destination: Airport | null;
	aircraft: {
		type: string;
		manufacturer: string;
		owner: string;
		country: string;
		registration: string;
	} | null;
	photo: { url: string; large: string; by: string; link: string } | null;
}

const infoCache = new Map<string, Promise<FlightInfo>>();

const airportOf = (a: any): Airport | null =>
	a
		? {
				iata: a.iata_code ?? '',
				icao: a.icao_code ?? '',
				name: a.name ?? '',
				city: a.municipality ?? '',
				country: a.country_name ?? '',
				lat: a.latitude,
				lon: a.longitude
			}
		: null;

async function photoOf(hex: string, registration: string, fallback: any) {
	for (const url of [
		`https://api.planespotters.net/pub/photos/hex/${hex}`,
		...(registration ? [`https://api.planespotters.net/pub/photos/reg/${registration}`] : [])
	]) {
		try {
			const response = await fastFetch(url);
			if (!response.ok) continue;
			const photo = (await response.json()).photos?.[0];
			if (photo)
				return {
					url: photo.thumbnail?.src ?? photo.thumbnail_large?.src,
					large: photo.thumbnail_large?.src ?? photo.thumbnail?.src,
					by: photo.photographer ?? '',
					link: photo.link ?? ''
				};
		} catch {
			// the next one
		}
	}
	if (fallback?.url_photo)
		return {
			url: fallback.url_photo_thumbnail ?? fallback.url_photo,
			large: fallback.url_photo,
			by: 'airport-data.com',
			link: fallback.url_photo
		};
	return null;
}

/** Who flies a plane where, what it is and a photo of it (kept per plane and flight) */
export function flightInfo(plane: Pick<Plane, 'hex' | 'callsign' | 'registration'>) {
	const key = `${plane.hex}/${plane.callsign}`;
	if (!infoCache.has(key)) {
		const load = async (): Promise<FlightInfo> => {
			let data: any = null;
			try {
				const callsign = plane.callsign ? `?callsign=${encodeURIComponent(plane.callsign)}` : '';
				const response = await fastFetch(
					`https://api.adsbdb.com/v0/aircraft/${plane.hex}${callsign}`
				);
				if (response.ok) data = (await response.json()).response;
			} catch {
				// Without it: no route
			}
			const aircraft = data?.aircraft ?? null;
			const route = data?.flightroute ?? null;
			const photo = await photoOf(
				plane.hex,
				plane.registration || aircraft?.registration || '',
				aircraft
			);
			return {
				airline: route?.airline?.name ?? null,
				airlineCode: route?.airline?.iata ?? route?.airline?.icao ?? null,
				origin: airportOf(route?.origin),
				destination: airportOf(route?.destination),
				aircraft: aircraft
					? {
							type: aircraft.type ?? '',
							manufacturer: aircraft.manufacturer ?? '',
							owner: aircraft.registered_owner ?? '',
							country: aircraft.registered_owner_country_name ?? '',
							registration: aircraft.registration ?? ''
						}
					: null,
				photo
			};
		};
		infoCache.set(key, load());
		if (infoCache.size > 300) infoCache.delete(infoCache.keys().next().value!);
	}
	return infoCache.get(key)!;
}

// --- On a map ---------------------------------------------------------------------------------

/** Heights like on flight radars: low orange, high violet */
export function altitudeColour(alt: number, ground = false) {
	if (ground) return '#9ca3af';
	const t = Math.max(0, Math.min(1, alt / 40000));
	return `hsl(${30 + t * 270} 95% 60%)`;
}

/** A plane from above, nose up, at a size for its kind */
export function drawPlane(
	c: CanvasRenderingContext2D,
	x: number,
	y: number,
	track: number,
	fill: string,
	options: { scale?: number; category?: string; outline?: string } = {}
) {
	const category = options.category ?? '';
	const kind = category === 'A7' ? 'heli' : category === 'A1' || category === 'B1' ? 'light' : '';
	const size =
		(options.scale ?? 1) *
		(category === 'A5' ? 1.3 : kind === 'light' ? 0.75 : category === 'A2' ? 0.9 : 1);
	c.save();
	c.translate(x, y);
	c.rotate((track * Math.PI) / 180);
	c.scale(size, size);
	c.beginPath();
	if (kind === 'heli') {
		c.arc(0, 0, 3.4, 0, Math.PI * 2);
		c.moveTo(-0.8, 3);
		c.lineTo(-0.6, 9);
		c.lineTo(0.6, 9);
		c.lineTo(0.8, 3);
	} else {
		// Nose, swept wings, tailplane: an airliner from above
		const half = [
			[1.9, -7.2],
			[1.9, -2.6],
			[10, 3.2],
			[10, 4.8],
			[1.9, 2.2],
			[1.5, 6.6],
			[4.6, 8.8],
			[4.6, 10],
			[0, 9.2]
		];
		c.moveTo(0, -10.5);
		c.quadraticCurveTo(1.9, -9.6, 1.9, -7.2);
		for (const [px, py] of half) c.lineTo(px, py);
		for (let k = half.length - 2; k >= 0; k--) c.lineTo(-half[k][0], half[k][1]);
		c.quadraticCurveTo(-1.9, -9.6, 0, -10.5);
	}
	c.closePath();
	c.fillStyle = fill;
	c.lineWidth = 1.1 / size;
	c.strokeStyle = options.outline ?? 'rgba(0, 0, 0, 0.75)';
	c.fill();
	c.stroke();
	c.restore();
}

/** A plane's trail, coloured by its height */
export function drawTrail(
	c: CanvasRenderingContext2D,
	plane: Plane,
	toScreen: (lat: number, lon: number) => { x: number; y: number },
	options: {
		alpha?: number;
		width?: number;
		since?: number;
		now?: { lat: number; lon: number };
	} = {}
) {
	const points = options.since ? plane.trail.filter((p) => p.time >= options.since!) : plane.trail;
	if (!points.length) return;
	c.save();
	c.globalAlpha = options.alpha ?? 1;
	c.lineWidth = options.width ?? 2;
	c.lineCap = 'round';
	let previous = toScreen(points[0].lat, points[0].lon);
	const all = options.now ? [...points, { ...options.now, alt: plane.alt, time: 0 }] : points;
	for (let i = 1; i < all.length; i++) {
		const p = toScreen(all[i].lat, all[i].lon);
		c.strokeStyle = altitudeColour(all[i].alt, plane.ground);
		c.beginPath();
		c.moveTo(previous.x, previous.y);
		c.lineTo(p.x, p.y);
		c.stroke();
		previous = p;
	}
	c.restore();
}

/** Great-circle kilometres between two places */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
	const rad = Math.PI / 180;
	const h =
		Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
	return 12742 * Math.asin(Math.sqrt(h));
}
