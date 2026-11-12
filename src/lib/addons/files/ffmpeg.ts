// FFmpeg for the file add-ons (converter, editor): the computer's own (native.ts, many times
// faster, no memory limit) when it's there, else the one in WebAssembly (its core from the
// network once, then the cache). One file at a time either way.
//
// The native one works on files in its work folder: a file to convert is copied there first
// (once per file, see `release`), and what it makes stays there until it's saved (moved).

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { readFile, remove, stat, writeFile } from '@tauri-apps/plugin-fs';
import { nativeFfmpeg } from './native';

/** What FFmpeg made: its bytes, or (the native one) a file in the work folder */
export type Made = { data: Uint8Array } | { path: string; size: number };

export interface RunOptions {
	/** 0–1 as it goes */
	progress?: (share: number) => void;
	/** How long the input is (s), for the progress */
	duration?: number;
	/** To stop it, with `cancel` */
	id?: string;
}

export interface Probe {
	/** Seconds, 0 if unknown */
	duration: number;
	audio: boolean;
	/** A picture that moves (not a cover) */
	video: boolean;
	/** A cover (an audio file's picture) */
	cover: boolean;
	width: number;
	height: number;
}

export class Cancelled extends Error {
	constructor() {
		super('Stopped');
		this.name = 'Cancelled';
	}
}

let queue: Promise<unknown> = Promise.resolve();
/** One at a time (the WebAssembly one can't do more, and the native one is faster alone) */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
	const run = queue.then(work);
	queue = run.catch(() => {});
	return run;
}

const randomId = () => Math.random().toString(36).slice(2, 10);

// --- The native one -----------------------------------------------------------------------

/** The copies of files in the work folder, by file */
const copies = new WeakMap<Blob, Promise<string>>();
const CHUNK = 8 * 1024 * 1024;

/** A file in the work folder (copied there in parts, once) */
function copyIn(file: Blob, extension: string, dir: string): Promise<string> {
	let copy = copies.get(file);
	if (!copy) {
		copy = (async () => {
			const path = `${dir}/in-${randomId()}.${extension || 'bin'}`;
			if (!file.size) await writeFile(path, new Uint8Array());
			for (let at = 0; at < file.size; at += CHUNK) {
				const part = new Uint8Array(await file.slice(at, at + CHUNK).arrayBuffer());
				await writeFile(path, part, { append: at > 0 });
			}
			return path;
		})();
		copy.catch(() => copies.delete(file));
		copies.set(file, copy);
	}
	return copy;
}

/** The file's copy in the work folder taken away (once nothing more is done with it) */
export async function release(file: Blob) {
	const copy = copies.get(file);
	if (!copy) return;
	copies.delete(file);
	await remove(await copy).catch(() => {});
}

const progressHandlers = new Map<string, (share: number) => void>();
let listening: Promise<unknown> | null = null;
function listenToProgress() {
	listening ??= listen<{ id: string; progress: number }>('ffmpeg-progress', ({ payload }) =>
		progressHandlers.get(payload.id)?.(payload.progress)
	).catch(() => (listening = null));
	return listening;
}

async function runNative(
	dir: string,
	input: string,
	args: string[],
	outputExtension: string,
	options: RunOptions
): Promise<Made> {
	await listenToProgress();
	const id = options.id ?? randomId();
	const output = `${dir}/out-${randomId()}.${outputExtension}`;
	if (options.progress) progressHandlers.set(id, options.progress);
	try {
		const result = await invoke<{ code: number; log: string; cancelled: boolean }>('ffmpeg_run', {
			id,
			args: ['-i', input, ...args, output],
			duration: options.duration || null
		});
		if (result.cancelled) {
			await remove(output).catch(() => {});
			throw new Cancelled();
		}
		if (result.code !== 0) {
			await remove(output).catch(() => {});
			throw new Error(explain(result.log.split('\n')));
		}
		const { size } = await stat(output);
		if (!size) throw new Error('The result was empty');
		return { path: output, size };
	} finally {
		progressHandlers.delete(id);
	}
}

// --- The one in WebAssembly ---------------------------------------------------------------

let wasm: Promise<FFmpeg> | null = null;
let wasmLog: string[] = [];
let wasmProgress: ((share: number) => void) | null = null;
let wasmRunning: string | null = null;

function loadWasm() {
	wasm ??= (async () => {
		const made = new FFmpeg();
		made.on('log', ({ message }) => {
			wasmLog.push(message);
			if (wasmLog.length > 60) wasmLog.shift();
		});
		made.on('progress', ({ progress }) => {
			if (progress >= 0 && progress <= 1) wasmProgress?.(progress);
		});
		await made.load();
		return made;
	})().catch((error) => {
		wasm = null;
		throw new Error(`Couldn't start the converter (${error?.message ?? error})`);
	});
	return wasm;
}

