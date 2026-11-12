// The computer's own FFmpeg (see src-tauri/src/ffmpeg.rs): there or not, downloaded when it's
// first needed (in the background, once), and its work folder. Where there's none (the web
// app, a computer it isn't made for, a failed download) the WebAssembly one does the work.

import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type NativeStatus = 'unknown' | 'unavailable' | 'downloading' | 'ready' | 'failed';

export interface NativeState {
	status: NativeStatus;
	/** 0–1 while it's downloaded */
	progress: number;
	/** How big the download is (bytes) */
	size: number;
	error?: string;
}

export const nativeState = writable<NativeState>({ status: 'unknown', progress: 0, size: 0 });

interface Status {
	supported: boolean;
	installed: boolean;
	downloadSize: number;
	workDir: string;
}

let workDir: string | null = null;
let checked: Promise<Status | null> | null = null;
let installing: Promise<boolean> | null = null;

function check() {
	checked ??= invoke<Status | null>('ffmpeg_status')
		.then((status) => status ?? null)
		.catch(() => null)
		.then((status) => {
			workDir = status?.workDir ?? null;
			nativeState.update((state) => ({
				...state,
				size: status?.downloadSize ?? 0,
				status: !status?.supported ? 'unavailable' : status.installed ? 'ready' : state.status
			}));
			return status;
		});
	return checked;
}

/** Downloads it if it isn't there (once at a time); whether it's there now */
export function installNative(): Promise<boolean> {
	installing ??= (async () => {
		const status = await check();
		if (!status?.supported) return false;
		if (status.installed) return true;
		nativeState.update((state) => ({
			...state,
			status: 'downloading',
			progress: 0,
			error: undefined
		}));
		const stop = await listen<{ received: number; total: number }>(
			'ffmpeg-install',
			({ payload }) =>
				nativeState.update((state) => ({
					...state,
					progress: payload.total ? payload.received / payload.total : 0
				}))
		).catch(() => null);
		try {
			await invoke('ffmpeg_install');
			checked = null;
			await check();
			nativeState.update((state) => ({ ...state, status: 'ready', progress: 1 }));
			return true;
		} catch (error) {
			console.warn('Could not get FFmpeg:', error);
			nativeState.update((state) => ({
				...state,
				status: 'failed',
				error: String((error as Error)?.message ?? error)
			}));
			return false;
		} finally {
			stop?.();
			installing = null;
		}
	})();
	return installing;
}

/**
 * The native FFmpeg's work folder when it's there (null: use the WebAssembly one). Waits for a
 * download that's going on, and starts one (unless `install` is false or one failed before).
 */
export async function nativeFfmpeg({ install = true } = {}): Promise<string | null> {
	const status = await check();
	if (!status?.supported) return null;
	const state = get(nativeState).status;
	if (state === 'ready') return workDir;
	if (state === 'downloading') return (await installing) ? workDir : null;
	if (!install || state === 'failed') return null;
	return (await installNative()) ? workDir : null;
}

/** Try the download again (after it failed) */
export function retryNative() {
	nativeState.update((state) => ({ ...state, status: 'unknown', error: undefined }));
	checked = null;
	return installNative();
}
