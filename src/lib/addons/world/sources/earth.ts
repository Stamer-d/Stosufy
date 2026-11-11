// The Earth's trackers: tsunami messages (NOAA's warning centres), the disasters GDACS
// follows (cyclones, floods, droughts, volcanoes, fires), the volcanoes of the world (and
// which erupt now), wildfires (NASA EONET, and the satellites' hotspots through the Stamer
// API), what else NASA follows (storms with their track, icebergs, dust …) and the water
// levels of Germany's rivers (Pegelonline).

import type { Feature, LayerSource } from '../types';
import { getJson, getXml, xmlText, backendJson, cached } from '../http';
import { ago, clockTime } from '../features';

const DAY = 24 * 60 * 60 * 1000;
const ALERT = { Green: '#22c55e', Orange: '#f97316', Red: '#ef4444' } as Record<string, string>;
const strip = (html: string) =>
	html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*/g, '\n')
		.trim();

// --- Tsunami messages ------------------------------------------------------------------------

const TSUNAMI_FEEDS = [
	{ url: 'https://www.tsunami.gov/events/xml/PAAQAtom.xml', centre: 'NTWC, Palmer (Alaska)' },
	{ url: 'https://www.tsunami.gov/events/xml/PHEBAtom.xml', centre: 'PTWC, Honolulu (Hawaii)' }
];

function tsunamiLevel(title: string) {
	if (/warning/i.test(title)) return { label: 'Warning', colour: '#ef4444', rank: 4 };
	if (/threat/i.test(title)) return { label: 'Threat', colour: '#f97316', rank: 3 };
	if (/advisory/i.test(title)) return { label: 'Advisory', colour: '#f97316', rank: 3 };
	if (/watch/i.test(title)) return { label: 'Watch', colour: '#facc15', rank: 2 };
	return { label: 'Information', colour: '#38bdf8', rank: 1 };
}

export const tsunami: LayerSource = {
	id: 'tsunami',
	category: 'earth',
	label: 'Tsunami alerts',
	icon: 'icon-[mingcute--wave-line]',
	hint: "Tsunami warnings, advisories and statements of NOAA's two warning centres (last 3 days)",
	attribution: 'NOAA Tsunami Warning Centers',
	on: true,
	every: 2 * 60 * 1000,
	legend: [
		{ label: 'Warning', colour: '#ef4444' },
		{ label: 'Advisory', colour: '#f97316' },
		{ label: 'Watch', colour: '#facc15' },
		{ label: 'Information', colour: '#38bdf8' }
	],
	async load(_, signal) {
		const list: Feature[] = [];
		for (const feed of TSUNAMI_FEEDS) {
			const doc = await getXml(feed.url, signal);
			for (const entry of doc.getElementsByTagName('entry')) {
				const lat = Number(xmlText(entry, 'geo:lat'));
				const lon = Number(xmlText(entry, 'geo:long'));
				const updated = Date.parse(xmlText(entry, 'updated'));
				if (!isFinite(lat) || !isFinite(lon) || !(Date.now() - updated < 3 * DAY)) continue;
				const title = xmlText(entry, 'title');
				const summary = strip(xmlText(entry, 'summary') || xmlText(entry, 'content'));
				const level = tsunamiLevel(title);
				const links = [...entry.getElementsByTagName('link')]
					.map((link) => link.getAttribute('href'))
					.filter(Boolean) as string[];
				const field = (name: string) =>
					summary.match(new RegExp(`${name}:\\s*([^\\n]+?)(?=\\s+[A-Z][a-z]+:|\\n|$)`))?.[1] ?? '';
				list.push({
					id: `tsunami:${xmlText(entry, 'id') || title + updated}`,
					lat,
					lon,
					shape: 'diamond',
					colour: level.colour,
					size: level.rank >= 3 ? 8 : 6,
					rank: level.rank,
					pulse: level.rank >= 2,
					label: level.label,
					data: { title, summary, level, updated, links, feed, field }
				});
			}
		}
		return list;
	},
	details(f) {
		const { title, summary, level, updated, links, feed, field } = f.data;
		return {
			title,
			subtitle: field('Location') || feed.centre,
			badge: { text: level.label.slice(0, 4).toUpperCase(), colour: level.colour },
			text: summary,
			stats: [
				{ label: 'Issued', value: clockTime(updated), hint: ago(updated) },
				{ label: 'Magnitude', value: field('Magnitude') || '–' },
				{ label: 'Centre', value: feed.centre }
			],
			links: links.map((url: string) => ({ label: 'The message', url })).slice(0, 2),
			source: 'NOAA / National Weather Service'
		};
	}
};

