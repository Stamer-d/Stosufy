// Imports the songs of an osu! (stable) installation. The files stay where they are:
// Stosufy plays them straight from the osu! Songs folder.

import { get, writable } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { readDir, readTextFile, exists, stat } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import * as path from '@tauri-apps/api/path';
import { keyStore } from './auth';
import { mapDataStore, saveMapData, backfillImages } from './data';
import { getPlaylistSongs } from './playlist';
import { parseOsuFile, mainBpm } from '../osuFile';
import type { Beatmap, StoredMapSet } from '../types';

export interface OsuImportState {
	state: 'idle' | 'scanning' | 'details' | 'done' | 'error';
	/** Folders looked at so far */
	done: number;
	total: number;
	added: number;
	/** Already in the library, or without a beatmap set ID */
	skipped: number;
	message?: string;
}

export const osuImport = writable<OsuImportState>({
	state: 'idle',
	done: 0,
	total: 0,
	added: 0,
	skipped: 0
});

// Songs are saved in batches, so a big library doesn't write songData.json thousands of times
const SAVE_BATCH = 50;
const DETAILS_BATCH = 50;
const DETAILS_DELAY = 1_000;

/** The Songs folder of a default osu! stable installation, if there is one */
export async function defaultOsuSongsFolder(): Promise<string | null> {
	try {
		const folder = await path.join(await path.localDataDir(), 'osu!', 'Songs');
		return (await exists(folder)) ? folder : null;
	} catch {
		return null;
	}
}

/** Lets the user pick the osu! Songs folder; access to it is remembered across restarts */
export async function pickOsuSongsFolder(): Promise<string | null> {
	const picked = await open({
		title: 'Select your osu! Songs folder',
		directory: true,
		recursive: true,
		defaultPath: (await defaultOsuSongsFolder()) ?? undefined
	});
	return typeof picked === 'string' ? picked : null;
}

/** Reads one beatmap set folder; null if it isn't one or has no beatmap set ID */
async function readSetFolder(folder: string, name: string): Promise<StoredMapSet | null> {
	const files = await readDir(folder);
	const osuFiles = files.filter((file) => file.isFile && file.name.toLowerCase().endsWith('.osu'));
	if (!osuFiles.length) return null;

	const diffs = [];
	for (const file of osuFiles) {
		try {
			diffs.push(parseOsuFile(await readTextFile(await path.join(folder, file.name))));
		} catch (error) {
			console.warn('Could not read', file.name, error);
		}
	}
	const first = diffs.find((diff) => diff.audioFile);
	// Old maps have no BeatmapSetID in the file, but the folder starts with it
	const setId = diffs.find((diff) => diff.setId)?.setId ?? Number(name.match(/^(\d+)\s/)?.[1]);
	if (!first || !setId) return null;

	const existing = async (file: string | null) => {
		if (!file) return null;
		const filePath = await path.join(folder, file);
		return (await exists(filePath)) ? filePath : null;
	};

	const beatmaps: Record<string, Beatmap> = {};
	for (const [index, diff] of diffs.entries()) {
		const audioFile = await existing(diff.audioFile);
		if (!audioFile) continue;
		const id = String(diff.beatmapId ?? `${setId}-${index}`);
		beatmaps[id] = {
			id,
			version: diff.version,
			mode: diff.mode,
			difficulty_rating: 0,
			total_length: 0,
			downloaded: true,
			audioFile,
			// Sets with several songs: each difficulty keeps its own title, background and timing
			title: diff.title,
			artist: diff.artist,
			background: await existing(diff.background),
			timing: diff.timingPoints,
			kiai: diff.kiai
		};
	}
	if (!Object.keys(beatmaps).length) return null;

	const background = await existing(diffs.find((diff) => diff.background)?.background ?? null);
	const videoInfo = diffs.find((diff) => diff.video)?.video ?? null;
	const video = await existing(videoInfo?.file ?? null);
	const timing = first.timingPoints;
	let createdAt = Date.now();
	try {
		createdAt = (await stat(folder)).mtime?.getTime() ?? createdAt;
	} catch {
		// Keep the import time
	}

	return {
		id: String(setId),
		title: first.title,
		artist: first.artist,
		creator: first.creator,
		tags: first.tags,
		covers: {},
		status: '',
		bpm: mainBpm(timing, timing.at(-1)?.time ?? 0),
		background,
		// Formats the webview can't play are converted when the song is played
		videoSource: video,
		videoOffset: videoInfo?.offset ?? 0,
		hasVideo: !!video,
		timing,
		source: 'osu',
		beatmaps,
		created_at: createdAt
	};
}

