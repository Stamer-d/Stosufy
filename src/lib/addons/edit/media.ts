// What's done to a song or a video (cut, parts taken out, fades, louder or quieter, even
// loudness, faster or slower, turned, mirrored, cut to a part of the picture, without sound)
// as FFmpeg's filters, and saved in a format: its own or another (a video's sound alone too),
// as one file or a file for each part. In ~/Stosufy/Edited.

import { baseName, extensionOf, type Target } from '../files/formats';
import { discard, probe, runFfmpeg, stopIfCancelled, type Made, type Probe } from '../files/ffmpeg';
import {
	LOSSY_AUDIO,
	audioArgs,
	audioKbps,
	gifArgs,
	gifChain,
	scale,
	videoArgs
} from '../files/presets';
import { sizeText } from '../files/size';
import { saveFile, type SavedFile } from '../files/save';

export const FOLDER = 'Edited';

export interface Crop {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface MediaEdit {
	/** The part kept (s) */
	start: number;
	end: number;
	/** Where it's split into parts (s), and the parts taken out (by where they start) */
	cuts: number[];
	dropped: number[];
	/** Each part kept as a file of its own (else they're put together) */
	eachPart: boolean;
	/** Fading in and out (s, 0: none) */
	fadeIn: number;
	fadeOut: number;
	/** Louder or quieter (dB) */
	volume: number;
	/** Even loudness (as streaming services do) */
	normalize: boolean;
	/** 0.5–2 */
	speed: number;
	/** With the speed: the same pitch (else higher when faster, like a record) */
	keepPitch: boolean;
	/** Video: turned clockwise (degrees), mirrored, the part of the picture kept, without sound */
	rotate: 0 | 90 | 180 | 270;
	mirror: boolean;
	crop: Crop;
	mute: boolean;
}

export const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };

export function freshEdit(duration: number): MediaEdit {
	return {
		start: 0,
		end: duration,
		cuts: [],
		dropped: [],
		eachPart: false,
		fadeIn: 0,
		fadeOut: 0,
		volume: 0,
		normalize: false,
		speed: 1,
		keepPitch: true,
		rotate: 0,
		mirror: false,
		crop: { ...WHOLE },
		mute: false
	};
}

/** Whether anything at all is changed */
export function isEdited(edit: MediaEdit, duration: number) {
	const fresh = freshEdit(duration);
	return (Object.keys(fresh) as (keyof MediaEdit)[]).some((key) =>
		key === 'end'
			? Math.abs(edit.end - duration) > 0.05
			: JSON.stringify(edit[key]) !== JSON.stringify(fresh[key])
	);
}

export const isCropped = (crop: Crop) => crop.w < 0.999 || crop.h < 0.999;

export interface Part {
	from: number;
	to: number;
	/** Taken out */
	dropped: boolean;
}

/** The parts between the cuts (all of the file) */
export function partsOf(edit: MediaEdit, duration: number): Part[] {
	const bounds = [0, ...edit.cuts.filter((cut) => cut > 0 && cut < duration), duration];
	return bounds.slice(0, -1).map((from, i) => ({
		from,
		to: bounds[i + 1],
		dropped: edit.dropped.some((start) => Math.abs(start - from) < 1e-6)
	}));
}

/** What's kept: the parts not taken out, within the start and the end (parts next to each
 * other one piece: a split alone changes nothing; each part a file of its own: `split`) */
export function keptOf(edit: MediaEdit, duration: number, split = false) {
	const kept = partsOf(edit, duration)
		.filter((part) => !part.dropped)
		.map((part) => ({ from: Math.max(part.from, edit.start), to: Math.min(part.to, edit.end) }))
		.filter((part) => part.to - part.from > 0.01);
	if (split) return kept;
	const joined: { from: number; to: number }[] = [];
	for (const part of kept) {
		const last = joined.at(-1);
		if (last && Math.abs(part.from - last.to) < 1e-6) last.to = part.to;
		else joined.push({ ...part });
	}
	return joined;
}

/** A cut more at `time` (a part taken out stays so on both sides) */
export function addCut(edit: MediaEdit, time: number, duration: number) {
	if (time <= 0.05 || time >= duration - 0.05) return;
	if (edit.cuts.some((cut) => Math.abs(cut - time) < 0.05)) return;
	const part = partsOf(edit, duration).find((part) => time > part.from && time < part.to);
	edit.cuts = [...edit.cuts, time].sort((a, b) => a - b);
	if (part?.dropped) edit.dropped = [...edit.dropped, time];
}

