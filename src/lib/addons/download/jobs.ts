// The downloads: what's been asked for, two at a time, their progress, and what they made,
// moved to ~/Stosufy/Downloads. Kept while the app runs (leaving the page stops nothing).

import { get, writable } from 'svelte/store';
import { remove } from '@tauri-apps/plugin-fs';
import { saveFile, type SavedFile } from '../files/save';
import { notifyDone } from '../files/notify';
import { download, stopDownload, type DownloadRequest, type LinkInfo } from './ytdlp';

export const FOLDER = 'Downloads';
/** At once (more would only share the same line) */
const PARALLEL = 2;

export type Status = 'waiting' | 'working' | 'done' | 'failed';

export interface DownloadJob {
	id: string;
	info: LinkInfo;
	request: DownloadRequest;
	status: Status;
	/** "download", or what's done after it (Merger, ExtractAudio, …) */
	phase: string;
	/** 0–100 of what's downloaded now: the picture or the sound, which of a playlist's videos */
	percent: number | null;
	stream: 'video' | 'audio' | null;
	index: number | null;
	count: number | null;
	speed: string | null;
	eta: string | null;
	error?: string;
	/** Some of it couldn't be downloaded (a playlist's private videos, …) */
	note?: string;
	saved: SavedFile[];
}

export const downloads = writable<DownloadJob[]>([]);

let nextId = 1;
/** Stopped before yt-dlp ran (while it got ready) */
const stopped = new Set<string>();
let workers = 0;
let finished = 0;

function change(id: string, patch: Partial<DownloadJob>) {
	downloads.update((all) => all.map((job) => (job.id === id ? { ...job, ...patch } : job)));
}

/** Asks for a download (it starts when it's its turn) */
export function addDownload(info: LinkInfo, request: DownloadRequest) {
	const id = `dl-${Date.now().toString(36)}-${nextId++}`;
	downloads.update((all) => [
		{
			id,
			info,
			request,
			status: 'waiting',
			phase: 'download',
			percent: null,
			stream: null,
			index: null,
			count: null,
			speed: null,
			eta: null,
			saved: []
		},
		...all
	]);
	void run();
	return id;
}

function run() {
	while (workers < PARALLEL) {
		const job = [...get(downloads)].reverse().find((job) => job.status === 'waiting');
		if (!job) break;
		workers++;
		change(job.id, { status: 'working' });
		void work(job).finally(() => {
			workers--;
			if (get(downloads).some((job) => job.status === 'waiting')) run();
			else if (!workers && finished) {
				void notifyDone(
					finished === 1 ? 'Downloaded' : `${finished} downloads done`,
					'Ready in Stosufy/Downloads'
				);
				finished = 0;
			}
		});
	}
}

async function work(job: DownloadJob) {
	try {
		const result = await download(
			job.id,
			job.request,
			(progress) => {
				const patch: Partial<DownloadJob> = { phase: progress.phase };
				if (progress.phase === 'download') {
					patch.percent = progress.percent;
					patch.speed =
						progress.speed && !/^0(\.0+)?B\/s$/.test(progress.speed) ? progress.speed : null;
					patch.eta = progress.eta;
					if (progress.stream) patch.stream = progress.stream;
					if (progress.index) patch.index = progress.index;
					if (progress.count) patch.count = progress.count;
				}
				change(job.id, patch);
			},
			() => stopped.has(job.id)
		);
		if (result.cancelled) {
			downloads.update((all) => all.filter((other) => other.id !== job.id));
			return;
		}
		if (!result.files.length) throw new Error(result.error ?? 'Nothing was downloaded');
		// (a playlist's videos in a folder of its own)
		const folder = job.request.playlist ? `${job.info.title.replace(/[\\/]/g, '_')}/` : '';
		const saved: SavedFile[] = [];
		for (const file of result.files) {
			const name = file.path.split(/[\\/]/).pop()!;
			saved.push(await saveFile(FOLDER, folder + name, { path: file.path, size: file.size }));
		}
		// (its folder in tmp, now empty)
		const tmp = result.files[0].path.replace(/[\\/][^\\/]+$/, '');
		await remove(tmp, { recursive: true }).catch(() => {});
		change(job.id, {
			status: 'done',
			saved,
			percent: 100,
			note: result.error ?? undefined
		});
		finished++;
	} catch (error) {
		console.warn('Could not download:', error);
		change(job.id, {
			status: 'failed',
			error: String((error as Error)?.message ?? error) || "It couldn't be downloaded"
		});
	} finally {
		stopped.delete(job.id);
	}
}

/** Stops it (and takes it off the list), or takes a waiting one off */
export function stop(id: string) {
	const job = get(downloads).find((job) => job.id === id);
	if (job?.status === 'working') {
		stopped.add(id);
		void stopDownload(id);
	} else downloads.update((all) => all.filter((other) => other.id !== id));
}

export function retry(id: string) {
	change(id, {
		status: 'waiting',
		error: undefined,
		note: undefined,
		percent: null,
		stream: null,
		index: null,
		phase: 'download'
	});
	run();
}

export function removeDownload(id: string) {
	downloads.update((all) => all.filter((job) => job.id !== id || job.status === 'working'));
}

export function clearFinished() {
	downloads.update((all) =>
		all.filter((job) => job.status === 'working' || job.status === 'waiting')
	);
}
