// Webcams that their owners publish for everyone: traffic cameras of road authorities
// (London's JamCams, Finland's road weather cameras, New York City, California, Germany's
// motorways) and, through the Stamer API, Windy's webcams all over the world. Only official
// public feeds: no cameras that someone just forgot to protect.

import type { Feature, LayerSource } from '../types';
import { getJson, backendJson } from '../http';
import { autobahnService } from './traffic';
import { ago } from '../features';

interface Camera {
	id: string;
	lat: number;
	lon: number;
	title: string;
	where?: string;
	image: string;
	video?: string;
	link?: string;
	source: string;
	/** ms the picture is renewed */
	every: number;
}

const SOURCES: Record<string, { label: string; colour: string }> = {
	tfl: { label: 'London (TfL)', colour: '#ef4444' },
	fi: { label: 'Finland (Fintraffic)', colour: '#38bdf8' },
	nyc: { label: 'New York City (DOT)', colour: '#f59e0b' },
	ca: { label: 'California (Caltrans)', colour: '#a3e635' },
	autobahn: { label: 'Autobahn', colour: '#60a5fa' }
};

const https = (url: string) => url?.replace(/^http:\/\//, 'https://');

async function tflCameras(signal: AbortSignal): Promise<Camera[]> {
	const list = await getJson<any[]>('https://api.tfl.gov.uk/Place/Type/JamCam', signal);
	return (list ?? [])
		.map((p) => {
			const prop = (key: string) => p.additionalProperties?.find((x: any) => x.key === key)?.value;
			if (prop('available') === 'false' || !prop('imageUrl')) return null;
			return {
				id: `tfl:${p.id}`,
				lat: p.lat,
				lon: p.lon,
				title: p.commonName,
				where: 'London',
				image: https(prop('imageUrl')),
				video: prop('videoUrl') ? https(prop('videoUrl')) : undefined,
				source: 'tfl',
				every: 60000
			};
		})
		.filter(Boolean) as Camera[];
}

async function finlandCameras(signal: AbortSignal): Promise<Camera[]> {
	const data = await getJson('https://tie.digitraffic.fi/api/weathercam/v1/stations', signal);
	return (data?.features ?? []).flatMap((f: any) => {
		const p = f.properties ?? {};
		const [lon, lat] = f.geometry?.coordinates ?? [];
		if (typeof lat !== 'number' || p.collectionStatus === 'REMOVED_PERMANENTLY') return [];
		// A station has a camera per direction: the first one shown, the others in the panel
		const presets = (p.presets ?? []).filter((x: any) => x.inCollection !== false);
		if (!presets.length) return [];
		return [
			{
				id: `fi:${p.id ?? f.id}`,
				lat,
				lon,
				title: p.name ?? String(p.id),
				where: 'Finland',
				image: `https://weathercam.digitraffic.fi/${presets[0].id}.jpg`,
				link: `https://liikennetilanne.fintraffic.fi/kelikamerat/?stationId=${p.id ?? f.id}`,
				source: 'fi',
				every: 5 * 60000
			}
		];
	});
}

async function nycCameras(signal: AbortSignal): Promise<Camera[]> {
	const list = await getJson<any[]>('https://webcams.nyctmc.org/api/cameras', signal);
	return (list ?? [])
		.filter((c) => String(c.isOnline) !== 'false' && c.latitude)
		.map((c) => ({
			id: `nyc:${c.id}`,
			lat: Number(c.latitude),
			lon: Number(c.longitude),
			title: c.name,
			where: [c.area, 'New York City'].filter(Boolean).join(', '),
			image: https(c.imageUrl ?? `https://webcams.nyctmc.org/api/cameras/${c.id}/image`),
			source: 'nyc',
			every: 15000
		}));
}

async function caltransCameras(signal: AbortSignal): Promise<Camera[]> {
	const districts = Array.from({ length: 12 }, (_, i) => i + 1);
	const answers = await Promise.all(
		districts.map((d) =>
			getJson(
				`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${String(d).padStart(2, '0')}.json`,
				signal
			).catch(() => null)
		)
	);
	return answers.flatMap((answer) =>
		(answer?.data ?? [])
			.map(({ cctv }: any) => {
				const loc = cctv?.location ?? {};
				const image = cctv?.imageData?.static?.currentImageURL;
				if (String(cctv?.inService) === 'false' || !image || !loc.latitude) return null;
				return {
					id: `ca:${loc.district}:${cctv.index}`,
					lat: Number(loc.latitude),
					lon: Number(loc.longitude),
					title: loc.locationName,
					where: [loc.route, loc.nearbyPlace, loc.county, 'California'].filter(Boolean).join(', '),
					image: https(image),
					source: 'ca',
					every: 60000
				};
			})
			.filter(Boolean)
	) as Camera[];
}

async function autobahnCameras(signal: AbortSignal): Promise<Camera[]> {
	return (await autobahnService('webcam', signal))
		.map(({ road, item }) => {
			const lat = Number(item.coordinate?.lat);
			const lon = Number(item.coordinate?.long ?? item.coordinate?.lon);
			if (!isFinite(lat) || !item.imageurl) return null;
			return {
				id: `autobahn:${item.identifier}`,
				lat,
				lon,
				title: item.title ?? road,
				where: [road, item.subtitle].filter(Boolean).join(' · '),
				image: https(item.imageurl),
				link: item.linkurl ? https(item.linkurl) : undefined,
				source: 'autobahn',
				every: 60000
			};
		})
		.filter(Boolean) as Camera[];
}

const cameraFeature = (c: Camera): Feature => ({
	id: `cam:${c.id}`,
	lat: c.lat,
	lon: c.lon,
	shape: 'camera',
	size: 3.5,
	colour: SOURCES[c.source]?.colour ?? '#e2e8f0',
	label: c.title,
	labelZoom: 14,
	data: c
});

function cameraDetails(f: Feature) {
	const c: Camera = f.data;
	return {
		title: c.title,
		subtitle: c.where,
		image: { url: c.image, every: c.every, video: c.video, caption: 'Live picture' },
		links: c.link ? [{ label: 'At the operator', url: c.link }] : [],
		source: SOURCES[c.source]?.label ?? c.source
	};
}

export const webcams: LayerSource = {
	id: 'webcams',
	category: 'cameras',
	label: 'Traffic cameras',
	icon: 'icon-[mingcute--video-camera-line]',
	hint: 'The public road cameras of London, Finland, New York City, California and Germany’s motorways, with their live picture',
	attribution: 'TfL, Fintraffic, NYC DOT, Caltrans, Autobahn GmbH',
	on: true,
	every: 30 * 60 * 1000,
	legend: Object.values(SOURCES),
	async load(_, signal) {
		const results = await Promise.allSettled([
			tflCameras(signal),
			finlandCameras(signal),
			nycCameras(signal),
			caltransCameras(signal),
			autobahnCameras(signal)
		]);
		if (results.every((r) => r.status === 'rejected'))
			throw (results[0] as PromiseRejectedResult).reason;
		return results.flatMap((r) => (r.status === 'fulfilled' ? r.value.map(cameraFeature) : []));
	},
	details: cameraDetails
};

export const windyWebcams: LayerSource = {
	id: 'windy',
	category: 'cameras',
	label: 'Webcams worldwide',
	icon: 'icon-[ri--webcam-line]',
	hint: 'Tens of thousands of webcams all over the world (beaches, mountains, cities), with a timelapse of the day',
	attribution: 'Windy.com Webcams',
	on: true,
	byArea: true,
	minZoom: 3,
	every: 10 * 60 * 1000,
	async load(a, signal) {
		const answer = await backendJson<{ webcams: any[] }>(
			`webcams?north=${a.north.toFixed(3)}&south=${a.south.toFixed(3)}&east=${a.east.toFixed(3)}&west=${a.west.toFixed(3)}&zoom=${Math.round(a.zoom)}`,
			signal
		);
		return (answer.webcams ?? []).map((w) => ({
			id: `windy:${w.id}`,
			lat: w.lat,
			lon: w.lon,
			shape: 'camera' as const,
			size: 4,
			colour: '#f472b6',
			label: w.title,
			labelZoom: 11,
			data: w
		}));
	},
	details(f) {
		const w = f.data;
		return {
			title: w.title,
			subtitle: [w.city, w.country].filter(Boolean).join(', '),
			image: {
				url: w.image,
				every: 10 * 60000,
				embed: w.player,
				caption: w.updated ? `Picture of ${ago(w.updated)}` : ''
			},
			links: w.url ? [{ label: 'At Windy', url: w.url }] : [],
			source: 'Windy.com Webcams'
		};
	}
};