/** The cut taken away: the parts on both sides one again (as the first of them was) */
export function removeCut(edit: MediaEdit, cut: number) {
	edit.cuts = edit.cuts.filter((other) => other !== cut);
	edit.dropped = edit.dropped.filter((start) => Math.abs(start - cut) > 1e-6);
}

/** A part taken out, or back in */
export function togglePart(edit: MediaEdit, from: number) {
	edit.dropped = edit.dropped.some((start) => Math.abs(start - from) < 1e-6)
		? edit.dropped.filter((start) => Math.abs(start - from) > 1e-6)
		: [...edit.dropped, from];
}

/** How long it is when it's saved (s) */
export function lengthOf(edit: MediaEdit, duration: number) {
	const kept = keptOf(edit, duration).reduce((sum, part) => sum + part.to - part.from, 0);
	return kept / edit.speed;
}

const n = (value: number) => +value.toFixed(3);

/** The sound's filters for a piece `length` long (`sampleRate`: for a speed that changes the pitch) */
export function audioFilters(edit: MediaEdit, sampleRate: number, length: number) {
	const filters: string[] = [];
	if (edit.speed !== 1) {
		if (edit.keepPitch || !sampleRate) filters.push(`atempo=${n(edit.speed)}`);
		else filters.push(`asetrate=${Math.round(sampleRate * edit.speed)}`, `aresample=${sampleRate}`);
	}
	if (edit.volume) filters.push(`volume=${n(edit.volume)}dB`);
	// (loudnorm works at 192 kHz: back to what the sound was)
	if (edit.normalize)
		filters.push('loudnorm=I=-14:TP=-1.5:LRA=11', `aresample=${sampleRate || 48000}`);
	if (edit.fadeIn) filters.push(`afade=t=in:st=0:d=${n(Math.min(edit.fadeIn, length))}`);
	if (edit.fadeOut)
		filters.push(
			`afade=t=out:st=${n(Math.max(0, length - edit.fadeOut))}:d=${n(Math.min(edit.fadeOut, length))}`
		);
	return filters.join(',');
}

/** The picture's filters for a piece `length` long */
export function videoFilters(edit: MediaEdit, length: number) {
	const filters: string[] = [];
	if (edit.speed !== 1) filters.push(`setpts=PTS/${n(edit.speed)}`);
	if (edit.rotate === 90) filters.push('transpose=1');
	if (edit.rotate === 180) filters.push('hflip,vflip');
	if (edit.rotate === 270) filters.push('transpose=2');
	if (edit.mirror) filters.push('hflip');
	// (of the turned picture, in even sizes: what the video codecs need)
	if (isCropped(edit.crop)) {
		const { x, y, w, h } = edit.crop;
		filters.push(
			`crop=trunc(iw*${n(w)}/2)*2:trunc(ih*${n(h)}/2)*2:trunc(iw*${n(x)}):trunc(ih*${n(y)})`
		);
	}
	if (edit.fadeIn) filters.push(`fade=t=in:st=0:d=${n(Math.min(edit.fadeIn, length))}`);
	if (edit.fadeOut)
		filters.push(
			`fade=t=out:st=${n(Math.max(0, length - edit.fadeOut))}:d=${n(Math.min(edit.fadeOut, length))}`
		);
	return filters.join(',');
}

interface Piece {
	from: number;
	to: number;
}

/** Made to fit a size limit: the picture's height, the bitrates, a GIF's frame rate and width */
interface Fit {
	height?: number;
	videoKbps?: number;
	audioKbps?: number;
	gif?: { fps: number; width: number };
}