/**
 * Adds every beatmap set of an osu! Songs folder that isn't in the library yet, then fills in
 * what the .osu files don't have (status, star rating, length) from the osu! API.
 */
export async function importOsuFolder(folder: string) {
	const state = get(osuImport).state;
	if (state === 'scanning' || state === 'details') return;
	osuImport.set({ state: 'scanning', done: 0, total: 0, added: 0, skipped: 0 });
	try {
		const entries = (await readDir(folder)).filter((entry) => entry.isDirectory);
		osuImport.update((s) => ({ ...s, total: entries.length }));

		const imported: StoredMapSet[] = [];
		let pending: Record<string, StoredMapSet> = {};
		const flush = async () => {
			if (!Object.keys(pending).length) return;
			const batch = pending;
			pending = {};
			mapDataStore.update((data) => ({ ...batch, ...data }));
			await saveMapData();
		};

		for (const entry of entries) {
			let set: StoredMapSet | null = null;
			try {
				set = await readSetFolder(await path.join(folder, entry.name), entry.name);
			} catch (error) {
				console.warn('Could not import', entry.name, error);
			}
			const known = set && (get(mapDataStore)[set.id] || pending[set.id]);
			if (set && !known) {
				pending[set.id] = set;
				imported.push(set);
			}
			osuImport.update((s) => ({
				...s,
				done: s.done + 1,
				added: s.added + (set && !known ? 1 : 0),
				skipped: s.skipped + (set && !known ? 0 : 1)
			}));
			if (Object.keys(pending).length >= SAVE_BATCH) await flush();
		}
		await flush();

		await getPlaylistSongs(-1, true);

		osuImport.update((s) => ({ ...s, state: 'details' }));
		await fillDetails(imported);
		osuImport.update((s) => ({ ...s, state: 'done' }));
		backfillImages();
	} catch (error) {
		console.error('osu! import failed:', error);
		osuImport.update((s) => ({
			...s,
			state: 'error',
			message: error instanceof Error ? error.message : String(error)
		}));
	}
}

/** Star rating, length, status and BPM from the osu! API, 50 beatmaps per request */
async function fillDetails(sets: StoredMapSet[]) {
	const ids = sets.flatMap((set) => Object.keys(set.beatmaps).filter((id) => /^\d+$/.test(id)));
	for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
		const batch = ids.slice(i, i + DETAILS_BATCH);
		try {
			const response = await fetch(
				`https://osu.ppy.sh/api/v2/beatmaps?ids[]=${batch.join('&ids[]=')}`,
				{ headers: { Authorization: `Bearer ${get(keyStore).access_token}` } }
			);
			if (!response.ok) return;
			const { beatmaps } = await response.json();
			mapDataStore.update((data) => {
				for (const map of beatmaps) {
					const set = data[map.beatmapset_id];
					const stored = set?.beatmaps?.[map.id];
					if (!stored) continue;
					stored.difficulty_rating = map.difficulty_rating;
					stored.total_length = map.total_length;
					set.status = map.beatmapset?.status ?? set.status;
					set.bpm = map.beatmapset?.bpm ?? set.bpm;
				}
				return { ...data };
			});
			await saveMapData();
		} catch (error) {
			// The songs work without these details
			console.warn('Could not load beatmap details', error);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, DETAILS_DELAY));
	}
	await getPlaylistSongs(-1, true);
}
