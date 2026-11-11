// Keeps the trackers shown on the map loaded: each one now, again every while, and again when
// the map moves out of what was loaded (for those that load an area). One coloured map
// (field) at a time the same way. Nothing loads for a tracker that isn't shown.

import { writable, get } from 'svelte/store';
import type { Area, Feature, FieldSource, LayerSource, LayerStatus } from './types';
import { NotConfigured } from './http';

export const layerFeatures = writable<Record<string, Feature[]>>({});
export const layerStatus = writable<Record<string, LayerStatus>>({});

interface Running {
	source: LayerSource;
	timer?: ReturnType<typeof setTimeout>;
	controller?: AbortController;
	/** What was loaded: the area with its margin, and the zoom */
	loaded?: Area;
}
const running = new Map<string, Running>();
let area: Area | null = null;
let moveTimer: ReturnType<typeof setTimeout> | undefined;

const setStatus = (id: string, status: LayerStatus) =>
	layerStatus.update((all) => ({ ...all, [id]: status }));
const setFeatures = (id: string, list: Feature[]) =>
	layerFeatures.update((all) => ({ ...all, [id]: list }));

/** A bit more than shown, so small moves don't load it again */
function padded(a: Area): Area {
	const h = (a.east - a.west) * 0.3;
	const v = (a.north - a.south) * 0.3;
	return {
		...a,
		north: Math.min(85, a.north + v),
		south: Math.max(-85, a.south - v),
		west: a.west - h,
		east: a.east + h
	};
}

/** Into the world's longitudes (−180 to 180), as the services want them */
export function clampArea(a: Area): Area {
	const width = a.east - a.west;
	if (width >= 360) return { ...a, west: -180, east: 180 };
	const shift = Math.round(a.lon / 360) * 360;
	return {
		...a,
		lon: a.lon - shift,
		west: Math.max(-180, a.west - shift),
		east: Math.min(180, a.east - shift)
	};
}

/** Whether what was loaded still covers what's shown */
function covers(loaded: Area | undefined, now: Area) {
	return (
		!!loaded &&
		Math.abs(loaded.zoom - now.zoom) < 1 &&
		now.north <= loaded.north &&
		now.south >= loaded.south &&
		now.west >= loaded.west &&
		now.east <= loaded.east
	);
}

async function load(id: string) {
	const run = running.get(id);
	if (!run || !area) return;
	const source = run.source;
	clearTimeout(run.timer);
	run.controller?.abort();
	if (source.minZoom && area.zoom < source.minZoom) {
		run.loaded = undefined;
		setFeatures(id, []);
		setStatus(id, { state: 'zoom' });
		return;
	}
	const controller = new AbortController();
	run.controller = controller;
	const want = source.byArea ? padded(area) : area;
	const before = get(layerStatus)[id];
	if (before?.state !== 'ok') setStatus(id, { ...before, state: 'loading' });
	let failed = false;
	try {
		const list = await source.load(clampArea(want), controller.signal);
		if (controller.signal.aborted || running.get(id) !== run) return;
		run.loaded = want;
		setFeatures(id, list);
		setStatus(id, { state: 'ok', count: list.length, at: Date.now() });
	} catch (error: any) {
		if (controller.signal.aborted || running.get(id) !== run) return;
		if (error instanceof NotConfigured) {
			setFeatures(id, []);
			setStatus(id, { state: 'unavailable', error: error.message });
			return;
		}
		failed = true;
		console.warn(`${source.label} could not be loaded`, error);
		setStatus(id, {
			state: 'error',
			error: error?.message ?? String(error),
			count: before?.count
		});
	} finally {
		// Again after a while (sooner after a failure)
		if (running.get(id) === run && run.controller === controller && !controller.signal.aborted)
			run.timer = setTimeout(() => load(id), failed ? Math.min(source.every, 60000) : source.every);
	}
}

/** The trackers shown now: new ones start, those left stop */
export function setActiveLayers(sources: LayerSource[]) {
	const ids = new Set(sources.map((s) => s.id));
	for (const [id, run] of running) {
		if (ids.has(id)) continue;
		clearTimeout(run.timer);
		run.controller?.abort();
		running.delete(id);
		setFeatures(id, []);
		setStatus(id, { state: 'off' });
	}
	for (const source of sources) {
		if (running.has(source.id)) continue;
		running.set(source.id, { source });
		load(source.id);
	}
}

/** What the map shows now: trackers whose area or zoom limit it leaves load again */
export function setArea(next: Area) {
	const first = !area;
	area = next;
	clearTimeout(moveTimer);
	const stale = () =>
		[...running.values()].filter((run) => {
			const { source } = run;
			const shownBefore = !!run.loaded;
			const shownNow = !source.minZoom || next.zoom >= source.minZoom;
			if (shownBefore !== shownNow) return true;
			return shownNow && source.byArea && !covers(run.loaded, next);
		});
	if (first) {
		for (const run of running.values()) load(run.source.id);
		loadField();
		return;
	}
	// When the map rests a moment
	moveTimer = setTimeout(() => {
		for (const run of stale()) load(run.source.id);
		loadField();
	}, 500);
}

// --- One coloured map at a time --------------------------------------------------------------

export const fieldState = writable<{
	id: string | null;
	rows: { lat: number; lon: number; value: number }[][] | null;
	time?: number;
	state: 'off' | 'loading' | 'ok' | 'error';
	error?: string;
}>({ id: null, rows: null, state: 'off' });

let field: FieldSource | null = null;
let fieldLoaded: Area | undefined;
let fieldController: AbortController | undefined;
let fieldTimer: ReturnType<typeof setTimeout> | undefined;

async function loadField(force = false) {
	const source = field;
	if (!source || !area) return;
	if (!force && covers(fieldLoaded, area)) return;
	clearTimeout(fieldTimer);
	fieldController?.abort();
	const controller = new AbortController();
	fieldController = controller;
	const want = padded(area);
	fieldState.update((s) => ({ ...s, id: source.id, state: s.rows ? s.state : 'loading' }));
	try {
		const { rows, time } = await source.load(clampArea(want), controller.signal);
		if (controller.signal.aborted || field !== source) return;
		fieldLoaded = want;
		fieldState.set({ id: source.id, rows, time, state: 'ok' });
	} catch (error: any) {
		if (controller.signal.aborted || field !== source) return;
		console.warn(`${source.label} could not be loaded`, error);
		fieldState.update((s) => ({ ...s, state: 'error', error: error?.message ?? String(error) }));
	} finally {
		if (field === source && fieldController === controller && !controller.signal.aborted)
			fieldTimer = setTimeout(() => loadField(true), source.every);
	}
}

/** The coloured map shown (or none) */
export function setField(next: FieldSource | null) {
	if (next === field) return;
	field = next;
	fieldLoaded = undefined;
	clearTimeout(fieldTimer);
	fieldController?.abort();
	fieldState.set({ id: next?.id ?? null, rows: null, state: next ? 'loading' : 'off' });
	if (next) loadField(true);
}

/** Everything stops (the page is left) */
export function stopAll() {
	setActiveLayers([]);
	setField(null);
	clearTimeout(moveTimer);
	area = null;
}