/** FFmpeg's arguments for some pieces of the file, put together, in `target`'s format */
function argsFor(
	pieces: Piece[],
	edit: MediaEdit,
	target: Target,
	info: Probe,
	audioOnly: boolean,
	cover: boolean,
	fit: Fit = {}
): { args: string[]; before: string[]; inputs?: string[][] } {
	const length = pieces.reduce((sum, piece) => sum + piece.to - piece.from, 0) / edit.speed;
	const af = audioFilters(edit, info.sampleRate, length);
	const vf = videoFilters(edit, length);
	// (a GIF has no sound)
	const sound = audioOnly || (info.audio && !edit.mute && target.id !== 'gif');
	const { fps, width } = fit.gif ?? { fps: 15, width: 480 };
	const video = {
		mute: !sound,
		height: fit.height,
		videoKbps: fit.videoKbps,
		audioKbps: fit.audioKbps
	};

	// One piece: read from its start for its length (fast), the filters on it
	if (pieces.length === 1) {
		const [{ from, to }] = pieces;
		const before = ['-ss', String(n(from)), '-t', String(n(to - from))];
		if (audioOnly)
			return {
				before,
				args: audioArgs(target.id, 'best', {
					cover,
					filters: af || undefined,
					kbps: fit.audioKbps
				})
			};
		if (target.id === 'gif') return { before, args: gifArgs(fps, width, vf || undefined) };
		return {
			before,
			args: videoArgs(target.id, 'best', {
				...video,
				videoFilters: vf || undefined,
				audioFilters: af || undefined
			})
		};
	}

	// Several: each read from where it starts (the file once for each: fast, not all of it
	// decoded), put together, the filters after that
	const chains: string[] = [];
	const inputs: string[] = [];
	pieces.forEach((_, i) => {
		if (!audioOnly) chains.push(`[${i}:v:0]setpts=PTS-STARTPTS[v${i}]`);
		if (sound) chains.push(`[${i}:a:0]asetpts=PTS-STARTPTS[a${i}]`);
		inputs.push(`${audioOnly ? '' : `[v${i}]`}${sound ? `[a${i}]` : ''}`);
	});
	const reads = pieces.map(({ from, to }) => ['-ss', String(n(from)), '-t', String(n(to - from))]);
	const v = audioOnly ? 0 : 1;
	const a = sound ? 1 : 0;
	const outs = `${v ? '[vc]' : ''}${a ? '[ac]' : ''}`;
	chains.push(`${inputs.join('')}concat=n=${pieces.length}:v=${v}:a=${a}${outs}`);
	if (a) chains.push(`[ac]${af || 'anull'}[a]`);
	if (audioOnly) {
		return {
			before: [],
			inputs: reads,
			args: audioArgs(target.id, 'best', {
				cover,
				kbps: fit.audioKbps,
				graph: { filter: chains.join(';'), audio: '[a]' }
			})
		};
	}
	const picture = target.id === 'gif' ? gifChain(fps, width) : scale(fit.height ?? 0);
	chains.push(`[vc]${[vf, picture].filter(Boolean).join(',')}[v]`);
	const filter = chains.join(';');
	if (target.id === 'gif')
		return {
			before: [],
			inputs: reads,
			args: ['-filter_complex', filter, '-map', '[v]', '-an', '-loop', '0']
		};
	return {
		before: [],
		inputs: reads,
		args: videoArgs(target.id, 'best', {
			...video,
			graph: { filter, video: '[v]', audio: a ? '[a]' : undefined },
			mute: !a
		})
	};
}

const sizeOf = (made: Made) => ('data' in made ? made.data.length : made.size);

export interface SavedMedia {
	saved: SavedFile[];
	/** Something to know about it (it couldn't be made small enough, …) */
	note?: string;
}

/**
 * Saves the edited file in `target`'s format (a file for each part, if so); where they are.
 * With `maxBytes`: each file under it (bitrates from how long it is, never more than the file
 * has; tried again smaller when it's still too big).
 */
