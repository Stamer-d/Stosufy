// The downloads: what's been asked for, two at a time, their progress, and what they made,
// moved to ~/Stosufy/Downloads. Leaving the page stops nothing; the list is kept for the next
// time Stosufy opens (what was still downloading then: stopped, to try again). A video for
// editing (Premiere, …), downloaded whole, is made an MP4 for editing right after, once.

import { get, writable } from 'svelte/store';
import { exists, remove } from '@tauri-apps/plugin-fs';
import { saveFile, type SavedFile } from '../files/save';
import { notifyDone } from '../files/notify';
import {
	cancel as cancelFfmpeg,
	forgetCancelled,
	probe,
	runFfmpeg,
	type Made
} from '../files/ffmpeg';
import { PickedFile } from '../files/picked';
import { videoArgs } from '../files/presets';
import {
	download,
	stopDownload,
	type DownloadRequest,
	type Downloaded,
	type LinkInfo,
	type Step
} from './ytdlp';

export const FOLDER = 'Downloads';
/** At once (more would only share the same line) */
const PARALLEL = 2;
/** Kept for next time: the last this many */
const KEPT = 50;
const STORE_KEY = 'stosufy-downloads';

export type Status = 'waiting' | 'working' | 'done' | 'failed';

export interface DownloadJob {
	id: string;
	info: LinkInfo;
	request: DownloadRequest;
	status: Status;
	/** "download", or what's done after it (Merger, ExtractAudio, …; "editing": made an MP4 for
	 * editing) */
	phase: string;
	/** 0–100 of what's downloaded now: the picture or the sound, which of a playlist's videos */
	percent: number | null;
	stream: 'video' | 'audio' | null;
	index: number | null;
	count: number | null;
	speed: string | null;
	eta: string | null;
	/** What it does before the download (the link opened, …; null: not told yet) */
	step?: Step | null;
	error?: string;
	/** Some of it couldn't be downloaded (a playlist's private videos, …) */
	note?: string;
	saved: SavedFile[];
	/** Its files aren't there any more (moved or deleted) */
	missing?: boolean;
}

/** The list as it was kept: what was still to do then, stopped */
function load(): DownloadJob[] {
	try {
		const kept = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as DownloadJob[];
		if (!Array.isArray(kept)) return [];
		return kept
			.filter((job) => job?.id && job.info && job.request)
			.map((job) =>
				job.status === 'done' || job.status === 'failed'
					? job
					: {
							...job,
							status: 'failed',
							error: 'Stopped when Stosufy was closed',
							percent: null,
							speed: null,
							eta: null
						}
			);
	} catch {
		return [];
	}
}

export const downloads = writable<DownloadJob[]>(typeof window === 'undefined' ? [] : load());

/** Kept as it is now (only what's needed again: not a link's every quality) */
let keeping: ReturnType<typeof setTimeout> | undefined;
downloads.subscribe((all) => {
	if (typeof window === 'undefined') return;
	clearTimeout(keeping);
	keeping = setTimeout(() => {
		const slim = all.slice(0, KEPT).map((job) => ({
			...job,
			info: { ...job.info, videos: job.info.videos.map((video) => ({ ...video, qualities: [] })) }
		}));
		try {
			localStorage.setItem(STORE_KEY, JSON.stringify(slim));
		} catch {
			// (only a convenience)
		}
	}, 300);
});

/** The kept downloads whose files aren't there any more: said so */
export async function checkFiles() {
	const done = get(downloads).filter((job) => job.status === 'done' && job.saved.length);
	for (const job of done) {
		const there = await Promise.all(job.saved.map((file) => exists(file.path).catch(() => true)));
		const missing = !there.some(Boolean);
		if (missing !== !!job.missing) change(job.id, { missing });
	}
}

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

/** The browser's sign-in couldn't be read (it locks it, or isn't there) */
const signInFailed = (message: string) =>
	/sign-in couldn't be read|Full Disk Access/i.test(message);

async function work(job: DownloadJob) {
	try {
		const result = await downloadOrWithout(job);
		if (result.cancelled) {
			downloads.update((all) => all.filter((other) => other.id !== job.id));
			return;
		}
		await finish(job, result);
	} catch (error) {
		// (stopped while it was made ready for editing)
		if ((error as Error)?.name === 'Cancelled') {
			downloads.update((all) => all.filter((other) => other.id !== job.id));
			return;
		}
		console.warn('Could not download:', error);
		change(job.id, {
			status: 'failed',
			error: String((error as Error)?.message ?? error) || "It couldn't be downloaded"
		});
	} finally {
		stopped.delete(job.id);
		forgetCancelled(job.id);
	}
}