async function runWasm(
	input: Uint8Array,
	extension: string,
	args: string[],
	outputExtension: string,
	options: RunOptions
): Promise<Made> {
	const ff = await loadWasm();
	const id = randomId();
	const from = `in-${id}.${extension || 'bin'}`;
	const to = `out-${id}.${outputExtension}`;
	wasmLog = [];
	wasmProgress = options.progress ?? null;
	wasmRunning = options.id ?? id;
	try {
		await ff.writeFile(from, input);
		const code = await ff.exec(['-hide_banner', '-y', '-i', from, ...args, to]);
		if (wasmRunning === null) throw new Cancelled();
		if (code !== 0) throw new Error(explain(wasmLog));
		const data = (await ff.readFile(to)) as Uint8Array;
		if (!data.length) throw new Error('The result was empty');
		return { data };
	} catch (error) {
		// (stopped: its worker was ended, and with it what it held)
		if (wasmRunning === null) throw new Cancelled();
		throw error;
	} finally {
		wasmProgress = null;
		wasmRunning = null;
		await ff.deleteFile(from).catch(() => {});
		await ff.deleteFile(to).catch(() => {});
	}
}

// --- Either -------------------------------------------------------------------------------

/**
 * Runs FFmpeg on a file: `args` between the input and the output. What it made: bytes, or a
 * file in the work folder (the native one: `save` moves it, `discard` takes it away).
 */
export function runFfmpeg(
	input: Blob,
	extension: string,
	args: string[],
	outputExtension: string,
	options: RunOptions = {}
): Promise<Made> {
	return inTurn(async () => {
		const dir = await nativeFfmpeg();
		if (dir)
			return runNative(dir, await copyIn(input, extension, dir), args, outputExtension, options);
		return runWasm(
			new Uint8Array(await input.arrayBuffer()),
			extension,
			args,
			outputExtension,
			options
		);
	});
}

/** The same, for bytes in and bytes out (pictures, small things) */
export async function runFfmpegBytes(
	input: Uint8Array,
	extension: string,
	args: string[],
	outputExtension: string
): Promise<Uint8Array> {
	const blob = new Blob([input as BlobPart]);
	try {
		return await bytesOf(await runFfmpeg(blob, extension, args, outputExtension));
	} finally {
		void release(blob);
	}
}

/** What was made, as bytes (a file of the native one read, and taken away) */
export async function bytesOf(made: Made): Promise<Uint8Array> {
	if ('data' in made) return made.data;
	try {
		return await readFile(made.path);
	} finally {
		await remove(made.path).catch(() => {});
	}
}

/** What was made, not wanted after all */
export async function discard(made: Made) {
	if ('path' in made) await remove(made.path).catch(() => {});
}

/** Stops what runs with this id (it ends with `Cancelled`) */
export async function cancel(id: string) {
	if (await nativeFfmpeg({ install: false })) {
		await invoke('ffmpeg_cancel', { id }).catch(() => {});
	} else if (wasmRunning === id && wasm) {
		wasmRunning = null;
		const done = wasm;
		wasm = null;
		(await done.catch(() => null))?.terminate();
	}
}

/** Ends the WebAssembly FFmpeg when nothing's being converted (it holds a lot of memory) */
export async function releaseWasm() {
	if (wasmRunning || !wasm) return;
	const done = wasm;
	wasm = null;
	(await done.catch(() => null))?.terminate();
}

/** What's in a media file: how long, sound, picture, cover, size */
export function probe(input: Blob, extension: string): Promise<Probe> {
	return inTurn(async () => {
		const dir = await nativeFfmpeg();
		let text: string;
		if (dir) {
			text = await invoke<string>('ffmpeg_probe', { path: await copyIn(input, extension, dir) });
		} else {
			const ff = await loadWasm();
			const name = `probe-${randomId()}.${extension || 'bin'}`;
			wasmLog = [];
			await ff.writeFile(name, new Uint8Array(await input.arrayBuffer()));
			await ff.exec(['-hide_banner', '-i', name]).catch(() => {});
			await ff.deleteFile(name).catch(() => {});
			text = wasmLog.join('\n');
		}
		return parseProbe(text);
	});
}

export function parseProbe(text: string): Probe {
	const time = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
	const streams = text.split('\n').filter((line) => /Stream #\d+:\d+/.test(line));
	const videos = streams.filter((line) => /Video:/.test(line));
	const moving = videos.filter((line) => !/attached pic/.test(line));
	const size = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(moving[0] ?? videos[0] ?? '');
	return {
		duration: time ? +time[1] * 3600 + +time[2] * 60 + +time[3] : 0,
		audio: streams.some((line) => /Audio:/.test(line)),
		video: moving.length > 0,
		cover: videos.some((line) => /attached pic/.test(line)),
		width: size ? +size[1] : 0,
		height: size ? +size[2] : 0
	};
}

/** What FFmpeg said went wrong, in a line */
function explain(lines: string[]) {
	const said = lines
		.map((line) => line.trim())
		.filter((line) =>
			/invalid|error|not supported|unknown|could not|no such|does not contain|failed|matches no/i.test(
				line
			)
		)
		.at(-1);
	if (/does not contain any stream|matches no streams|does not contain/i.test(said ?? ''))
		return 'The file has nothing of that kind in it (no sound, no picture?)';
	if (/Invalid data found/i.test(said ?? '')) return "The file couldn't be read: is it broken?";
	return said ? `The converter said: ${said.replace(/^\[[^\]]*\]\s*/, '')}` : "Couldn't convert it";
}
