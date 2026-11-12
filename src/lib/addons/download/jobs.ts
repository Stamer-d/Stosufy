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
	/** 0–100 of what's downloaded now; which of its streams (video, sound) */
	percent: number | null;
	stream: number;
	speed: string | null;
	eta: string | null;
	error?: string;
	saved: SavedFile[];
}

export const downloads = writable<DownloadJob[]>([]);

let nextId = 1;
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
			stream: 1,
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
	let last = 0;
	try {
		const result = await download(job.id, job.request, (progress) => {
			const patch: Partial<DownloadJob> = { phase: progress.phase };
			if (progress.phase === 'download' && progress.percent !== null) {
				// (a second stream starting: the sound after the video)
				const current = get(downloads).find((other) => other.id === job.id);
				if (current && progress.percent + 30 < last) patch.stream = current.stream + 1;
				last = progress.percent;
				patch.percent = progress.percent;
				patch.speed =
					progress.speed && !/^0(\.0+)?B\/s$/.test(progress.speed) ? progress.speed : null;
				patch.eta = progress.eta;
			}
			change(job.id, patch);
		});
		if (result.cancelled) {
			downloads.update((all) => all.filter((other) => other.id !== job.id));
			return;
		}
		if (!result.files.length) throw new Error('Nothing was downloaded');
		const saved: SavedFile[] = [];
		for (const file of result.files) {
			const name = file.path.split(/[\\/]/).pop()!;
			saved.push(await saveFile(FOLDER, name, { path: file.path, size: file.size }));
		}
		// (its folder in tmp, now empty)
		const folder = result.files[0].path.replace(/[\\/][^\\/]+$/, '');
		await remove(folder, { recursive: true }).catch(() => {});
		change(job.id, { status: 'done', saved, percent: 100 });
		finished++;
	} catch (error) {
		console.warn('Could not download:', error);
		change(job.id, {
			status: 'failed',
			error: String((error as Error)?.message ?? error) || "It couldn't be downloaded"
		});
	}
}

/** Stops it (and takes it off the list), or takes a waiting one off */
export function stop(id: string) {
	const job = get(downloads).find((job) => job.id === id);
	if (job?.status === 'working') void stopDownload(id);
	else downloads.update((all) => all.filter((other) => other.id !== id));
}

export function retry(id: string) {
	change(id, { status: 'waiting', error: undefined, percent: null, stream: 1, phase: 'download' });
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
