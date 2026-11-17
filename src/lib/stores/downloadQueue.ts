// Downloads many beatmap sets one after another (e.g. a playlist from the osu! profile),
// with a pause in between, waiting out osu!'s rate limit instead of failing.

import { get, writable } from 'svelte/store';
import { keyStore, sessionKeyNeeded } from './auth';
import { notify } from './notifications';
import { downloadBeatmap, isSongDownloaded } from './data';
import type { MapSet } from '../types';

export interface DownloadQueueState {
	/** Waiting, in order; the first one is downloading */
	items: { set: MapSet; mapId: number | string }[];
	done: number;
	failed: number;
	/** When osu! rate limits the downloads, the queue waits until then */
	pausedUntil: number | null;
	/** Stops the queue, e.g. when the osu_session cookie expired */
	error: string | null;
}

export const downloadQueue = writable<DownloadQueueState>({
	items: [],
	done: 0,
	failed: 0,
	pausedUntil: null,
	error: null
});

const PAUSE_BETWEEN = 2_000;
const RATE_LIMIT_PAUSE = 60_000;

let running = false;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Adds sets to the queue; downloaded or already queued ones are skipped */
export function queueDownloads(sets: { set: MapSet; mapId: number | string }[]) {
	downloadQueue.update((state) => {
		const queued = new Set(state.items.map((item) => String(item.set.id)));
		const fresh = sets.filter(({ set }) => {
			const id = String(set.id);
			if (queued.has(id) || isSongDownloaded(id)) return false;
			queued.add(id);
			return true;
		});
		// A new batch starts counting from zero
		const idle = !state.items.length;
		return {
			...state,
			items: [...state.items, ...fresh],
			done: idle ? 0 : state.done,
			failed: idle ? 0 : state.failed,
			error: null
		};
	});
	run();
}

/** Cancels the waiting downloads (only those of the given sets, if any); a running one ends */
export function cancelDownloads(setIds?: string[]) {
	downloadQueue.update((state) => ({
		...state,
		items: state.items.filter(
			({ set }, index) =>
				(running && index === 0) || (setIds !== undefined && !setIds.includes(String(set.id)))
		)
	}));
}

async function run() {
	if (running) return;
	running = true;
	try {
		while (get(downloadQueue).items.length) {
			const { set, mapId } = get(downloadQueue).items[0];
			let outcome: 'done' | 'failed' | 'retry' | 'stop' = 'done';
			if (!isSongDownloaded(String(set.id))) {
				try {
					const { sessionKey, access_token } = get(keyStore);
					await downloadBeatmap(set, mapId, sessionKey, access_token, { quiet: true });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (/HTTP 429/.test(message)) outcome = 'retry';
					else if (/osu_session|HTTP 40[13]/.test(message)) {
						outcome = 'stop';
						downloadQueue.update((state) => ({ ...state, error: message }));
					} else outcome = 'failed';
				}
			}
			if (outcome === 'stop') {
				notify({
					kind: 'downloads',
					title: 'Downloads stopped',
					body: get(downloadQueue).error ?? undefined,
					icon: 'icon-[mingcute--warning-line]',
					tone: 'text-red-400',
					action: { label: 'Add session key', run: () => sessionKeyNeeded.set(true) },
					duration: 12000
				});
				break;
			}
			if (outcome === 'retry') {
				// osu! limits the downloads: wait a minute, then try the same one again
				downloadQueue.update((state) => ({ ...state, pausedUntil: Date.now() + RATE_LIMIT_PAUSE }));
				await wait(RATE_LIMIT_PAUSE);
				downloadQueue.update((state) => ({ ...state, pausedUntil: null }));
				continue;
			}
			downloadQueue.update((state) => ({
				...state,
				items: state.items.slice(1),
				done: state.done + (outcome === 'done' ? 1 : 0),
				failed: state.failed + (outcome === 'failed' ? 1 : 0)
			}));
			if (get(downloadQueue).items.length) await wait(PAUSE_BETWEEN);
			else notifyDone();
		}
	} finally {
		running = false;
	}
}

/** Tells how the batch went, once the queue is empty */
function notifyDone() {
	const { done, failed } = get(downloadQueue);
	if (!done && !failed) return;
	const songs = (count: number) => `${count} ${count === 1 ? 'song' : 'songs'}`;
	notify({
		kind: 'downloads',
		title: failed && !done ? 'Downloads failed' : 'Downloads finished',
		body: [done && `${songs(done)} downloaded`, failed && `${songs(failed)} failed`]
			.filter(Boolean)
			.join(', '),
		icon: failed ? 'icon-[mingcute--warning-line]' : 'icon-[mingcute--download-2-line]',
		tone: failed ? 'text-amber-300' : 'text-green-400',
		duration: 8000
	});
}

/** Continues after the queue stopped, e.g. once the user logged in again */
export function resumeDownloads() {
	downloadQueue.update((state) => ({ ...state, error: null }));
	run();
}
