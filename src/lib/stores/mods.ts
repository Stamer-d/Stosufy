// Speed mods like in osu!: Double Time / Nightcore play 1.5× as fast, Half Time / Daycore
// 0.75×. DT and HT keep the pitch, NC and DC change it with the speed. Nightcore also adds
// its drum beat, timed to the beatmap's timing points like osu!lazer's NightcoreBeatContainer.

import { get } from 'svelte/store';
import { fetch } from '@tauri-apps/plugin-http';
import { mapDataStore, saveMapData } from './data';
import { userSettings } from './user';
import { parseKiai, parseTimingPoints, type TimingPoint } from '../osuFile';
import type { PlaybackMod } from '../types';

export const MODS: Record<
	PlaybackMod,
	{ name: string; description: string; rate: number; preservesPitch: boolean }
> = {
	NM: { name: 'No Mod', description: '', rate: 1, preservesPitch: true },
	HT: { name: 'Half Time', description: 'Less zoom...', rate: 0.75, preservesPitch: true },
	DC: { name: 'Daycore', description: 'Whoaaaaa...', rate: 0.75, preservesPitch: false },
	DT: { name: 'Double Time', description: 'Zoooooooooom...', rate: 1.5, preservesPitch: true },
	NC: { name: 'Nightcore', description: 'Uguuuuuuuu...', rate: 1.5, preservesPitch: false }
};

export function currentMod(): PlaybackMod {
	return get(userSettings).settings?.mod ?? 'NM';
}

