// The converter's files: what's been added, what each is to become, converted one after the
// other and saved to ~/Stosufy/Converted. Kept while the app runs, so leaving the page doesn't
// stop anything.

import { get, writable } from 'svelte/store';
import { readFile } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import {
	detectFormat,
	kindOf,
	targetsFor,
	type Format,
	type Kind,
	type Target
} from '../files/formats';
import { cancel, releaseWasm, release } from '../files/ffmpeg';
import { outputFolder, saveFile, type SavedFile } from '../files/save';
import { convertFile, type ConvertOptions } from './convert';

export type Status = 'ready' | 'waiting' | 'working' | 'done' | 'failed';
export type { SavedFile };

export interface Job {
	id: number;
	file: File;
	format: Format | null;
	kind: Kind;
	/** What it can become, the most wanted (and the last one chosen for its format) first */
	targets: Target[];
	/** What it becomes (a target's id), null until one is chosen */
	target: string | null;
	status: Status;
	/** 0–1 while it's converted */
	progress: number;
	error?: string;
	/** Something to know about what it was made into (not small enough, …) */
	note?: string;
	/** What it was made into, the last time */
	saved: SavedFile[];
	/** A picture of it (for pictures), an object URL */
	preview?: string;
}

export const FOLDER = 'Converted';
const OPTIONS_KEY = 'stosufy-convert-options';
const TARGETS_KEY = 'stosufy-convert-targets';

function load<T>(key: string, fallback: T): T {
	try {
		const saved = localStorage.getItem(key);
		return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
	} catch {
		return fallback;
	}
}
function keep(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// (it's only a convenience)
	}
}

export const options = writable<ConvertOptions>(
	load(OPTIONS_KEY, { quality: 'balanced', imageSize: 0, videoHeight: 0, maxBytes: 0 })
);

/** The target last chosen for each format: offered first for the next file of it */
const lastTargets: Record<string, string> = load(TARGETS_KEY, {});

export const jobs = writable<Job[]>([]);

let nextId = 1;

/** A format's targets (its own first with a size limit), else the last one chosen for it first */
function ordered(format: Format | null) {
	const shrink = get(options).maxBytes > 0;
	const targets = targetsFor(format, { shrink });
	if (shrink && targets[0]?.group === 'Smaller') return targets;
	const last = targets.findIndex((target) => target.id === lastTargets[format?.id ?? 'other']);
	return last > 0 ? [targets[last], ...targets.filter((_, i) => i !== last)] : targets;
}

let limited = get(options).maxBytes > 0;
options.subscribe((value) => {
	keep(OPTIONS_KEY, value);
	// (a size limit on or off: the files not converted yet offer their own format, or not)
	if (limited !== value.maxBytes > 0) {
		limited = value.maxBytes > 0;
		jobs.update((all) =>
			all.map((job) => (job.status === 'ready' ? { ...job, targets: ordered(job.format) } : job))
		);
	}
});

export function addFiles(files: Iterable<File>) {
	const added: Job[] = [];
	for (const file of files) {
		const format = detectFormat(file);
		const kind = kindOf(format);
		added.push({
			id: nextId++,
			file,
			format,
			kind,
			targets: ordered(format),
			target: null,
			status: 'ready',
			progress: 0,
			saved: [],
			preview:
				kind === 'image' && file.size < 40 * 1024 ** 2 ? URL.createObjectURL(file) : undefined
		});
	}
	jobs.update((all) => [...all, ...added]);
	return added.length;
}

function change(id: number, patch: Partial<Job>) {
	jobs.update((all) => all.map((job) => (job.id === id ? { ...job, ...patch } : job)));
}

/** Makes a file into this (right away, or after the ones before it) */
export function convertTo(id: number, target: string) {
	const job = get(jobs).find((job) => job.id === id);
	if (!job || job.status === 'working' || job.status === 'waiting') return;
	if (!job.targets.some((option) => option.id === target)) return;
	if (job.targets[0]?.group !== 'Smaller' || job.targets[0].id !== target) {
		lastTargets[job.format?.id ?? 'other'] = target;
		keep(TARGETS_KEY, lastTargets);
	}
	change(id, { target, status: 'waiting', progress: 0, error: undefined, note: undefined });
	void run();
}

/** Every file not converted yet into this, where it can be */
export function convertAllTo(target: string) {
	for (const job of get(jobs))
		if (job.status === 'ready' && job.targets.some((option) => option.id === target))
			convertTo(job.id, target);
}

/** The same again, after it failed */
export function retry(id: number) {
	const job = get(jobs).find((job) => job.id === id);
	if (job?.target) convertTo(id, job.target);
}

/** Back to choosing what it becomes (to make it into something else too) */
export function chooseAgain(id: number) {
	const job = get(jobs).find((job) => job.id === id);
	if (!job || job.status === 'working' || job.status === 'waiting') return;
	change(id, {
		status: 'ready',
		target: null,
		error: undefined,
		note: undefined,
		progress: 0,
		targets: ordered(job.format)
	});
}

/** Stops it (converting) or takes it out of the waiting ones */
export function stopJob(id: number) {
	const job = get(jobs).find((job) => job.id === id);
	if (job?.status === 'waiting') change(id, { status: 'ready', target: null });
	else if (job?.status === 'working') void cancel(String(id));
}

export function removeJob(id: number) {
	const job = get(jobs).find((job) => job.id === id);
	if (!job || job.status === 'working' || job.status === 'waiting') return;
	if (job.preview) URL.revokeObjectURL(job.preview);
	void release(job.file);
	jobs.update((all) => all.filter((other) => other.id !== id));
}

/** Empties the list, but for what's being converted */
export function clearJobs() {
	for (const job of get(jobs)) removeJob(job.id);
}

// --- Converting -------------------------------------------------------------------------------

let running = false;

async function run() {
	if (running) return;
	running = true;
	try {
		for (;;) {
			const job = get(jobs).find((job) => job.status === 'waiting');
			if (!job) break;
			await convertOne(job);
		}
	} finally {
		running = false;
		// (FFmpeg's memory back, when there's nothing more for it)
		void releaseWasm();
	}
}

async function convertOne(job: Job) {
	const target = job.targets.find((target) => target.id === job.target)!;
	change(job.id, { status: 'working', progress: 0 });
	try {
		const { outputs, note } = await convertFile(
			job.file,
			job.format,
			target,
			get(options),
			(progress) => change(job.id, { progress }),
			String(job.id)
		);
		const saved: SavedFile[] = [];
		for (const output of outputs) saved.push(await saveFile(FOLDER, output.name, output.what));
		change(job.id, { status: 'done', progress: 1, saved, note });
	} catch (error) {
		if ((error as Error)?.name === 'Cancelled') {
			change(job.id, { status: 'ready', target: null, progress: 0 });
			return;
		}
		console.warn(`Could not convert ${job.file.name}:`, error);
		change(job.id, {
			status: 'failed',
			error: (error as Error)?.message || "Couldn't convert it"
		});
	}
}

export const converterFolder = () => outputFolder(FOLDER);

/** What the files in the list were made into, together in one ZIP in the folder; its path */
export async function saveAllAsZip() {
	const zip = new JSZip();
	const names = new Set<string>();
	for (const file of get(jobs).flatMap((job) => job.saved)) {
		let name = file.name;
		for (let n = 2; names.has(name); n++) name = file.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
		names.add(name);
		zip.file(name, await readFile(file.path));
	}
	if (!names.size) throw new Error('Nothing converted yet');
	const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
	const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	return (await saveFile(FOLDER, `Converted ${stamp}.zip`, data)).path;
}
