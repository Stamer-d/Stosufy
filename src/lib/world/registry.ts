// Everything the world center can show, by category: the layers the page draws itself (the
// weather, flights, earthquakes) and the trackers that load their own features, plus the
// coloured maps of each category.

import type { Category, FieldSource, LayerSource } from './types';
import {
	tsunami,
	disasters,
	volcanoes,
	wildfires,
	hotspots,
	naturalEvents,
	waterLevels
} from './sources/earth';
import { FIELDS as ENVIRONMENT_FIELDS, sensors, radiation } from './sources/environment';
import { transit, stops, bikes, ships, autobahn } from './sources/traffic';
import { stations, satellites, starlink, launches, AURORA } from './sources/space';
import { webcams, windyWebcams } from './sources/cameras';

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
	{ id: 'weather', label: 'Weather', icon: 'icon-[mingcute--thunderstorm-line]' },
	{ id: 'earth', label: 'Earth', icon: 'icon-[ri--earthquake-line]' },
	{ id: 'environment', label: 'Environment', icon: 'icon-[mingcute--leaf-line]' },
	{ id: 'traffic', label: 'Traffic', icon: 'icon-[mingcute--train-line]' },
	{ id: 'space', label: 'Space', icon: 'icon-[mingcute--rocket-line]' },
	{ id: 'cameras', label: 'Cameras', icon: 'icon-[mingcute--video-camera-line]' }
];

export interface LayerInfo {
	id: string;
	category: Category;
	label: string;
	icon: string;
	hint: string;
	on?: boolean;
	/** A tracker that loads its own features (else the page draws it) */
	source?: LayerSource;
}

/** Drawn by the page itself */
const BUILTIN: LayerInfo[] = [
	{
		id: 'radar',
		category: 'weather',
		label: 'Radar',
		icon: 'icon-[mingcute--rainstorm-line]',
		hint: 'Rain radar of the last two hours, as a loop',
		on: true
	},
	{
		id: 'lightning',
		category: 'weather',
		label: 'Lightning',
		icon: 'icon-[mingcute--flash-line]',
		hint: 'Strikes live as they happen (Blitzortung.org)',
		on: true
	},
	{
		id: 'warnings',
		category: 'weather',
		label: 'Warnings',
		icon: 'icon-[mingcute--warning-line]',
		hint: 'Warnings of the German weather service (DWD)',
		on: true
	},
	{
		id: 'satellite',
		category: 'weather',
		label: 'Satellite',
		icon: 'icon-[mingcute--earth-2-line]',
		hint: 'Meteosat infrared: the whitest clouds are the storms'
	},
	{
		id: 'rings',
		category: 'weather',
		label: 'Range rings',
		icon: 'icon-[mingcute--radar-line]',
		hint: '25, 50 and 100 km around your place',
		on: true
	},
	{
		id: 'quakes',
		category: 'earth',
		label: 'Earthquakes',
		icon: 'icon-[ri--earthquake-line]',
		hint: 'Every earthquake of the week, live (EMSC)',
		on: true
	},
	{
		id: 'plates',
		category: 'earth',
		label: 'Plate boundaries',
		icon: 'icon-[mingcute--earth-latitude-line]',
		hint: 'Where the tectonic plates meet: most quakes and volcanoes are there',
		on: true
	},
	{
		id: 'flights',
		category: 'traffic',
		label: 'Flights',
		icon: 'icon-[mingcute--airplane-line]',
		hint: 'Planes live from their ADS-B signals; click one for its flight',
		on: true
	}
];

const fromSource = (source: LayerSource): LayerInfo => ({
	id: source.id,
	category: source.category,
	label: source.label,
	icon: source.icon,
	hint: source.hint,
	on: source.on,
	source
});

/** In the order they're listed */
export const LAYERS: LayerInfo[] = [
	...BUILTIN.filter((l) => l.category === 'weather'),
	BUILTIN.find((l) => l.id === 'quakes')!,
	...[tsunami, disasters, volcanoes, wildfires, hotspots, naturalEvents, waterLevels].map(
		fromSource
	),
	BUILTIN.find((l) => l.id === 'plates')!,
	...[sensors, radiation].map(fromSource),
	BUILTIN.find((l) => l.id === 'flights')!,
	...[transit, stops, ships, bikes, autobahn].map(fromSource),
	...[stations, satellites, starlink, launches].map(fromSource),
	...[webcams, windyWebcams].map(fromSource)
];

export const LAYER: Record<string, LayerInfo> = Object.fromEntries(LAYERS.map((l) => [l.id, l]));

/** The coloured maps a category offers (the weather's forecast maps are its own) */
export const CATEGORY_FIELDS: Record<Category, FieldSource[]> = {
	weather: [],
	earth: [],
	environment: ENVIRONMENT_FIELDS,
	traffic: [],
	space: [AURORA],
	cameras: []
};