export async function saveMedia(
	file: File,
	edit: MediaEdit,
	duration: number,
	target: Target,
	isVideo: boolean,
	progress: (share: number) => void,
	id: string,
	maxBytes = 0
): Promise<SavedMedia> {
	const extension = extensionOf(file.name);
	const info = await probe(file, extension, id);
	const audioOnly = !isVideo || target.group === 'Only the sound';
	const kept = keptOf(edit, duration, edit.eachPart);
	if (!kept.length) throw new Error('Nothing is kept: every part is taken out');
	const files = edit.eachPart && kept.length > 1 ? kept.map((piece) => [piece]) : [kept];
	const total = files.reduce(
		(sum, pieces) => sum + pieces.reduce((s, piece) => s + piece.to - piece.from, 0),
		0
	);
	// (the file's own bitrate: more would only make it bigger)
	const own = info.duration ? (file.size * 8) / 1000 / info.duration : Infinity;
	const sound = audioOnly || (info.audio && !edit.mute && target.id !== 'gif');
	const saved: SavedFile[] = [];
	let note: string | undefined;
	let done = 0;
	for (const [i, pieces] of files.entries()) {
		const span = pieces.reduce((sum, piece) => sum + piece.to - piece.from, 0);
		const length = span / edit.speed;
		const name =
			files.length > 1
				? `${baseName(file.name)} (part ${i + 1}).${target.extension}`
				: `${baseName(file.name)} (edited).${target.extension}`;
		const run = (fit: Fit, cover: boolean) => {
			const { args, before, inputs } = argsFor(pieces, edit, target, info, audioOnly, cover, fit);
			return runFfmpeg(file, extension, args, target.extension, {
				before,
				inputs,
				progress: (share) => progress((done + share * span) / total),
				duration: length,
				id
			});
		};
		// (a song's cover kept where the format holds one; without it, if that doesn't work)
		const cover = audioOnly && !isVideo && info.cover;
		const make = (fit: Fit) =>
			run(fit, cover).catch((error) => {
				if (!cover || error?.name === 'Cancelled') throw error;
				return run(fit, false);
			});

		let made: Made;
		if (!maxBytes || !length) made = await make({});
		else if (audioOnly) {
			// The bitrate that fits (a little under it: the container and the cover take some)
			const fits = Math.floor(Math.min(((maxBytes * 8) / 1000 / length) * 0.93, own));
			const lossy = LOSSY_AUDIO.has(target.id);
			made = await make(
				lossy && fits < audioKbps(target.id, 'best') ? { audioKbps: Math.max(24, fits) } : {}
			);
			if (sizeOf(made) > maxBytes)
				note = lossy
					? `Couldn't get it under ${sizeText(maxBytes)}`
					: `${target.label} can't be made smaller: MP3 can`;
		} else if (target.id === 'gif') {
			let gif = { fps: 15, width: 480 };
			made = await make({ gif });
			for (let attempt = 0; attempt < 4 && sizeOf(made) > maxBytes; attempt++) {
				const shrink = Math.sqrt(maxBytes / sizeOf(made));
				gif = {
					width: Math.max(120, Math.round(gif.width * Math.min(0.85, shrink))),
					fps: Math.max(6, Math.round(gif.fps * Math.min(0.9, shrink + 0.2)))
				};
				await discard(made);
				stopIfCancelled(id);
				made = await make({ gif });
			}
			if (sizeOf(made) > maxBytes) note = `Couldn't get it under ${sizeText(maxBytes)}`;
		} else {
			// The bitrate that fits: the sound's share first, fewer lines where there are few bits
			const all = Math.min(((maxBytes * 8) / 1000 / length) * 0.92, own);
			const audio = sound ? Math.min(128, Math.max(48, Math.round(all * 0.12))) : 0;
			let videoKbps = Math.max(60, all - audio);
			made = null as unknown as Made;
			for (let attempt = 0; attempt < 3; attempt++) {
				// (as high as it is when there are bits enough)
				const height =
					videoKbps < 350
						? 360
						: videoKbps < 800
							? 480
							: videoKbps < 1800
								? 720
								: videoKbps < 5000
									? 1080
									: 0;
				if (made) await discard(made);
				stopIfCancelled(id);
				made = await make({ height, videoKbps, audioKbps: audio || undefined });
				if (sizeOf(made) <= maxBytes) break;
				videoKbps = Math.max(40, videoKbps * (maxBytes / sizeOf(made)) * 0.9);
			}
			if (sizeOf(made) > maxBytes) note = `Couldn't get it under ${sizeText(maxBytes)}`;
		}
		saved.push(await saveFile(FOLDER, name, made));
		done += span;
	}
	return { saved, note };
}

/** The video's picture at `time`, as a PNG (turned, mirrored and cut as in the edit) */
export async function saveFrame(file: File, edit: MediaEdit, time: number): Promise<SavedFile> {
	const picture = videoFilters({ ...edit, speed: 1, fadeIn: 0, fadeOut: 0 }, 1);
	const made = await runFfmpeg(
		file,
		extensionOf(file.name),
		['-map', '0:v:0', '-frames:v', '1', ...(picture ? ['-vf', picture] : [])],
		'png',
		{ before: ['-ss', String(n(time))] }
	);
	const at = `${Math.floor(time / 60)}-${(time % 60).toFixed(1).padStart(4, '0')}`;
	return saveFile(FOLDER, `${baseName(file.name)} (frame ${at}).png`, made);
}