/** Sets the speed and pitch of the selected mod on a song's audio */
export function applyMod(audio: HTMLAudioElement, mod = currentMod()) {
	const { rate, preservesPitch } = MODS[mod];
	audio.preservesPitch = preservesPitch;
	// (Older WebKit, macOS and Linux, only knows its own name for it)
	(audio as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
		preservesPitch;
	audio.defaultPlaybackRate = rate;
	audio.playbackRate = rate;
}

// --- Nightcore beat -------------------------------------------------------------------

/** Beats are scheduled this far ahead (in real time), so timers can't make them late */
const LOOKAHEAD_MS = 150;
const TICK_MS = 25;
/** Half beats: the beat runs in eighth notes */
const DIVISOR = 2;
const BARS_PER_SEGMENT = 4;
const BEAT_VOLUME = 0.9;

let context: AudioContext | null = null;
let output: GainNode | null = null;
let noise: AudioBuffer | null = null;

/** Creates the audio context; call it from a click, browsers only allow sound after one */
export function prepareBeats() {
	if (!context) {
		context = new AudioContext();
		output = context.createGain();
		output.connect(context.destination);
		noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
		const data = noise.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}
	if (context.state === 'suspended') context.resume();
}

function noiseHit(
	when: number,
	filter: BiquadFilterType,
	frequency: number,
	decay: number,
	level: number
) {
	const source = context.createBufferSource();
	source.buffer = noise;
	const band = context.createBiquadFilter();
	band.type = filter;
	band.frequency.value = frequency;
	const envelope = context.createGain();
	envelope.gain.setValueAtTime(level, when);
	envelope.gain.exponentialRampToValueAtTime(0.001, when + decay);
	source.connect(band).connect(envelope).connect(output);
	source.start(when);
	source.stop(when + decay);
}

const DRUMS = {
	kick(when: number) {
		const oscillator = context.createOscillator();
		oscillator.frequency.setValueAtTime(150, when);
		oscillator.frequency.exponentialRampToValueAtTime(45, when + 0.12);
		const envelope = context.createGain();
		envelope.gain.setValueAtTime(1, when);
		envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
		oscillator.connect(envelope).connect(output);
		oscillator.start(when);
		oscillator.stop(when + 0.3);
	},
	clap(when: number) {
		// A few quick bursts and a short tail, like hands clapping together
		[0, 0.01, 0.02].forEach((delay) => noiseHit(when + delay, 'bandpass', 1500, 0.03, 0.7));
		noiseHit(when + 0.03, 'bandpass', 1200, 0.15, 0.5);
	},
	hat(when: number) {
		noiseHit(when, 'highpass', 7000, 0.05, 0.35);
	},
	finish(when: number) {
		noiseHit(when, 'highpass', 4000, 1.4, 0.45);
	}
};

/** The next half beat after `time` (ms): its time, index within its timing point and point */
function nextBeat(points: TimingPoint[], time: number) {
	let index = 0;
	while (index + 1 < points.length && points[index + 1].time <= time) index++;
	const point = points[index];
	const length = point.beatLength / DIVISOR;
	const beat = Math.floor((time - point.time) / length + 1e-6) + 1;
	const beatTime = point.time + beat * length;
	const next = points[index + 1];
	// A new timing point starts counting from 0 again
	if (next && beatTime >= next.time) return { time: next.time, index: 0, point: next };
	return { time: beatTime, index: beat, point };
}

let firstBeat: number | null = null;
let scheduledUntil: number | null = null;
let lastAudio: HTMLAudioElement | null = null;
let lastTime = 0;

/** What osu!lazer plays on a half beat (index relative to its timing point) */
function playBeat(index: number, point: TimingPoint, when: number) {
	const segmentLength = point.meter * DIVISOR * BARS_PER_SEGMENT;
	// Start on the next segment, so the beat lines up with the song's phrases
	if (firstBeat === null || index < firstBeat) {
		firstBeat = index < 0 ? 0 : (Math.trunc(index / segmentLength) + 1) * segmentLength;
	}
	if (index < firstBeat) return;
	const beat = index % segmentLength;
	if (beat === 0) DRUMS.finish(when);
	if (point.meter === 3) {
		if (beat % 6 === 0) DRUMS.kick(when);
		else if (beat % 6 === 3) DRUMS.clap(when);
		else DRUMS.hat(when);
	} else if (point.meter === 4) {
		if (beat % 4 === 0) DRUMS.kick(when);
		else if (beat % 4 === 2) DRUMS.clap(when);
		else DRUMS.hat(when);
	}
}

const loadingTiming = new Set<string>();

/**
 * Songs downloaded before timing points (and kiai sections) were saved: get them from the
 * .osu file online, once per difficulty
 */
export async function loadTiming(setId: string, mapId: string | null) {
	const set = get(mapDataStore)[setId];
	const beatmapId =
		mapId && /^\d+$/.test(mapId)
			? mapId
			: Object.keys(set?.beatmaps ?? {}).find((id) => /^\d+$/.test(id));
	if (!beatmapId || loadingTiming.has(beatmapId)) return;
	loadingTiming.add(beatmapId);
	try {
		const response = await fetch(`https://osu.ppy.sh/osu/${beatmapId}`);
		if (!response.ok) return;
		const content = await response.text();
		const timing = parseTimingPoints(content);
		const kiai = parseKiai(content);
		mapDataStore.update((data) => {
			const stored = data[setId];
			if (!stored) return data;
			const map = stored.beatmaps?.[beatmapId];
			// Per difficulty: the songs of a set can have different timing
			const beatmaps = map
				? { ...stored.beatmaps, [beatmapId]: { ...map, timing, kiai } }
				: stored.beatmaps;
			return { ...data, [setId]: { ...stored, beatmaps, timing: stored.timing ?? timing } };
		});
		await saveMapData();
	} catch (error) {
		console.warn('Could not load the timing points of', setId, error);
	}
}

/** Schedules the Nightcore beat for whatever `current` returns, while NC is on */
export function startBeats(
	current: () => { audio: HTMLAudioElement | null; setId: string | null; mapId: string | null }
) {
	setInterval(() => {
		const { audio, setId, mapId } = current();
		const stored = setId ? get(mapDataStore)[setId] : null;
		const timing = (mapId && stored?.beatmaps?.[mapId]?.timing) || stored?.timing;
		// The beat can be turned off (Nightcore stays faster and higher)
		const beatOn = get(userSettings).settings?.nightcoreBeat ?? true;
		const playing = beatOn && currentMod() === 'NC' && audio && !audio.paused && context;
		if (playing && setId && !timing) loadTiming(setId, mapId);
		if (!playing || !timing?.length) {
			// Like osu!lazer: after a pause the beat waits for the next segment again
			firstBeat = null;
			scheduledUntil = null;
			return;
		}
		if (context.state === 'suspended') context.resume();
		output.gain.value = BEAT_VOLUME * (get(userSettings).settings?.volume || 0.05);

		const now = audio.currentTime * 1000;
		const rate = audio.playbackRate;
		if (audio !== lastAudio) firstBeat = null;
		// New song, or a seek: continue from the current position
		if (
			audio !== lastAudio ||
			scheduledUntil === null ||
			now < lastTime - 50 ||
			now > scheduledUntil + 500
		) {
			scheduledUntil = now;
		}
		lastAudio = audio;
		lastTime = now;

		const until = now + LOOKAHEAD_MS * rate;
		for (
			let beat = nextBeat(timing, scheduledUntil);
			beat.time <= until;
			beat = nextBeat(timing, beat.time)
		) {
			const when = context.currentTime + (beat.time - now) / 1000 / rate;
			if (when >= context.currentTime - 0.02)
				playBeat(beat.index, beat.point, Math.max(when, context.currentTime));
		}
		scheduledUntil = until;
	}, TICK_MS);
}