// --- Disasters (GDACS) -------------------------------------------------------------------------

const GDACS_TYPES: Record<string, { label: string; shape: Feature['shape'] }> = {
	TC: { label: 'Tropical cyclone', shape: 'star' },
	FL: { label: 'Flood', shape: 'square' },
	DR: { label: 'Drought', shape: 'ring' },
	VO: { label: 'Volcano', shape: 'triangle' },
	WF: { label: 'Wildfire', shape: 'plus' },
	EQ: { label: 'Earthquake', shape: 'dot' },
	TS: { label: 'Tsunami', shape: 'diamond' }
};

export const disasters: LayerSource = {
	id: 'disasters',
	category: 'earth',
	label: 'Disasters',
	icon: 'icon-[mingcute--alert-octagon-line]',
	hint: 'What the UN and EU disaster system GDACS follows now: cyclones, floods, droughts, eruptions, fires, strong quakes; coloured by how bad (green, orange, red)',
	attribution: 'GDACS (UN, European Commission)',
	on: true,
	every: 15 * 60 * 1000,
	legend: [
		{ label: 'Green', colour: ALERT.Green },
		{ label: 'Orange', colour: ALERT.Orange },
		{ label: 'Red', colour: ALERT.Red }
	],
	async load(_, signal) {
		const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
		const base = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC;FL;DR;VO;WF;EQ;TS&fromDate=${day(Date.now() - 30 * DAY)}&toDate=${day(Date.now() + DAY)}&pageSize=100&pageNumber=1`;
		// One level at a time (each answer has at most 100)
		const answers = await Promise.all(
			['Green', 'Orange', 'Red'].map((level) =>
				getJson(`${base}&alertlevel=${level}`, signal).catch(() => null)
			)
		);
		if (answers.every((a) => a === null)) throw new Error('GDACS answered nothing');
		const seen = new Set<string>();
		const list: Feature[] = [];
		for (const answer of answers)
			for (const feature of answer?.features ?? []) {
				const p = feature.properties ?? {};
				const [lon, lat] = feature.geometry?.coordinates ?? [];
				const id = `${p.eventtype}${p.eventid}`;
				if (typeof lat !== 'number' || seen.has(id)) continue;
				const current = String(p.iscurrent).toLowerCase() === 'true';
				const ended = Date.parse(p.todate);
				if (!current && !(Date.now() - ended < 3 * DAY)) continue;
				// The small quakes are on the quake map already
				if (p.eventtype === 'EQ' && p.alertlevel === 'Green') continue;
				seen.add(id);
				const type = GDACS_TYPES[p.eventtype] ?? { label: p.eventtype, shape: 'dot' };
				const colour = ALERT[p.alertlevel] ?? ALERT.Green;
				const rank = p.alertlevel === 'Red' ? 3 : p.alertlevel === 'Orange' ? 2 : 1;
				list.push({
					id: `gdacs:${id}`,
					lat,
					lon,
					shape: type.shape,
					colour,
					size: 4 + rank * 1.5,
					rank,
					pulse: rank === 3,
					label: p.eventname || p.name || type.label,
					labelZoom: rank >= 2 ? 3 : 5,
					data: { p, type, current }
				});
			}
		return list;
	},
	details(f) {
		const { p, type, current } = f.data;
		const severity = p.severitydata ?? {};
		const report =
			p.url?.report ??
			`https://www.gdacs.org/report.aspx?eventtype=${p.eventtype}&eventid=${p.eventid}`;
		return {
			title: p.eventname || p.name || type.label,
			subtitle: [type.label, p.country].filter(Boolean).join(' · '),
			badge: { text: (p.alertlevel ?? '').slice(0, 3).toUpperCase(), colour: f.colour },
			text: severity.severitytext || p.description || '',
			stats: [
				{ label: 'Alert', value: `${p.alertlevel} alert`, hint: current ? 'going on' : 'over' },
				{
					label: 'Since',
					value: clockTime(Date.parse(p.fromdate)),
					hint: ago(Date.parse(p.fromdate))
				},
				{ label: 'Until', value: clockTime(Date.parse(p.todate)) },
				...(severity.severity != null
					? [{ label: 'Severity', value: `${severity.severity} ${severity.severityunit ?? ''}` }]
					: [])
			],
			links: [{ label: 'GDACS report', url: report }],
			source: 'GDACS, the Global Disaster Alert and Coordination System'
		};
	}
};