/** Downloaded; without the browser's sign-in, if that can't be read (said so) */
async function downloadOrWithout(job: DownloadJob) {
	try {
		return await downloadIt(job);
	} catch (error) {
		if (!job.request.cookies || !signInFailed(String((error as Error)?.message ?? error)))
			throw error;
		const request = { ...job.request, cookies: null };
		change(job.id, { request, note: "The browser's sign-in couldn't be read: without it" });
		return downloadIt({ ...job, request });
	}
}

function downloadIt(job: DownloadJob) {
	return download(
		job.id,
		job.request,
		(progress) => {
			// (what it does before the download: told, not a phase of its own)
			if (progress.phase === 'step') return change(job.id, { step: progress.step ?? null });
			// (a part cut out by FFmpeg: how far, of the part's length)
			if (progress.phase === 'cut') {
				const [from, to] = job.request.sections[0] ?? [0, 0];
				const share = to > from ? ((progress.seconds ?? 0) / (to - from)) * 100 : null;
				return change(job.id, {
					phase: 'download',
					step: 'cut',
					percent: share === null ? null : Math.min(100, Math.max(0, share)),
					speed: progress.speed && progress.speed !== '0x' ? progress.speed : null,
					eta: null
				});
			}
			const patch: Partial<DownloadJob> = { phase: progress.phase };
			if (progress.phase === 'download') {
				patch.step = null;
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
}

/** Whether what's downloaded is made an MP4 for editing after (a part's made so as it's cut) */
const madeAfter = (request: DownloadRequest) =>
	!!request.editing && request.kind === 'video' && !request.sections.length;

/**
 * A video downloaded whole made an MP4 for editing (Premiere, After Effects, Resolve): H.264
 * as editors play it smoothly, at its best (see presets.ts), its progress told
 */
async function forEditing(
	job: DownloadJob,
	file: { path: string; size: number },
	name: string,
	index: number,
	count: number
): Promise<Made> {
	const extension = name.split('.').pop() ?? '';
	const input = new PickedFile(file.path, name, file.size);
	const told = (percent: number) =>
		change(job.id, {
			phase: 'editing',
			step: null,
			percent,
			speed: null,
			eta: null,
			index: count > 1 ? index : null,
			count: count > 1 ? count : null
		});
	told(0);
	const info = await probe(input, extension, job.id);
	return runFfmpeg(input, extension, videoArgs('editing', 'best', { fps: info.fps }), 'mp4', {
		id: job.id,
		duration: info.duration,
		progress: (share) => told(Math.min(100, Math.max(0, share * 100)))
	});
}

/** What was downloaded moved to Stosufy/Downloads (made an MP4 for editing first, if asked) */
async function finish(job: DownloadJob, result: Downloaded) {
	if (!result.files.length) throw new Error(result.error ?? 'Nothing was downloaded');
	// (a playlist's videos in a folder of its own)
	const folder = job.request.playlist ? `${job.info.title.replace(/[\\/]/g, '_')}/` : '';
	const saved: SavedFile[] = [];
	// (its folder in tmp: taken away after, whatever happened)
	const tmp = result.files[0].path.replace(/[\\/][^\\/]+$/, '');
	let failed = '';
	try {
		for (const [i, file] of result.files.entries()) {
			const name = file.path.split(/[\\/]/).pop()!;
			if (madeAfter(job.request)) {
				try {
					const made = await forEditing(job, file, name, i + 1, result.files.length);
					saved.push(await saveFile(FOLDER, folder + name.replace(/\.[^.]+$/, '.mp4'), made));
					continue;
				} catch (error) {
					if ((error as Error)?.name === 'Cancelled') throw error;
					// (not made ready: kept as it was downloaded, not lost, said so)
					console.warn('Could not make it ready for editing:', error);
					failed = String((error as Error)?.message ?? error);
				}
			}
			saved.push(await saveFile(FOLDER, folder + name, { path: file.path, size: file.size }));
		}
	} finally {
		await remove(tmp, { recursive: true }).catch(() => {});
	}
	change(job.id, {
		status: 'done',
		saved,
		percent: 100,
		phase: 'download',
		// (it couldn't be made ready for editing; what went wrong with some; else that it was
		// without the sign-in)
		note: failed
			? `Couldn't make it ready for Premiere (kept as downloaded): ${failed}`
			: (result.error ?? get(downloads).find((other) => other.id === job.id)?.note)
	});
	finished++;
}

/** Stops it (and takes it off the list), or takes a waiting one off */
export function stop(id: string) {
	const job = get(downloads).find((job) => job.id === id);
	if (job?.status === 'working') {
		stopped.add(id);
		void stopDownload(id);
		// (being made ready for editing: that stopped)
		if (job.phase === 'editing') void cancelFfmpeg(id);
	} else downloads.update((all) => all.filter((other) => other.id !== id));
}

export function retry(id: string) {
	change(id, {
		status: 'waiting',
		error: undefined,
		note: undefined,
		missing: false,
		saved: [],
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
