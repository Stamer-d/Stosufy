// Beat effects like in the osu! main menu: the current song's timing points drive two CSS
// variables on <html>, updated every frame:
//   --beat  1 on each beat, falling off to 0 until the next one
//   --kiai  0–1, eases in and out with the kiai sections ("kiai time")
// The effects themselves are plain CSS (app.css), so nothing re-renders at 60 fps.

import { get } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { songQueue, currentSong } from './audio';
import { mapDataStore } from './data';
import { loadTiming } from './mods';
import { userSettings } from './user';
import { heardTime } from './equalizer';
import { parseKiai, parseTimingPoints, type KiaiSection, type TimingPoint } from '../osuFile';

/** How sharply the pulse falls off after a beat; higher is snappier */
const PULSE_SHARPNESS = 3;
/** How fast --kiai follows the kiai sections (per second) */
const KIAI_EASING = 6;

interface Timing {
	timing: TimingPoint[];
	kiai: KiaiSection[];
	/** Where the audio starts within the song; previews start at the preview point */
	offset: number;
}

// Songs that aren't downloaded (previews) keep their timing only for this session
const previewTiming = new Map<string, Timing | null | 'loading'>();

function previewTimingFor(mapId: string): Timing | null {
	const cached = previewTiming.get(mapId);
	if (cached === undefined) {
		previewTiming.set(mapId, 'loading');
		fetch(`https://osu.ppy.sh/osu/${mapId}`)
			.then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
			.then((content) =>
				previewTiming.set(mapId, {
					timing: parseTimingPoints(content),
					kiai: parseKiai(content),
					offset: Number(content.match(/^PreviewTime\s*:\s*(-?\d+)/m)?.[1] ?? 0)
				})
			)
			.catch(() => previewTiming.set(mapId, null));
	}
	return cached && cached !== 'loading' && cached.timing.length ? cached : null;
}

/** Timing of the current song, or null while it's unknown or loading */
function currentTiming(): Timing | null {
	const song = get(currentSong).song;
	const mapId = song?.beatmaps?.[0]?.id?.toString();
	if (!song || !mapId) return null;
	const set = get(mapDataStore)[song.id];
	const map = set?.beatmaps?.[mapId];
	// Downloaded songs always play in full, also from the beatmap search
	if (set) {
		const timing = map?.timing ?? set.timing;
		// Downloaded before kiai sections were saved: load them from the .osu file once
		if (!timing || (map && map.kiai === undefined)) loadTiming(String(song.id), mapId);
		return timing?.length ? { timing, kiai: map?.kiai ?? [], offset: 0 } : null;
	}
	if (!/^\d+$/.test(mapId)) return null;
	return previewTimingFor(mapId);
}

function pointAt(points: TimingPoint[], time: number) {
	let point = points[0];
	for (const candidate of points) {
		if (candidate.time > time) break;
		point = candidate;
	}
	return point;
}

/**
 * Where the current song is against its beat as it's heard now: how far from the nearest
 * beat (ms of the song, negative before it), how long a beat is and whether it's kiai time.
 * Null while nothing plays or the timing is unknown.
 */
export function beatNow(): { offset: number; beatLength: number; kiai: boolean } | null {
	const audio = get(songQueue).audio;
	const timing = audio && !audio.paused ? currentTiming() : null;
	if (!audio || !timing) return null;
	const time = timing.offset + heardTime(audio);
	const point = pointAt(timing.timing, time);
	if (!point || !(point.beatLength > 0)) return null;
	const sinceBeat =
		(((time - point.time) % point.beatLength) + point.beatLength) % point.beatLength;
	return {
		offset: sinceBeat > point.beatLength / 2 ? sinceBeat - point.beatLength : sinceBeat,
		beatLength: point.beatLength,
		kiai: timing.kiai.some((section) => time >= section.start && time < section.end)
	};
}

let started = false;

/** Starts updating --beat and --kiai; call once */
export function startBeatEffects() {
	if (started || typeof window === 'undefined') return;
	started = true;
	const style = document.documentElement.style;
	const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
	let kiai = 0;
	let last = performance.now();
	let written = '';

	const frame = (now: number) => {
		requestAnimationFrame(frame);
		const elapsed = Math.min(0.1, (now - last) / 1000);
		last = now;

		const audio = get(songQueue).audio;
		const enabled =
			(get(userSettings).settings?.appearance?.beatEffects ?? true) && !reducedMotion.matches;
		let pulse = 0;
		let inKiai = false;
		const timing = enabled && audio && !audio.paused ? currentTiming() : null;
		if (timing) {
			const time = timing.offset + audio.currentTime * 1000;
			const point = pointAt(timing.timing, time);
			const sinceBeat =
				(((time - point.time) % point.beatLength) + point.beatLength) % point.beatLength;
			pulse = (1 - sinceBeat / point.beatLength) ** PULSE_SHARPNESS;
			inKiai = timing.kiai.some((section) => time >= section.start && time < section.end);
		}
		kiai += ((inKiai ? 1 : 0) - kiai) * Math.min(1, elapsed * KIAI_EASING);
		if (kiai < 0.001) kiai = 0;

		// Only touch the style when something changed, so an idle app does no work
		const next = `${pulse.toFixed(3)} ${kiai.toFixed(3)}`;
		if (next !== written) {
			written = next;
			style.setProperty('--beat', pulse.toFixed(3));
			style.setProperty('--kiai', kiai.toFixed(3));
		}
	};
	requestAnimationFrame(frame);
}