// --- Natural events of NASA (wildfires, volcanoes, storms with their track, icebergs …) ------

const EONET_CATEGORIES: Record<string, { label: string; colour: string; shape: Feature['shape'] }> =
	{
		wildfires: { label: 'Wildfire', colour: '#f97316', shape: 'plus' },
		volcanoes: { label: 'Volcano', colour: '#ef4444', shape: 'triangle' },
		severeStorms: { label: 'Severe storm', colour: '#a78bfa', shape: 'star' },
		seaLakeIce: { label: 'Iceberg / sea ice', colour: '#bae6fd', shape: 'diamond' },
		floods: { label: 'Flood', colour: '#38bdf8', shape: 'square' },
		dustHaze: { label: 'Dust and haze', colour: '#d6b37a', shape: 'ring' },
		landslides: { label: 'Landslide', colour: '#a16207', shape: 'triangle' },
		snow: { label: 'Snow', colour: '#f8fafc', shape: 'ring' },
		tempExtremes: { label: 'Temperature extreme', colour: '#fb7185', shape: 'ring' },
		waterColor: { label: 'Water colour', colour: '#2dd4bf', shape: 'ring' },
		manmade: { label: 'Man-made', colour: '#e2e8f0', shape: 'square' },
		drought: { label: 'Drought', colour: '#eab308', shape: 'ring' },
		earthquakes: { label: 'Earthquake', colour: '#fbbf24', shape: 'dot' }
	};

const eonetEvents = (signal: AbortSignal) =>
	cached('eonet', 10 * 60 * 1000, () =>
		getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30', signal).then(
			(data) => data?.events ?? []
		)
	);

function eonetFeature(event: any): Feature | null {
	const category = event.categories?.[0]?.id ?? '';
	const kind = EONET_CATEGORIES[category] ?? { label: category, colour: '#e2e8f0', shape: 'dot' };
	const points = (event.geometry ?? []).filter(
		(g: any) => g.type === 'Point' && Array.isArray(g.coordinates)
	);
	const polygon = (event.geometry ?? []).find((g: any) => g.type === 'Polygon');
	const last = points.at(-1);
	const [lon, lat] = last?.coordinates ?? polygon?.coordinates?.[0]?.[0] ?? [];
	if (typeof lat !== 'number') return null;
	return {
		id: `eonet:${event.id}`,
		lat,
		lon,
		shape: kind.shape,
		colour: kind.colour,
		size: 5,
		label: event.title,
		labelZoom: 6,
		// Storms: the way they came
		line: points.length > 1 ? points.map((g: any) => g.coordinates) : undefined,
		area: polygon ? polygon.coordinates : undefined,
		data: { event, kind, last }
	};
}

function eonetDetails(f: Feature) {
	const { event, kind, last } = f.data;
	const when = last?.date ? Date.parse(last.date) : null;
	return {
		title: event.title,
		subtitle: kind.label,
		text: event.description ?? '',
		stats: [
			...(when ? [{ label: 'Seen', value: clockTime(when), hint: ago(when) }] : []),
			...(last?.magnitudeValue != null
				? [{ label: 'Size', value: `${last.magnitudeValue} ${last.magnitudeUnit ?? ''}` }]
				: []),
			{ label: 'Reported by', value: (event.sources ?? []).map((s: any) => s.id).join(', ') }
		],
		links: (event.sources ?? []).map((s: any) => ({ label: `At ${s.id}`, url: s.url })),
		source: 'NASA EONET'
	};
}

export const wildfires: LayerSource = {
	id: 'wildfires',
	category: 'earth',
	label: 'Wildfires',
	icon: 'icon-[mingcute--fire-line]',
	hint: 'Big wildfires burning now, as NASA follows them',
	attribution: 'NASA EONET',
	on: true,
	every: 15 * 60 * 1000,
	async load(_, signal) {
		return (await eonetEvents(signal))
			.filter((e: any) => e.categories?.[0]?.id === 'wildfires')
			.map(eonetFeature)
			.filter(Boolean) as Feature[];
	},
	details: eonetDetails
};

