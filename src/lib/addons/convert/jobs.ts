// The converter's files: what's been added, what each is to become, converted one after the
// other and saved to ~/Stosufy/Converted. Kept while the app runs, so leaving the page doesn't
// stop anything.

import { get, writable } from 'svelte/store';
import * as path from '@tauri-apps/api/path';
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';
import JSZip from 'jszip';
import { detectFormat, kindOf, targetsFor, type Format, type Kind, type Target } from './formats';
import { convertFile, type ConvertOptions } from './convert';
import { releaseMedia } from './media';

export type Status = 'ready' | 'waiting' | 'working' | 'done' | 'failed';

export interface SavedFile {
	name: string;
	path: string;
	size: number;
}

export interface Job {
	id: number;
	file: File;
	format: Format | null;
	kind: Kind;
	targets: Target[];
	/** What it's to become (a target's id) */
	target: string;
	status: Status;
	/** 0–1 while it's converted */
	progress: number;
	error?: string;
	saved: SavedFile[];
	/** A picture of it (for pictures), an object URL */
	preview?: string;
}

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
	load(OPTIONS_KEY, { quality: 'balanced', imageSize: 0, videoHeight: 0 })
);
options.subscribe((value) => keep(OPTIONS_KEY, value));

/** The target last chosen for each format, chosen again for the next file of it */
const lastTargets: Record<string, string> = load(TARGETS_KEY, {});

export const jobs = writable<Job[]>([]);

let nextId = 1;

/** The usual target of a file: the last one chosen for its format, else the first */
function defaultTarget(format: Format | null, targets: Target[]) {
	const last = lastTargets[format?.id ?? 'other'];
	return targets.some((target) => target.id === last) ? last : targets[0].id;
}

export function addFiles(files: Iterable<File>) {
	const added: Job[] = [];
	for (const file of files) {
		const format = detectFormat(file);
		const targets = targetsFor(format);
		const kind = kindOf(format);
		added.push({
			id: nextId++,
			file,
			format,
			kind,
			targets,
			target: defaultTarget(format, targets),
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

export function setTarget(id: number, target: string) {
	const job = get(jobs).find((job) => job.id === id);
	if (!job || job.status === 'working' || job.status === 'waiting') return;
	lastTargets[job.format?.id ?? 'other'] = target;
	keep(TARGETS_KEY, lastTargets);
	// (a new target: to be converted again)
	change(id, { target, status: 'ready', error: undefined, progress: 0 });
}

/** Every file of a kind (or all) to become this, where it can */
export function setTargetForAll(target: string, kind?: Kind) {
	for (const job of get(jobs))
		if ((!kind || job.kind === kind) && job.targets.some((option) => option.id === target))
			setTarget(job.id, target);
}

export function removeJob(id: number) {
	const job = get(jobs).find((job) => job.id === id);
	if (!job || job.status === 'working') return;
	if (job.preview) URL.revokeObjectURL(job.preview);
	jobs.update((all) => all.filter((other) => other.id !== id));
}

/** Takes away what's done or failed (and what's not started yet, with `everything`) */
export function clearJobs(everything = false) {
	for (const job of get(jobs))
		if (job.status === 'done' || job.status === 'failed' || (everything && job.status === 'ready'))
			removeJob(job.id);
}

// --- Converting -------------------------------------------------------------------------------

let running = false;

/** Converts the files that are ready (or just these), one after the other */
export function convert(ids?: number[]) {
	for (const job of get(jobs))
		if ((!ids || ids.includes(job.id)) && (job.status === 'ready' || job.status === 'failed'))
			change(job.id, { status: 'waiting', progress: 0, error: undefined });
	void run();
}

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
		void releaseMedia();
	}
}

async function convertOne(job: Job) {
	const target = job.targets.find((target) => target.id === job.target)!;
	change(job.id, { status: 'working', progress: 0 });
	try {
		const outputs = await convertFile(job.file, job.format, target, get(options), (progress) =>
			change(job.id, { progress })
		);
		const saved: SavedFile[] = [];
		for (const output of outputs) {
			saved.push({ ...(await save(output.name, output.data)), size: output.data.length });
		}
		change(job.id, { status: 'done', progress: 1, saved });
	} catch (error) {
		console.warn(`Could not convert ${job.file.name}:`, error);
		change(job.id, {
			status: 'failed',
			error: (error as Error)?.message || "Couldn't convert it"
		});
	}
}

// --- Saving -----------------------------------------------------------------------------------

let folder: Promise<string> | null = null;

/** ~/Stosufy/Converted, made when it's first needed */
export function outputFolder() {
	folder ??= (async () => {
		const dir = await path.join(await path.homeDir(), 'Stosufy', 'Converted');
		await mkdir(dir, { recursive: true });
		return dir;
	})().catch((error) => {
		folder = null;
		throw error;
	});
	return folder;
}

/** Characters no system allows in a file's name */
const clean = (part: string) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'file';

/** Saved in the folder, with " (2)" and so on where a file of that name is there already */
async function save(name: string, data: Uint8Array) {
	const parts = name.split('/').map(clean);
	const file = parts.pop()!;
	let dir = await outputFolder();
	for (const part of parts) dir = await path.join(dir, part);
	if (parts.length) await mkdir(dir, { recursive: true });
	const dot = file.lastIndexOf('.');
	const stem = dot > 0 ? file.slice(0, dot) : file;
	const ext = dot > 0 ? file.slice(dot) : '';
	let target = await path.join(dir, file);
	for (let n = 2; await exists(target); n++) target = await path.join(dir, `${stem} (${n})${ext}`);
	await writeFile(target, data);
	return {
		name: parts.length
			? `${parts.join('/')}/${await path.basename(target)}`
			: await path.basename(target),
		path: target
	};
}

/** Everything converted, together in one ZIP in the folder; its path */
export async function saveAllAsZip() {
	const zip = new JSZip();
	const names = new Set<string>();
	for (const job of get(jobs))
		for (const file of job.saved) {
			let name = file.name;
			for (let n = 2; names.has(name); n++) name = file.name.replace(/(\.[^./]+)?$/, ` (${n})$1`);
			names.add(name);
			zip.file(name, await readFile(file.path));
		}
	if (!names.size) throw new Error('Nothing converted yet');
	const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
	const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
	return (await save(`Converted ${stamp}.zip`, data)).path;
}
