// What's done to a song or a video (cut, fades, louder or quieter, even loudness, faster or
// slower, turned, mirrored, without sound) as FFmpeg's filters, and saved in a format: its own
// or another (a video's sound alone too). In ~/Stosufy/Edited.

import { baseName, extensionOf, type Target } from '../files/formats';
import { probe, runFfmpeg } from '../files/ffmpeg';
import { audioArgs, gifArgs, videoArgs } from '../files/presets';
import { saveFile, type SavedFile } from '../files/save';

export const FOLDER = 'Edited';

export interface MediaEdit {
	/** The part kept (s) */
	start: number;
	end: number;
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
	/** Video: turned clockwise (degrees), mirrored, without sound */
	rotate: 0 | 90 | 180 | 270;
	mirror: boolean;
	mute: boolean;
}

export function freshEdit(duration: number): MediaEdit {
	return {
		start: 0,
		end: duration,
		fadeIn: 0,
		fadeOut: 0,
		volume: 0,
		normalize: false,
		speed: 1,
		keepPitch: true,
		rotate: 0,
		mirror: false,
		mute: false
	};
}

/** Whether anything at all is changed */
export function isEdited(edit: MediaEdit, duration: number) {
	const fresh = freshEdit(duration);
	return (Object.keys(fresh) as (keyof MediaEdit)[]).some((key) =>
		key === 'end' ? Math.abs(edit.end - duration) > 0.05 : edit[key] !== fresh[key]
	);
}

/** How long it is when it's saved (s) */
export const lengthOf = (edit: MediaEdit) => Math.max(0, edit.end - edit.start) / edit.speed;

const n = (value: number) => +value.toFixed(3);

/** The sound's filters (`sampleRate`: for a speed that changes the pitch) */
export function audioFilters(edit: MediaEdit, sampleRate: number) {
	const filters: string[] = [];
	if (edit.speed !== 1) {
		if (edit.keepPitch || !sampleRate) filters.push(`atempo=${n(edit.speed)}`);
		else filters.push(`asetrate=${Math.round(sampleRate * edit.speed)}`, `aresample=${sampleRate}`);
	}
	if (edit.volume) filters.push(`volume=${n(edit.volume)}dB`);
	if (edit.normalize) filters.push('loudnorm=I=-14:TP=-1.5:LRA=11');
	const length = lengthOf(edit);
	if (edit.fadeIn) filters.push(`afade=t=in:st=0:d=${n(Math.min(edit.fadeIn, length))}`);
	if (edit.fadeOut)
		filters.push(
			`afade=t=out:st=${n(Math.max(0, length - edit.fadeOut))}:d=${n(Math.min(edit.fadeOut, length))}`
		);
	return filters.join(',');
}

/** The picture's filters */
export function videoFilters(edit: MediaEdit) {
	const filters: string[] = [];
	if (edit.speed !== 1) filters.push(`setpts=PTS/${n(edit.speed)}`);
	if (edit.rotate === 90) filters.push('transpose=1');
	if (edit.rotate === 180) filters.push('hflip,vflip');
	if (edit.rotate === 270) filters.push('transpose=2');
	if (edit.mirror) filters.push('hflip');
	const length = lengthOf(edit);
	if (edit.fadeIn) filters.push(`fade=t=in:st=0:d=${n(Math.min(edit.fadeIn, length))}`);
	if (edit.fadeOut)
		filters.push(
			`fade=t=out:st=${n(Math.max(0, length - edit.fadeOut))}:d=${n(Math.min(edit.fadeOut, length))}`
		);
	return filters.join(',');
}

/** Saves the edited file in `target`'s format; where it is */
export async function saveMedia(
	file: File,
	edit: MediaEdit,
	target: Target,
	isVideo: boolean,
	progress: (share: number) => void,
	id: string
): Promise<SavedFile> {
	const extension = extensionOf(file.name);
	const info = await probe(file, extension);
	const audioOnly = !isVideo || target.group === 'Only the sound';
	const before = ['-ss', String(n(edit.start)), '-t', String(n(edit.end - edit.start))];
	const af = audioFilters(edit, info.sampleRate);
	const options = { before, progress, duration: lengthOf(edit), id };
	const name = `${baseName(file.name)} (edited).${target.extension}`;
	if (audioOnly) {
		const cover = !isVideo && info.cover;
		const sound = (cover: boolean) =>
			runFfmpeg(
				file,
				extension,
				audioArgs(target.id, 'best', { cover, filters: af || undefined }),
				target.extension,
				options
			);
		// (its cover kept where the format holds one; without it, if that doesn't work)
		const made = await sound(cover).catch((error) => {
			if (!cover || error?.name === 'Cancelled') throw error;
			return sound(false);
		});
		return saveFile(FOLDER, name, made);
	}
	const args =
		target.id === 'gif'
			? gifArgs(15, 480, videoFilters(edit) || undefined)
			: videoArgs(target.id, 'best', {
					videoFilters: videoFilters(edit) || undefined,
					audioFilters: af || undefined,
					mute: edit.mute || !info.audio
				});
	return saveFile(FOLDER, name, await runFfmpeg(file, extension, args, target.extension, options));
}