export const naturalEvents: LayerSource = {
	id: 'events',
	category: 'earth',
	label: 'Storms, ice & more',
	icon: 'icon-[mingcute--tornado-line]',
	hint: 'What else NASA follows now: severe storms with their track, icebergs, dust, floods, landslides',
	attribution: 'NASA EONET',
	every: 15 * 60 * 1000,
	legend: Object.entries(EONET_CATEGORIES)
		.filter(([id]) => !['wildfires', 'volcanoes', 'earthquakes'].includes(id))
		.slice(0, 6)
		.map(([, k]) => ({ label: k.label, colour: k.colour })),
	async load(_, signal) {
		return (await eonetEvents(signal))
			.filter((e: any) => !['wildfires', 'volcanoes'].includes(e.categories?.[0]?.id))
			.map(eonetFeature)
			.filter(Boolean) as Feature[];
	},
	details: eonetDetails
};

// --- Volcanoes ----------------------------------------------------------------------------------

/** When it erupted last (the Smithsonian's codes) */
const ERUPTED: Record<string, string> = {
	D1: 'Since 1964',
	D2: '1900–1963',
	D3: '1800–1899',
	D4: '1700–1799',
	D5: '1500–1699',
	D6: '1–1499 AD',
	D7: 'Before Christ (Holocene)',
	U: 'Undated (Holocene)',
	Q: 'Quaternary',
	'?': 'Unknown',
	Unknown: 'Unknown'
};

export const volcanoes: LayerSource = {
	id: 'volcanoes',
	category: 'earth',
	label: 'Volcanoes',
	icon: 'icon-[mingcute--mountain-2-line]',
	hint: 'The world’s volcanoes (red: erupting now, as NASA follows them)',
	attribution: 'Smithsonian Global Volcanism Program, NASA EONET',
	on: true,
	every: 30 * 60 * 1000,
	legend: [
		{ label: 'Erupting', colour: '#ef4444' },
		{ label: 'Since 1964', colour: '#fb923c' },
		{ label: 'Older', colour: '#94a3b8' }
	],
	async load(_, signal) {
		const [all, events] = await Promise.all([
			cached('volcanoes', 7 * DAY, () =>
				getJson(new URL('/data/volcanoes.json', location.href).href, signal)
			),
			eonetEvents(signal).catch(() => [])
		]);
		const active = events
			.filter((e: any) => e.categories?.[0]?.id === 'volcanoes')
			.map(eonetFeature)
			.filter(Boolean) as Feature[];
		const list: Feature[] = all.volcanoes.map(
			([name, country, lat, lon, elevation, type, last]: any[]) => ({
				id: `volcano:${name}:${lat}`,
				lat,
				lon,
				shape: 'triangle' as const,
				colour: last === 'D1' ? '#fb923c' : '#94a3b8',
				size: last === 'D1' ? 3.5 : 2.5,
				label: name,
				labelZoom: 8,
				data: { name, country, elevation, type, last }
			})
		);
		for (const f of active) list.push({ ...f, size: 7, rank: 2, pulse: true, labelZoom: 4 });
		return list;
	},
	details(f) {
		if (f.id.startsWith('eonet:')) return eonetDetails(f);
		const { name, country, elevation, type, last } = f.data;
		return {
			title: name,
			subtitle: [type, country].filter(Boolean).join(' · '),
			stats: [
				{ label: 'Last eruption', value: ERUPTED[last] ?? last },
				...(elevation != null
					? [{ label: 'Height', value: `${elevation.toLocaleString()} m` }]
					: []),
				{ label: 'Where', value: `${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°` }
			],
			links: [
				{
					label: 'At the Global Volcanism Program',
					url: `https://volcano.si.edu/search_volcano_results.cfm?volcano_name=${encodeURIComponent(name)}`
				}
			],
			source: 'Global Volcanism Program, Smithsonian Institution'
		};
	}
};

// --- Fire hotspots of the satellites (NASA FIRMS, through the Stamer API) ---------------------

