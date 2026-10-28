// Every song at the same loudness, as the desktop app does (integrated loudness after ITU-R
// BS.1770, brought to -14 LUFS like Spotify's "normal"). The desktop measures a song's file;
// here the song is measured while it plays (audioGraph.ts's meter, every 0.4 s), and once
// known, kept by difficulty for the next time it plays. A song not measured yet starts at the
// loudness most songs have, and glides to its own as it's heard.
//
// Only down: the phone plays at full volume, louder than that would distort.

import { setLevel, measureMoment, normalizeOn } from './audioGraph';

const TARGET_LUFS = -14;
const MIN_GAIN = 0.25;
/** A song not measured yet: most osu! songs are this loud (mastered loud) */
const USUAL_LUFS = -9;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
/** Blocks (0.4 s each) before the song's own loudness is trusted, and before it's kept */
const TRUSTED = 12;
const KEPT = 60;

const KEY = 'stosufy-web-loudness';
const known: Record<string, number> = (() => {
	try {
		return JSON.parse(localStorage.getItem(KEY) || '{}');
	} catch {
		return {};
	}
})();

function keep(key: string, lufs: number) {
	delete known[key];
	known[key] = Math.round(lufs * 10) / 10;
	// (the oldest go: a few thousand songs at most)
	const keys = Object.keys(known);
	for (const old of keys.slice(0, Math.max(0, keys.length - 4000))) delete known[old];
	try {
		localStorage.setItem(KEY, JSON.stringify(known));
	} catch {
		// (measured again next time)
	}
}

/** Volume factor that brings a song of this loudness to the target (only down) */
export const gainFor = (lufs: number) =>
	Math.min(1, Math.max(MIN_GAIN, 10 ** ((TARGET_LUFS - lufs) / 20)));

const loudnessOf = (energy: number) => -0.691 + 10 * Math.log10(energy);

/** BS.1770's integrated loudness of the blocks' energies (null: too few, or silent) */
function integrated(blocks: number[]) {
	const loud = blocks.filter((energy) => loudnessOf(energy) > ABSOLUTE_GATE);
	if (!loud.length) return null;
	const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
	const gate = loudnessOf(mean(loud)) + RELATIVE_GATE;
	const kept = loud.filter((energy) => loudnessOf(energy) > gate);
	return kept.length ? loudnessOf(mean(kept)) : null;
}

let playing: { element: HTMLAudioElement; key: string; blocks: number[]; last: number } | null =
	null;

/** A song starts in this element: its level right away (known, or the usual one) */
export function startLoudness(element: HTMLAudioElement, key: string) {
	finish();
	playing = { element, key, blocks: [], last: 0 };
	setLevel(element, normalizeOn() ? gainFor(known[key] ?? USUAL_LUFS) : 1);
}

/** The song's level when the setting changes */
export function applyNormalize() {
	if (!playing) return;
	const lufs = known[playing.key] ?? integrated(playing.blocks) ?? USUAL_LUFS;
	setLevel(playing.element, normalizeOn() ? gainFor(lufs) : 1, 0.5);
}

/** Listens to the song playing for a moment (call it often: every 0.4 s it measures one) */
export function measure() {
	if (!playing || playing.element.paused) return;
	const now = performance.now();
	if (now - playing.last < 380) return;
	playing.last = now;
	const energy = measureMoment(playing.element);
	if (energy == null) return;
	playing.blocks.push(energy);
	const count = playing.blocks.length;
	// Its own loudness, once it's been heard a while (and now and then again: the song's loud
	// parts may come later); kept for good when it's been heard long enough
	if (count >= TRUSTED && count % 5 === 0) {
		const lufs = integrated(playing.blocks);
		if (lufs == null) return;
		if (count >= KEPT && !(playing.key in known)) keep(playing.key, lufs);
		if (normalizeOn() && !(playing.key in known)) setLevel(playing.element, gainFor(lufs), 3);
	}
}

/** The song stops being the one playing: what was measured of it is kept, if enough */
export function finish() {
	if (!playing) return;
	const { key, blocks } = playing;
	playing = null;
	if (blocks.length >= KEPT) {
		const lufs = integrated(blocks);
		if (lufs != null) keep(key, lufs);
	}
}