export const hotspots: LayerSource = {
	id: 'hotspots',
	category: 'earth',
	label: 'Fire hotspots',
	icon: 'icon-[mingcute--fire-fill]',
	hint: 'Every fire the VIIRS satellites saw in the last 24 hours (bright: hot)',
	attribution: 'NASA FIRMS',
	byArea: true,
	minZoom: 4,
	every: 30 * 60 * 1000,
	legend: [
		{ label: 'Weak', colour: '#facc15' },
		{ label: 'Strong', colour: '#f97316' },
		{ label: 'Very strong', colour: '#ef4444' }
	],
	async load(a, signal) {
		const list = await backendJson<any[]>(
			`fires?west=${a.west.toFixed(2)}&south=${a.south.toFixed(2)}&east=${a.east.toFixed(2)}&north=${a.north.toFixed(2)}`,
			signal
		);
		return list.map(([lat, lon, frp, confidence, time], i) => ({
			id: `fire:${lat},${lon},${time ?? i}`,
			lat,
			lon,
			shape: 'dot',
			size: frp > 100 ? 3.5 : frp > 20 ? 2.5 : 2,
			colour: frp > 100 ? '#ef4444' : frp > 20 ? '#f97316' : '#facc15',
			data: { frp, confidence, time }
		}));
	},
	details(f) {
		const { frp, confidence, time } = f.data;
		return {
			title: 'Fire hotspot',
			subtitle: `${f.lat.toFixed(3)}°, ${f.lon.toFixed(3)}°`,
			stats: [
				{ label: 'Fire power', value: `${Math.round(frp)} MW`, hint: 'radiative power' },
				{ label: 'Confidence', value: String(confidence ?? '–') },
				...(time ? [{ label: 'Seen', value: clockTime(time), hint: ago(time) }] : [])
			],
			links: [
				{
					label: 'FIRMS map',
					url: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${f.lon.toFixed(3)},${f.lat.toFixed(3)},12z`
				}
			],
			source: 'NASA FIRMS (VIIRS)'
		};
	}
};

// --- Water levels of Germany's rivers (Pegelonline) ---------------------------------------------

const WATER_STATE: Record<string, { label: string; colour: string }> = {
	high: { label: 'High water', colour: '#ef4444' },
	normal: { label: 'Normal', colour: '#38bdf8' },
	low: { label: 'Low water', colour: '#f59e0b' },
	unknown: { label: 'Unknown', colour: '#94a3b8' },
	commented: { label: 'Unknown', colour: '#94a3b8' },
	'out-dated': { label: 'Out of date', colour: '#64748b' }
};

export const waterLevels: LayerSource = {
	id: 'water',
	category: 'earth',
	label: 'River levels',
	icon: 'icon-[mingcute--drop-line]',
	hint: 'The water levels of Germany’s rivers and canals now, from low to high water',
	attribution: 'WSV Pegelonline',
	every: 15 * 60 * 1000,
	legend: [
		{ label: 'High', colour: WATER_STATE.high.colour },
		{ label: 'Normal', colour: WATER_STATE.normal.colour },
		{ label: 'Low', colour: WATER_STATE.low.colour }
	],
	async load(_, signal) {
		const stations = await getJson<any[]>(
			'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true&timeseries=W',
			signal
		);
		return stations
			.filter((s) => typeof s.latitude === 'number')
			.map((s) => {
				const series = s.timeseries?.find((t: any) => t.shortname === 'W') ?? s.timeseries?.[0];
				const now = series?.currentMeasurement;
				const state = WATER_STATE[now?.stateMnwMhw ?? 'unknown'] ?? WATER_STATE.unknown;
				return {
					id: `pegel:${s.uuid}`,
					lat: s.latitude,
					lon: s.longitude,
					shape: 'square' as const,
					size: now?.stateMnwMhw === 'high' ? 4.5 : 3,
					colour: state.colour,
					rank: now?.stateMnwMhw === 'high' ? 2 : 1,
					pulse: now?.stateMnwMhw === 'high',
					label: now ? `${Math.round(now.value)} cm` : s.shortname,
					labelZoom: 9,
					data: { s, series, now, state }
				};
			});
	},
	details(f) {
		const { s, series, now, state } = f.data;
		const time = now ? Date.parse(now.timestamp) : null;
		return {
			title: `${s.longname ?? s.shortname}`,
			subtitle: [s.water?.longname, s.km != null ? `km ${s.km}` : ''].filter(Boolean).join(' · '),
			badge: now
				? { text: String(Math.round(now.value)), colour: state.colour, small: 'cm' }
				: undefined,
			image: {
				url: `https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/${s.uuid}/W/measurements.png?start=P7D&width=640&height=300`,
				caption: 'The last 7 days'
			},
			stats: [
				{ label: 'Now', value: state.label, hint: time ? ago(time) : '' },
				...(series?.gaugeZero
					? [{ label: 'Gauge zero', value: `${series.gaugeZero.value} ${series.gaugeZero.unit}` }]
					: []),
				{ label: 'Agency', value: s.agency ?? '–' }
			],
			links: [
				{
					label: 'At Pegelonline',
					url: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${s.number}`
				}
			],
			source: 'Wasserstraßen- und Schifffahrtsverwaltung des Bundes (Pegelonline)'
		};
	}
};
