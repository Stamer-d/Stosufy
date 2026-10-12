// The DJ mode's sound: two decks playing songs from the disk through a mixer (gain, three
// band EQ with kills, a filter, echo and reverb, channel faders, a crossfader, a limiter).
// Beatmaps bring an exact beat grid, so tempo sync, beat-aligned loops, cues and mixes that
// start on the bar work like in DJ software. Mixes are automated over a number of bars.

import { get, writable } from 'svelte/store';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { mapDataStore } from '../stores/data';
import { songQueue, currentSong, upNext, setSongQueue } from '../stores/audio';
import { gainOf } from '../stores/mixer';
import { sameSong } from '../tracks';
import { userSettings } from '../stores/user';
import { gainFor, loudnessOf } from '../stores/loudness';
import { beatmapContent } from '../hitsounds/player';
import { parseKiai, parseTimingPoints } from '../osuFile';
import {
	beatFloor,
	beatRound,
	bpmOf,
	gridFrom,
	mainSection,
	nextDownbeat,
	phaseAt,
	sectionAt,
	type Grid
} from './grid';
import { computePeaks, type Peaks } from './peaks';
import {
	analyzeSong,
	keyFit,
	phraseCeil,
	phraseFloor,
	phraseRound,
	kickIn,
	levelBetween,
	PHRASE_BARS,
	type SongAnalysis
} from './analysis';
import type { MapSet } from '../types';

export type DeckId = 'A' | 'B';

/** The master level the DJ mode starts with */
const DEFAULT_MASTER = 0.85;

export const EQ_MIN = -26;
export const EQ_MAX = 6;
const KILL_DB = -60;
export const HOT_CUES = 8;
export const TEMPO_RANGES = [0.08, 0.16, 0.5];

export type TransitionType =
	| 'smart'
	| 'blend'
	| 'crossfade'
	| 'bassswap'
	| 'dropswap'
	| 'loopout'
	| 'filter'
	| 'echo'
	| 'brake'
	| 'wash'
	| 'cut';
export const TRANSITIONS: { id: TransitionType; name: string; description: string }[] = [
	{
		id: 'smart',
		name: 'Smart',
		description:
			'Mixes like a pro DJ: at the end of the playing song, on its phrases, with the style that fits the two songs (tempo, key, intro and outro)'
	},
	{
		id: 'bassswap',
		name: 'Bass swap',
		description: 'Both play, the basslines swap on the middle bar'
	},
	{
		id: 'blend',
		name: 'Pro blend',
		description:
			"The new song's intro under the old one's outro, the bass swapping on the new song's drop"
	},
	{
		id: 'dropswap',
		name: 'Drop swap',
		description:
			'The new one builds up under the old one, which stutters out; the swap hits on the drop'
	},
	{
		id: 'loopout',
		name: 'Loop out',
		description:
			'The old one loops and the loop gets shorter and shorter while the new one comes in'
	},
	{ id: 'crossfade', name: 'Crossfade', description: 'A smooth fade from one to the other' },
	{
		id: 'filter',
		name: 'Filter sweep',
		description: 'The old one thins out, the new one opens up'
	},
	{ id: 'echo', name: 'Echo out', description: 'The old one echoes away, the new one takes over' },
	{
		id: 'brake',
		name: 'Brake',
		description: 'The old one stops like a record being halted as the new one takes over'
	},
	{
		id: 'wash',
		name: 'Wash out',
		description: 'The old one washes away in reverb and echo, the new one comes in on the one'
	},
	{ id: 'cut', name: 'Cut', description: 'A hard switch on the bar' }
];

export interface DeckState {
	song: MapSet | null;
	loading: boolean;
	error: string;
	duration: number;
	/** The song's own main tempo */
	baseBpm: number;
	/** -range … +range */
	tempo: number;
	tempoRange: number;
	playing: boolean;
	cue: number;
	hotCues: (number | null)[];
	loop: { start: number; end: number; beats: number } | null;
	/** Trim in dB (on top of the loudness normalization) */
	gain: number;
	eq: { low: number; mid: number; high: number };
	kill: { low: boolean; mid: boolean; high: boolean };
	/** -1 (low-pass) … 0 (off) … 1 (high-pass) */
	filter: number;
	/** Channel fader 0–1 */
	volume: number;
	echo: number;
	reverb: number;
	/** Following the other deck's tempo */
	synced: boolean;
	kiai: { start: number; end: number }[];
	/** The song's key (Camelot, like 8A), once analysed */
	key: string | null;
}

const freshState = (): DeckState => ({
	song: null,
	loading: false,
	error: '',
	duration: 0,
	baseBpm: 0,
	tempo: 0,
	tempoRange: 0.08,
	playing: false,
	cue: 0,
	hotCues: Array(HOT_CUES).fill(null),
	loop: null,
	gain: 0,
	eq: { low: 0, mid: 0, high: 0 },
	kill: { low: false, mid: false, high: false },
	filter: 0,
	volume: 1,
	echo: 0,
	reverb: 0,
	synced: false,
	kiai: [],
	key: null
});

/** Songs analysed before, by their audio file */
const analysed = new Map<string, SongAnalysis>();

const dbToGain = (db: number) => 10 ** (db / 20);

/** A song's file: through the asset protocol (fast), else read through the fs plugin */
async function readAudio(path: string): Promise<ArrayBuffer> {
	try {
		const response = await fetch(convertFileSrc(path));
		if (response.ok) return await response.arrayBuffer();
	} catch {
		// Not on every platform: read it instead
	}
	const data = await readFile(path);
	return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

let context: AudioContext | null = null;
function audioContext() {
	context ??= new AudioContext({ latencyHint: 'interactive' });
	if (context.state === 'suspended') context.resume();
	return context;
}

/** A reverb's sound: decaying noise */
function impulse(ctx: AudioContext, seconds = 2.4) {
	const length = Math.floor(ctx.sampleRate * seconds);
	const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let c = 0; c < 2; c++) {
		const data = buffer.getChannelData(c);
		for (let i = 0; i < length; i++)
			data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
	}
	return buffer;
}

/** Loudness (LUFS) of songs measured here, by their audio file */
const measured = new Map<string, number>();

export class Deck {
	readonly id: DeckId;
	state: DeckState = freshState();
	buffer: AudioBuffer | null = null;
	grid: Grid = [];
	peaks: Peaks | null = null;
	/** Loudness normalization */
	/** The loudness normalization's factor for this song */
	normalize = 1;
	/** The song's structure and key (see analysis.ts), once worked out */
	analysis: SongAnalysis | null = null;

	private ctx: AudioContext;
	private input: GainNode;
	private low: BiquadFilterNode;
	private mid: BiquadFilterNode;
	private high: BiquadFilterNode;
	private lowpass: BiquadFilterNode;
	private highpass: BiquadFilterNode;
	private dry: GainNode;
	private echoDelay: DelayNode;
	private echoFeedback: GainNode;
	private echoWet: GainNode;
	private reverbWet: GainNode;
	private fader: GainNode;
	/** The crossfader's part */
	readonly xfade: GainNode;
	readonly analyser: AnalyserNode;

	private source: AudioBufferSourceNode | null = null;
	private anchorCtx = 0;
	private anchorPos = 0;
	private pausedAt = 0;
	/** Temporary tempo push (nudge, jog) */
	private bend = 0;
	private loadId = 0;
	/** Loaded by the user (not Auto DJ): Auto DJ plays it next instead of its own pick */
	pickedByUser = false;
	private onChange: () => void;
	onPlay: () => void = () => {};
	beforePlay: (deck: Deck) => void = () => {};

	constructor(
		id: DeckId,
		ctx: AudioContext,
		output: AudioNode,
		reverb: AudioBuffer,
		onChange: () => void
	) {
		this.id = id;
		this.ctx = ctx;
		this.onChange = onChange;
		const gain = () => ctx.createGain();
		const filter = (type: BiquadFilterType, frequency: number) => {
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = frequency;
			return f;
		};
		this.input = gain();
		this.low = filter('lowshelf', 220);
		this.mid = filter('peaking', 1000);
		this.mid.Q.value = 0.8;
		this.high = filter('highshelf', 3500);
		this.lowpass = filter('lowpass', 22000);
		this.highpass = filter('highpass', 10);
		this.lowpass.Q.value = this.highpass.Q.value = 0.9;
		this.dry = gain();
		this.echoDelay = ctx.createDelay(4);
		this.echoFeedback = gain();
		this.echoWet = gain();
		this.echoWet.gain.value = 0;
		const convolver = ctx.createConvolver();
		convolver.buffer = reverb;
		this.reverbWet = gain();
		this.reverbWet.gain.value = 0;
		const post = gain();
		this.fader = gain();
		this.xfade = gain();
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 1024;

		this.input.connect(this.low).connect(this.mid).connect(this.high);
		this.high.connect(this.lowpass).connect(this.highpass);
		this.highpass.connect(this.dry).connect(post);
		this.highpass.connect(this.echoDelay);
		this.echoDelay.connect(this.echoFeedback).connect(this.echoDelay);
		this.echoDelay.connect(this.echoWet).connect(post);
		this.highpass.connect(convolver).connect(this.reverbWet).connect(post);
		post.connect(this.fader).connect(this.xfade).connect(output);
		this.fader.connect(this.analyser);
		this.apply();
	}

	private emit() {
		this.onChange();
	}

	// --- Loading ---------------------------------------------------------------------------

	async load(song: MapSet) {
		const id = ++this.loadId;
		this.stopSource();
		const keep = { volume: this.state.volume, tempoRange: this.state.tempoRange };
		this.state = { ...freshState(), ...keep, song, loading: true };
		this.buffer = null;
		this.peaks = null;
		this.analysis = null;
		this.grid = [];
		this.pausedAt = 0;
		this.apply();
		this.emit();
		try {
			const stored = get(mapDataStore)[song.id];
			const mapId = String(song.beatmaps?.[0]?.id ?? '');
			const map = stored?.beatmaps?.[mapId]?.audioFile
				? stored.beatmaps[mapId]
				: Object.values(stored?.beatmaps ?? {}).find((m) => m.audioFile);
			if (!map?.audioFile) throw new Error('Download the song to mix it');
			const buffer = await this.ctx.decodeAudioData(await readAudio(map.audioFile));
			if (id !== this.loadId) return;
			let timing = map.timing;
			let kiai = map.kiai;
			if (!timing?.length || !kiai) {
				const content = await beatmapContent(song, String(map.id)).catch(() => null);
				if (content) {
					timing = timing?.length ? timing : parseTimingPoints(content);
					kiai ??= parseKiai(content);
				}
			}
			if (id !== this.loadId) return;
			this.buffer = buffer;
			this.grid = gridFrom(timing);
			// Every song about as loud as the others (like auto gain), measured now if it
			// wasn't yet (a fraction of a second)
			let lufs = map.loudness ?? measured.get(map.audioFile) ?? null;
			if (lufs == null) {
				lufs = await loudnessOf(buffer).catch(() => null);
				if (lufs != null) {
					measured.set(map.audioFile, lufs);
					// Kept with the song: the player then plays it just as loud
					const set = get(mapDataStore)[song.id];
					for (const m of Object.values(set?.beatmaps ?? {}))
						if (m.audioFile === map.audioFile) m.loudness = lufs;
				}
				if (id !== this.loadId) return;
			}
			// Like the player: only with the loudness normalization on (it's a setting)
			const normalizing = get(userSettings).settings?.normalize ?? true;
			this.normalize = normalizing && lufs != null ? gainFor(lufs) : 1;
			const main = mainSection(this.grid, buffer.duration);
			// The cue starts on the first beat (most songs start with a little silence)
			const first = this.grid[0];
			let cue = 0;
			if (first) {
				const bar = first.beat * first.meter;
				cue = first.time;
				while (cue < 0) cue += bar;
			}
			this.pausedAt = cue;
			this.state = {
				...this.state,
				loading: false,
				duration: buffer.duration,
				baseBpm: bpmOf(main),
				cue,
				kiai: (kiai ?? []).map((k) => ({ start: k.start / 1000, end: k.end / 1000 }))
			};
			this.apply();
			this.emit();
			const peaks = await computePeaks(buffer);
			if (id === this.loadId) {
				this.peaks = peaks;
				this.emit();
			}
			// What a DJ hears in it: energy, intro, peaks, outro, phrases, key
			const analysis =
				analysed.get(map.audioFile) ??
				(await analyzeSong(buffer, this.grid, this.state.kiai, cue).catch((error) => {
					console.warn('Could not analyse the song', error);
					return null;
				}));
			if (analysis) analysed.set(map.audioFile, analysis);
			if (id === this.loadId) {
				this.analysis = analysis;
				this.state = { ...this.state, key: analysis?.key?.camelot ?? null };
				this.emit();
			}
		} catch (error) {
			if (id !== this.loadId) return;
			console.error('Could not load the song for the DJ mode:', error);
			this.state = {
				...this.state,
				loading: false,
				error: error instanceof Error ? error.message : String(error)
			};
			this.emit();
		}
	}

	/** A song the user chose (Auto DJ plays it next) */
	userLoad(song: MapSet) {
		this.pickedByUser = true;
		return this.load(song);
	}

	eject() {
		this.loadId++;
		this.stopSource();
		const keep = { volume: this.state.volume, tempoRange: this.state.tempoRange };
		this.state = { ...freshState(), ...keep };
		this.buffer = null;
		this.peaks = null;
		this.grid = [];
		this.apply();
		this.emit();
	}

	// --- Playing ---------------------------------------------------------------------------

	get rate() {
		return 1 + this.state.tempo;
	}

	private get playbackRate() {
		return this.rate * (1 + this.bend + this.autoBend);
	}

	/** Where the song is (s); while a loop runs, inside the loop */
	position() {
		if (!this.state.playing) return this.pausedAt;
		let pos = this.anchorPos + (this.ctx.currentTime - this.anchorCtx) * this.playbackRate;
		const loop = this.state.loop;
		if (loop && pos > loop.end && loop.end > loop.start) {
			pos = loop.start + ((pos - loop.start) % (loop.end - loop.start));
		}
		return Math.min(pos, this.state.duration);
	}

	/** The tempo now (BPM), with the tempo fader */
	bpm(at = this.position()) {
		return bpmOf(sectionAt(this.grid, at)) * this.rate || this.state.baseBpm * this.rate;
	}

	private startSource(offset: number, when = this.ctx.currentTime) {
		if (!this.buffer) return;
		this.stopSource();
		const source = this.ctx.createBufferSource();
		source.buffer = this.buffer;
		source.playbackRate.value = this.playbackRate;
		const loop = this.state.loop;
		if (loop) {
			source.loop = true;
			source.loopStart = loop.start;
			source.loopEnd = loop.end;
		}
		source.connect(this.input);
		// Before the song's start (to line it up with the other deck): wait, then start at 0
		if (offset < 0) source.start(when - offset / this.playbackRate, 0);
		else source.start(when, offset);
		source.onended = () => {
			if (source !== this.source) return;
			this.source = null;
			this.pausedAt = this.state.duration;
			this.state = { ...this.state, playing: false };
			this.emit();
		};
		this.source = source;
		this.anchorCtx = when;
		this.anchorPos = offset;
	}

	private stopSource() {
		const source = this.source;
		this.source = null;
		if (!source) return;
		source.onended = null;
		try {
			source.stop();
		} catch {
			// Not started yet
		}
		source.disconnect();
	}

	/** Plays; with a time of the audio clock, starts exactly then (for mixes on the bar) */
	play(when?: number) {
		if (!this.buffer || this.state.playing) return;
		audioContext();
		if (this.pausedAt >= this.state.duration - 0.05) this.pausedAt = this.state.cue;
		// Started by hand while synced: on the other deck's beat
		if (when === undefined) this.beforePlay(this);
		this.startSource(this.pausedAt, when);
		this.state = { ...this.state, playing: true };
		this.onPlay();
		this.emit();
	}

	pause() {
		if (!this.state.playing) return;
		this.pausedAt = this.position();
		this.stopSource();
		this.state = { ...this.state, playing: false };
		this.emit();
	}

	toggle() {
		if (this.state.playing) this.pause();
		else this.play();
	}

	seek(time: number) {
		const to = Math.max(-30, Math.min(this.state.duration, time));
		if (this.state.playing) this.startSource(to);
		else this.pausedAt = to;
		this.emit();
	}

	/** Jumps a number of beats (negative: back), keeping the beat */
	beatJump(beats: number) {
		const section = sectionAt(this.grid, this.position());
		if (!section) return;
		this.seek(this.position() + beats * section.beat);
	}

	private rebase() {
		if (!this.state.playing) return;
		this.anchorPos = this.position();
		this.anchorCtx = this.ctx.currentTime;
	}

	setTempo(tempo: number, keepSync = false) {
		this.rebase();
		const range = Math.max(this.state.tempoRange, Math.abs(tempo));
		this.state = {
			...this.state,
			tempo,
			tempoRange: TEMPO_RANGES.find((r) => r >= range) ?? 0.5,
			synced: keepSync ? this.state.synced : false
		};
		if (this.source) this.source.playbackRate.value = this.playbackRate;
		this.applyEcho();
		this.emit();
	}

	/** Pushes the tempo for a moment (nudge or jog), to line up beats by ear */
	setBend(bend: number) {
		// Pushing it by hand: the user leads now, not the sync lock
		if (bend !== 0 && this.state.synced) this.unsync();
		this.rebase();
		this.bend = bend;
		if (this.source) this.source.playbackRate.value = this.playbackRate;
	}

	// --- Cues and loops --------------------------------------------------------------------

	private cuePreview = false;

	/** CUE like on a deck: playing → back to the cue; paused → set it (on the beat), or
	 * hold to listen from it */
	cueDown() {
		if (!this.buffer) return;
		if (this.state.playing) {
			this.pause();
			this.seek(this.state.cue);
			return;
		}
		const pos = this.position();
		if (Math.abs(pos - this.state.cue) < 0.02) {
			this.cuePreview = true;
			this.play();
		} else {
			const cue = Math.max(0, beatRound(this.grid, pos));
			this.state = { ...this.state, cue };
			this.seek(cue);
		}
	}

	cueUp() {
		if (!this.cuePreview) return;
		this.cuePreview = false;
		this.pause();
		this.seek(this.state.cue);
	}

	/** A hot cue: jumps to it (keeping the beat), or sets it where the song is */
	hotCue(index: number) {
		if (!this.buffer) return;
		const cue = this.state.hotCues[index];
		if (cue == null) {
			const hotCues = [...this.state.hotCues];
			hotCues[index] = Math.max(0, beatRound(this.grid, this.position()));
			this.state = { ...this.state, hotCues };
			this.emit();
			return;
		}
		if (this.state.playing) {
			// Keep where in the beat it is, so a synced mix stays in sync
			const pos = this.position();
			const intoBeat = pos - beatFloor(this.grid, pos);
			this.seek(cue + intoBeat);
		} else this.seek(cue);
		this.cuePreview = false;
	}

	clearHotCue(index: number) {
		const hotCues = [...this.state.hotCues];
		hotCues[index] = null;
		this.state = { ...this.state, hotCues };
		this.emit();
	}

	/** A loop of some beats from the beat the song is in; again to leave it */
	loop(beats: number) {
		if (!this.buffer) return;
		if (this.state.loop?.beats === beats) {
			this.exitLoop();
			return;
		}
		const pos = this.position();
		const section = sectionAt(this.grid, pos);
		const beat = section?.beat ?? 0.5;
		const start = this.state.loop?.start ?? beatFloor(this.grid, pos);
		const end = start + beats * beat;
		this.setLoopRange(start, end, beats);
	}

	private setLoopRange(start: number, end: number, beats: number) {
		this.rebase();
		this.state = { ...this.state, loop: { start, end, beats } };
		if (this.source) {
			this.source.loop = true;
			this.source.loopStart = Math.max(0, start);
			this.source.loopEnd = end;
		}
		this.emit();
	}

	/** A loop of a number of beats from where the loop starts (or this beat) */
	loopBeats(beats: number) {
		if (!this.buffer) return;
		const pos = this.position();
		const beat = sectionAt(this.grid, pos)?.beat ?? 0.5;
		const start = this.state.loop?.start ?? beatFloor(this.grid, pos);
		this.setLoopRange(start, start + beats * beat, beats);
	}

	halveLoop() {
		const loop = this.state.loop;
		if (loop)
			this.setLoopRange(loop.start, loop.start + (loop.end - loop.start) / 2, loop.beats / 2);
	}

	doubleLoop() {
		const loop = this.state.loop;
		if (loop)
			this.setLoopRange(loop.start, loop.start + (loop.end - loop.start) * 2, loop.beats * 2);
	}

	exitLoop() {
		if (!this.state.loop) return;
		this.rebase();
		this.state = { ...this.state, loop: null };
		if (this.source) this.source.loop = false;
		this.emit();
	}

	// --- Sync ------------------------------------------------------------------------------

	/** The tempo that matches another deck: the same, or double or half for very different
	 * tempos. Null if they're too far apart */
	matchRate(master: Deck) {
		const own = bpmOf(sectionAt(this.grid, this.position())) || this.state.baseBpm;
		const target = master.bpm();
		if (!own || !target) return null;
		// Its own tempo, or half or double of it: whichever is nearest (beats and bars line
		// up with all three, so any two songs can be matched)
		let best: { rate: number; factor: number } | null = null;
		for (const factor of [1, 2, 0.5]) {
			const rate = (target * factor) / own;
			if (!best || Math.abs(Math.log(rate)) < Math.abs(Math.log(best.rate)))
				best = { rate, factor };
		}
		return best && best.rate >= 0.7 && best.rate <= 1.43 ? best : null;
	}

	/** Takes the other deck's tempo and lines up the beats and bars with it */
	sync(master: Deck) {
		const match = this.matchRate(master);
		if (!match) return false;
		this.setTempo(match.rate - 1, true);
		this.state = { ...this.state, synced: true };
		// The other deck leads
		if (master.state.synced) master.state = { ...master.state, synced: false };
		if (this.state.playing && master.state.playing) this.alignTo(master, match.factor === 1);
		else if (master.state.playing) this.alignPaused(master);
		this.emit();
		return true;
	}

	unsync() {
		this.setAutoBend(0);
		this.state = { ...this.state, synced: false };
		this.emit();
	}

	/**
	 * How many of its own beats this deck is off the other one's grid (positive: it's behind).
	 * With the same tempo, bars line up too; at double or half tempo, beats do.
	 */
	phaseOffset(master: Deck, factor = 1, bars = true, at = this.position()) {
		const m = phaseAt(master.grid, master.position());
		const s = phaseAt(this.grid, at);
		if (!m || !s) return 0;
		let shift: number;
		if (bars && factor === 1 && m.point.meter === s.point.meter) {
			const meter = s.point.meter;
			shift = m.barBeats - s.barBeats;
			if (shift > meter / 2) shift -= meter;
			if (shift < -meter / 2) shift += meter;
		} else {
			const masterPhase = (((m.beats * factor) % 1) + 1) % 1;
			shift = masterPhase - s.beatPhase;
			if (shift > 0.5) shift -= 1;
			if (shift < -0.5) shift += 1;
		}
		return shift;
	}

	/** Puts the paused song where it starts on the other deck's beat and bar */
	alignPaused(master: Deck) {
		const match = this.matchRate(master);
		if (!match || this.state.playing) return;
		const shift = this.phaseOffset(master, match.factor, match.factor === 1, this.pausedAt);
		const beat = sectionAt(this.grid, this.pausedAt)?.beat ?? 0.5;
		this.pausedAt += shift * beat;
		this.emit();
	}

	/**
	 * Starts at another level (the player's, when the deck takes its song over) and glides
	 * to its own normalization over a few seconds, so taking over makes no jump
	 */
	startAtLevel(gain: number) {
		const now = this.ctx.currentTime;
		const trim = dbToGain(this.state.gain);
		this.input.gain.cancelScheduledValues(now);
		this.input.gain.setValueAtTime(gain * trim, now);
		this.input.gain.setTargetAtTime(this.normalize * trim, now + 1, 1.2);
	}

	/** Small tempo pushes by the sync lock to stay on the beat */
	private autoBend = 0;

	setAutoBend(bend: number) {
		if (bend === this.autoBend) return;
		this.rebase();
		this.autoBend = bend;
		if (this.source) this.source.playbackRate.value = this.playbackRate;
	}

	get userBending() {
		return this.bend !== 0;
	}

	/** Moves the song so its beats (and bars) fall on the other deck's */
	alignTo(master: Deck, bars = true) {
		const match = this.matchRate(master);
		const s = phaseAt(this.grid, this.position());
		if (!s) return;
		const shift = this.phaseOffset(master, match?.factor ?? 1, bars);
		if (Math.abs(shift) < 0.002) return;
		this.seek(this.position() + shift * s.point.beat);
	}

	// --- Mixer controls --------------------------------------------------------------------

	set(change: Partial<DeckState>) {
		this.state = { ...this.state, ...change };
		this.apply();
		this.emit();
	}

	private applyEcho() {
		const section = sectionAt(this.grid, this.position());
		const beat = (section?.beat ?? 0.5) / this.rate;
		this.echoDelay.delayTime.setTargetAtTime(
			Math.min(3.9, beat * 0.75),
			this.ctx.currentTime,
			0.05
		);
	}

	/** Puts the controls' values on the sound */
	apply() {
		const s = this.state;
		const now = this.ctx.currentTime;
		const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.012);
		smooth(this.input.gain, this.normalize * dbToGain(s.gain));
		smooth(this.low.gain, s.kill.low ? KILL_DB : s.eq.low);
		smooth(this.mid.gain, s.kill.mid ? KILL_DB : s.eq.mid);
		smooth(this.high.gain, s.kill.high ? KILL_DB : s.eq.high);
		// The filter: down from 22 kHz to the left, up from 10 Hz to the right
		const amount = Math.abs(s.filter);
		smooth(this.lowpass.frequency, s.filter < 0 ? 22000 * Math.pow(60 / 22000, amount) : 22000);
		smooth(this.highpass.frequency, s.filter > 0 ? 10 * Math.pow(8000 / 10, amount) : 10);
		// Echo: turned down, it rings out instead of stopping
		this.echoWet.gain.setTargetAtTime(s.echo * 0.9, now, s.echo > 0 ? 0.012 : 0.9);
		this.echoFeedback.gain.setTargetAtTime(
			s.echo > 0 ? 0.35 + s.echo * 0.3 : 0.45,
			now,
			s.echo > 0 ? 0.012 : 0.9
		);
		smooth(this.reverbWet.gain, s.reverb * 0.8);
		// The fader feels like a real one: quiet at the bottom
		smooth(this.fader.gain, s.volume * s.volume);
		this.applyEcho();
	}

	// --- Effects to hold (like performance pads) -----------------------------------------

	private holds: Partial<
		Record<
			'filter' | 'echo' | 'roll',
			{ value: number; timer?: ReturnType<typeof setInterval>; slip?: { pos: number; ctx: number } }
		>
	> = {};

	/** Held: the filter sweeps up over two beats; let go: back */
	filterHold(on: boolean) {
		const hold = this.holds.filter;
		clearInterval(hold?.timer);
		if (!on) {
			if (hold) this.set({ filter: hold.value });
			delete this.holds.filter;
			return;
		}
		const value = hold?.value ?? this.state.filter;
		const started = this.ctx.currentTime;
		const beat = (sectionAt(this.grid, this.position())?.beat ?? 0.5) / this.rate;
		const timer = setInterval(() => {
			const p = Math.min(1, (this.ctx.currentTime - started) / (beat * 2));
			this.set({ filter: 0.15 + 0.6 * p });
		}, 30);
		this.holds.filter = { value, timer };
	}

	/** Held: an echo on the beat; let go: it rings out */
	echoHold(on: boolean) {
		if (on) {
			this.holds.echo ??= { value: this.state.echo };
			this.set({ echo: 0.75 });
		} else {
			this.set({ echo: this.holds.echo?.value ?? 0 });
			delete this.holds.echo;
		}
	}

	/** Held: a loop roll of some beats; let go: the song goes on where it would have been */
	roll(beats: number, on: boolean) {
		if (!this.buffer || !this.state.playing) return;
		if (on) {
			this.holds.roll = {
				value: beats,
				slip: { pos: this.position(), ctx: this.ctx.currentTime }
			};
			if (this.state.loop) this.exitLoop();
			const pos = this.position();
			const beat = sectionAt(this.grid, pos)?.beat ?? 0.5;
			const start = beatFloor(this.grid, pos);
			this.setLoopRange(start, start + beats * beat, beats);
		} else {
			const slip = this.holds.roll?.slip;
			delete this.holds.roll;
			this.exitLoop();
			if (slip) this.seek(slip.pos + (this.ctx.currentTime - slip.ctx) * this.rate);
		}
	}

	/** A record stopping: slows down to a halt */
	brake() {
		if (!this.state.playing) return;
		const started = this.ctx.currentTime;
		const timer = setInterval(() => {
			const p = (this.ctx.currentTime - started) / 1.1;
			if (p >= 1) {
				clearInterval(timer);
				this.pause();
				this.setBend(0);
				return;
			}
			this.setBend(-p * 0.98);
		}, 20);
	}

	/** For echo out: the song itself off, its echo on */
	setDry(gain: number) {
		this.dry.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
	}

	/** The level after the fader (0–1), for the meter */
	level() {
		const data = new Float32Array(this.analyser.fftSize);
		this.analyser.getFloatTimeDomainData(data);
		let peak = 0;
		for (const v of data) peak = Math.max(peak, Math.abs(v));
		return peak;
	}
}

// --- The mixer ------------------------------------------------------------------------

export interface TransitionState {
	from: DeckId;
	to: DeckId;
	type: TransitionType;
	bars: number;
	/** Audio clock times */
	start: number;
	end: number;
	/** One beat (s, real time) */
	beat: number;
	/** Where a stepped effect (shrinking loops, the brake) is */
	stage?: number;
	/** Pro blend: only the new song's drums until the swap (keys that clash) */
	drums?: boolean;
	/** Pro blend: when the basslines swap (part of the mix; 1: at its end, on the drop) */
	swap?: number;
	/** Echo out: the new song comes in on the one after the old one's last beat */
	onOne?: boolean;
	/** Pro blend with filters: the new one opens up (low-pass), the old one thins out */
	filter?: boolean;
	/** Pro blend in three bands: highs, then mids change places, then the bass */
	stages?: boolean;
	/** Pro blend: the new song's level while it comes in (below 1: it's louder than the old
	 * one was; it rides up to its own level after the mix) */
	ride?: number;
}

export interface AutoDjState {
	on: boolean;
	queue: MapSet[];
	/** The song in the queue that plays (or played last) */
	index: number;
	source: string;
}

export interface DjState {
	A: DeckState;
	B: DeckState;
	/** 0 = only A, 1 = only B */
	crossfader: number;
	master: number;
	transition: TransitionState | null;
	transitionType: TransitionType;
	transitionBars: number;
	auto: AutoDjState;
	recording: boolean;
	recordedSeconds: number;
	hype: boolean;
	glide: boolean;
}

export const dj = writable<DjState | null>(null);

class Mixer {
	ctx: AudioContext;
	decks: Record<DeckId, Deck>;
	private master: GainNode;
	private bus!: GainNode;
	private recordGain!: GainNode;
	readonly analyser: AnalyserNode;
	private stream: MediaStreamAudioDestinationNode;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recordStart = 0;
	crossfader = 0.5;
	masterLevel = DEFAULT_MASTER;
	transition: TransitionState | null = null;
	transitionType: TransitionType = 'smart';
	transitionBars = 16;
	auto: AutoDjState = { on: false, queue: [], index: -1, source: '' };
	private timer: ReturnType<typeof setInterval>;
	/** The styles of the last mixes (newest first): the next one picks another */
	private styleHistory: string[] = [];
	/** Auto DJ's plan for the coming mix, kept once made (see autoPlanFor) */
	private autoPlanned: {
		from: Deck;
		toSong: number;
		plan: NonNullable<ReturnType<Mixer['proPlan']>>;
		at: number;
	} | null = null;
	/** What the decks were like before a mix changed them, to put back after */
	private before: Partial<Record<DeckId, Partial<DeckState>>> = {};

	constructor() {
		const ctx = audioContext();
		this.ctx = ctx;
		const bus = ctx.createGain();
		this.bus = bus;
		this.master = ctx.createGain();
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -1.5;
		limiter.knee.value = 0;
		limiter.ratio.value = 20;
		limiter.attack.value = 0.002;
		limiter.release.value = 0.15;
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 1024;
		this.stream = ctx.createMediaStreamDestination();
		bus.connect(this.master).connect(limiter);
		limiter.connect(ctx.destination);
		// The meter and recordings: the mix itself, not the app's (small) volume
		this.recordGain = ctx.createGain();
		const recordLimiter = ctx.createDynamicsCompressor();
		recordLimiter.threshold.value = -1.5;
		recordLimiter.knee.value = 0;
		recordLimiter.ratio.value = 20;
		recordLimiter.attack.value = 0.002;
		recordLimiter.release.value = 0.15;
		bus.connect(this.recordGain).connect(recordLimiter);
		recordLimiter.connect(this.analyser);
		recordLimiter.connect(this.stream);
		const reverb = impulse(ctx);
		const changed = () => this.emit();
		this.decks = {
			A: new Deck('A', ctx, bus, reverb, changed),
			B: new Deck('B', ctx, bus, reverb, changed)
		};
		for (const deck of Object.values(this.decks)) {
			// The music player and the DJ mode don't play at the same time
			deck.onPlay = () => get(songQueue).audio?.pause();
			deck.beforePlay = (d) => {
				const master = this.other(d.id);
				if (d.state.synced && master.state.playing) d.alignPaused(master);
			};
		}
		this.applyCrossfader();
		this.applyMaster();
		this.timer = setInterval(() => this.tick(), 25);
		userSettings.subscribe(() => this.applyMaster());
	}

	private emitQueued = false;
	emit() {
		if (this.emitQueued) return;
		this.emitQueued = true;
		queueMicrotask(() => {
			this.emitQueued = false;
			dj.set({
				A: this.decks.A.state,
				B: this.decks.B.state,
				crossfader: this.crossfader,
				master: this.masterLevel,
				transition: this.transition,
				transitionType: this.transitionType,
				transitionBars: this.transitionBars,
				auto: this.auto,
				hype: this.hype,
				glide: this.glide,
				recording: !!this.recorder,
				recordedSeconds: this.recorder ? this.ctx.currentTime - this.recordStart : 0
			});
		});
	}

	other(id: DeckId) {
		return this.decks[id === 'A' ? 'B' : 'A'];
	}

	/** A "full" curve: both at full volume in the middle, each fading on its own side */
	private applyCrossfader() {
		const x = this.crossfader;
		const a = x <= 0.5 ? 1 : Math.cos((x - 0.5) * Math.PI);
		const b = x >= 0.5 ? 1 : Math.cos((0.5 - x) * Math.PI);
		const now = this.ctx.currentTime;
		this.decks.A.xfade.gain.setTargetAtTime(a, now, 0.01);
		this.decks.B.xfade.gain.setTargetAtTime(b, now, 0.01);
	}

	setCrossfader(x: number) {
		this.crossfader = Math.max(0, Math.min(1, x));
		this.applyCrossfader();
		this.emit();
	}

	/** The DJ master on top of the app's volume (and its mute) */
	private applyMaster() {
		const settings = get(userSettings).settings;
		const app = settings?.muted ? 0 : (settings?.volume ?? 0.05);
		// The app's volume is small numbers (0.05 is normal): the same loudness as the player
		// The master's default (0.85, room for two songs at once) is as loud as the player
		this.master.gain.setTargetAtTime(
			(this.masterLevel / DEFAULT_MASTER) * app,
			this.ctx.currentTime,
			0.02
		);
		this.recordGain?.gain.setTargetAtTime(this.masterLevel, this.ctx.currentTime, 0.02);
	}

	setMaster(level: number) {
		this.masterLevel = Math.max(0, Math.min(1.5, level));
		this.applyMaster();
		this.emit();
	}

	level() {
		const data = new Float32Array(this.analyser.fftSize);
		this.analyser.getFloatTimeDomainData(data);
		let peak = 0;
		for (const v of data) peak = Math.max(peak, Math.abs(v));
		return peak;
	}

	// --- Mixes -----------------------------------------------------------------------------

	setTransition(type: TransitionType, bars: number) {
		this.transitionType = type;
		this.transitionBars = bars;
		this.emit();
	}

	/** Riser and reverb in mixes */
	hype = true;
	/** After a mix, the new song glides back to its own tempo */
	glide = true;

	setOptions(options: { hype?: boolean; glide?: boolean }) {
		Object.assign(this, options);
		this.emit();
	}

	/** The deck that's heard: the playing one (the louder side if both play) */
	leading(): Deck | null {
		const { A, B } = this.decks;
		if (A.state.playing && !B.state.playing) return A;
		if (B.state.playing && !A.state.playing) return B;
		if (A.state.playing && B.state.playing) return this.crossfader <= 0.5 ? A : B;
		return null;
	}

	/** How well a song fits after another: the tempo change it needs */
	compat(from: Deck, to: Deck) {
		const match = to.matchRate(from);
		if (!match) return { rating: 'clash' as const, change: null, factor: 1 };
		const change = match.rate - 1;
		const size = Math.abs(change);
		const rating = size <= 0.03 ? 'perfect' : size <= 0.07 ? 'good' : 'tricky';
		return { rating: rating as 'perfect' | 'good' | 'tricky', change, factor: match.factor };
	}

	/**
	 * Auto DJ's plan for the coming mix: made once and kept (the countdown and the mix itself
	 * follow the same plan), made again only when the songs change or the playing one is moved
	 */
	private autoPlanFor(from: Deck, to: Deck) {
		const song = Number(to.state.song?.id ?? -1);
		const pos = from.position();
		const kept = this.autoPlanned;
		const bar = from.analysis?.bar ?? 2;
		if (
			kept &&
			kept.from === from &&
			kept.toSong === song &&
			pos >= kept.at - 1 &&
			pos <= kept.plan.startAt + bar * 0.75
		)
			return kept.plan;
		const plan = this.proPlan(from, to, true);
		this.autoPlanned = plan ? { from, toSong: song, plan, at: pos } : null;
		return plan;
	}

	/**
	 * Where Auto DJ leaves a song: from its outro to its end, or, in a long song (most of them
	 * past 3:30, all past 4:30), in a quiet breakdown after one of its drops (once it has
	 * played half of it and some of it is still to come) up to where its next drop starts.
	 * Picked from the song's structure, so it stays put while the song plays.
	 */
	private exitWindow(deck: Deck, a: SongAnalysis, now: number) {
		const outro = { from: a.outroStart, until: a.lastBar, mid: false };
		const length = a.lastBar - a.firstBar;
		const id = Number(deck.state.song?.id ?? 0);
		const pick = Math.imul(id || 1, 2654435761) >>> 0;
		if (length < 210 || (length < 270 && pick % 3 === 0)) return outro;
		// Played a good while: half of it, a minute and a half at least
		const played = a.firstBar + Math.max(90, length * 0.5);
		for (let i = 0; i < a.drops.length - 1; i++) {
			const from = phraseRound(a, a.drops[i].end);
			const until = phraseRound(a, a.drops[i + 1].start);
			if (from < played || a.lastBar - from < 40 || until - from < a.bar * 8) continue;
			// A real breakdown: quieter than the peaks
			const inside = a.bars.filter((b) => b.start >= from - 0.01 && b.start < until - 0.01);
			const level = inside.reduce((sum, b) => sum + b.energy, 0) / Math.max(1, inside.length);
			if (level > a.peakLevel * 0.75) continue;
			// Still time to mix in it
			if (now > until - a.bar * 8) continue;
			return { from, until, mid: true };
		}
		return outro;
	}

	/**
	 * How a pro DJ mixes two songs, from what's in them (see analysis.ts): always an EQ blend,
	 * beatmatched. The new song's intro (up to where it gets going) plays under the old one's
	 * outro, or its last phrase if it has none, both on their phrases; the basslines swap on
	 * the one (never two at once), the old song's mids and highs go in the last phrase, its
	 * last beat goes into its echo and it fades out over the bar after the swap.
	 * - Keys that clash (after the tempo change), or no intro to speak of: only the new song's
	 *   drums until the swap.
	 * - Tempos up to 6 % apart: the new song plays at the old one's tempo; further apart they
	 *   meet in the middle (the old song moves there slowly before the mix). Either way the new
	 *   song glides back to its own tempo after it. Half and double tempo count too.
	 * - An echo out only for a song without a beat, or one that's ending right now.
	 * With Auto DJ it leaves over the playing song's end, or, in a long song, in a quiet
	 * breakdown after one of its drops, so the new song's drop comes where the old one's next
	 * drop would have (see exitWindow); mixed by hand, from the next 4 bars, so the swap lands
	 * on a phrase.
	 */
	proPlan(from: Deck, to: Deck, auto = false) {
		const fit = this.compat(from, to);
		const a = from.analysis;
		const b = to.analysis;
		if (!a || !b) return null;
		const pos = from.position();
		const now = pos + 0.15;
		const bar = a.bar;
		const rate = fit.change != null ? 1 + fit.change : 1;
		// (The pitch between the two moves with the tempo change, wherever it's made)
		const keys = keyFit(a.key, b.key, rate / from.rate);
		const canBlend = fit.rating !== 'clash';
		// Tempos more than 6 % apart meet in the middle: the old song moves halfway, slowly,
		// before the mix, the new one plays there and glides back to its own tempo after it
		// (half the change each, never a jump: the pitch moves with the tempo)
		const native = from.bpm() / from.rate;
		// The new song's tempo as it lines up with the old one's (its own, or half or double)
		const newBpm = from.bpm() / rate;
		const gap = newBpm / native - 1;
		const meet = canBlend && Math.abs(gap) > 0.06;
		const shared = Math.sqrt(native * newBpm);
		const rampTo = meet ? shared / native - 1 : null;

		// Where the new song starts: its cue, or where the user put it
		const cue = Math.max(
			to.state.hotCues[0] ?? to.state.cue,
			Math.min(b.firstBar, to.state.cue + bar * 2)
		);
		// (Waiting at its deck's cue, or the first bar heard, is not "put there")
		const placed = to.position();
		const userPlaced =
			!to.state.playing &&
			Math.abs(placed - cue) > 1 &&
			Math.abs(placed - to.state.cue) > 1 &&
			Math.abs(placed - (to.state.hotCues[0] ?? -99)) > 1 &&
			placed > 0 &&
			placed < to.state.duration - 20;
		const from0 = userPlaced ? placed : cue;
		// Its intro: up to where it really gets going (its first peak, or a verse as loud)
		const body = kickIn(b, from0);
		const introBars = Math.floor((body - from0) / b.bar + 1e-6);

		// Where the playing song can be left: with Auto DJ, over its outro or its last phrases
		// (a song without an outro: its last chorus fades under the new song's intro); mixed by
		// hand, from the next phrase (or bar)
		const nextBoundary = (time: number) => {
			const phrase = phraseCeil(a, time);
			return auto || phrase - time <= bar * 4 + 0.01 ? phrase : nextDownbeat(from.grid, time, 0);
		};
		const exit = auto ? this.exitWindow(from, a, now) : null;
		const until = exit?.until ?? a.lastBar;
		const where = exit?.mid ? ' in the breakdown' : '';
		const longest = (limit: number) => [32, 16, 8].find((n) => n <= limit) ?? 0;
		// Mixed by hand with tempos to meet: a few bars for the old song to get there first
		const ready =
			!exit && meet && Math.abs(from.state.tempo - rampTo!) > 0.003 ? now + 4 * bar : now;

		const blend = (style: 'eq' | 'filter' | 'stages') => {
			const drums = keys === 0 || introBars < 8;
			let bars = 0;
			let startAt = 0;
			if (exit) {
				// Auto DJ: how far back from where the old song ends the mix may start (a phrase:
				// most of a last chorus plays on its own)
				const back = Math.max(now, phraseFloor(a, exit.from - (exit.mid ? 0 : 8 * bar)));
				const start = nextBoundary(back);
				const room = Math.floor((until - start) / bar + 1e-6);
				// Over the new song's intro, or (too short) its start with only its highs
				bars = longest(drums ? Math.min(room, 16) : Math.min(introBars, room, 32));
				// Little left of the old song: a short one still beats an echo
				if (bars < 8 && room >= 4) bars = 4;
				if (bars < 4) return null;
				// With a long outro: so the mix ends where the old song does (or the new song's
				// drop takes the place of the old one's next drop)
				startAt = Math.max(start, phraseFloor(a, until - bars * bar));
			} else {
				// By hand: right away on the next 4 bars, and so the swap lands on a phrase of
				// the old song (12 or 4 bars from the middle of a phrase, 16 or 8 from its start)
				const half = bar * 4;
				startAt = a.anchor + Math.ceil((ready - a.anchor) / half - 1e-6) * half;
				const toPhrase = Math.round((phraseCeil(a, startAt + 0.01) - startAt) / bar);
				const room = Math.floor((a.lastBar - startAt) / bar + 1e-6);
				const limit = Math.min(
					room,
					16,
					drums && style !== 'filter' ? (toPhrase < 8 ? 12 : 8) : Math.max(introBars, toPhrase)
				);
				bars = [toPhrase + 8, toPhrase].find((n) => n >= 8 && n <= limit) ?? 0;
				// Mid-phrase with no room for 12 bars: on the next phrase, 8 bars (a DJ waits for
				// the phrase rather than rush a 4-bar mix)
				if (!bars && toPhrase < 8 && room >= toPhrase + 8) {
					startAt += toPhrase * bar;
					bars = 8;
				}
				if (bars < 8 && room >= 4) bars = Math.min(room, toPhrase);
				if (bars < 4) return null;
			}
			// The new song so it gets going right on the swap, if its intro is long enough
			const lead = body - bars * b.bar;
			const inPoint = userPlaced ? placed : lead >= from0 - 0.05 ? beatRound(to.grid, lead) : from0;
			const swapB = inPoint + bars * b.bar;
			const intoPeak = b.drops.some((d) => Math.abs(d.start - swapB) < b.bar * 0.6);
			// The filter blend: the new song comes in muffled (low-pass) and opens up into the
			// swap while the old one thins out (high-pass). The three-band blend: highs, then
			// mids, then the bass change places on the phrases of the mix. With keys that clash
			// only the EQ blend with just the new song's drums is clean
			if (style !== 'eq' && keys === 0) return null;
			if (style === 'stages' && (drums || bars < 8)) return null;
			const filter = style === 'filter';
			const how =
				style === 'filter'
					? intoPeak
						? 'it opens up into its drop'
						: 'it opens up'
					: style === 'stages'
						? 'highs, then mids'
						: drums
							? keys === 0
								? 'the keys clash: only its drums'
								: 'its highs first'
							: 'its intro';
			const name =
				style === 'filter' ? 'Filter blend' : style === 'stages' ? 'Three-band blend' : 'Blend';
			return {
				type: 'blend' as TransitionType,
				bars,
				startAt,
				inPoint,
				fit,
				drums: drums && style === 'eq',
				filter,
				stages: style === 'stages',
				intoPeak,
				swap: 1,
				onOne: false,
				rampTo,
				style: style === 'eq' && drums ? 'drums' : style,
				options: '',
				why:
					`${name}${where} over ${bars} bars (${how}), the basslines swap on the one` +
					(meet ? ` · the tempos meet at ${Math.round(shared)} BPM` : '')
			};
		};

		// Where a short move ends in the old song: on a phrase (Auto DJ: where the old song
		// ends, or its next drop would come; by hand: the next phrase it fits before)
		const swapEnd = (bars: number) => {
			if (exit) {
				const back = Math.max(now, phraseFloor(a, exit.from - (exit.mid ? 0 : 8 * bar)));
				const end = phraseFloor(a, until + 0.01);
				return end - bars * bar >= back - 0.01 ? end : null;
			}
			const half = bar * 4;
			const first = a.anchor + Math.ceil((ready - a.anchor) / half - 1e-6) * half;
			const end = phraseCeil(a, first + bars * bar - 0.01);
			return end <= a.lastBar + 0.01 ? end : null;
		};
		// The old song ends loud (a chorus, a drop): moves with energy fit
		const end8 = swapEnd(8);
		const aEnd = end8 != null ? (levelBetween(a, end8 - 4 * bar, end8) ?? 0) : 0;
		const hotEnd = aEnd >= a.peakLevel * a.loudest * 0.8;
		// The new song's next drop: the moves into a drop land on it (without skipping more
		// than a little of the new song)
		const bDrop = b.drops.find((d) => d.start > from0 + b.bar)?.start ?? null;
		const intoDrop = (type: TransitionType, bars: number, style: string, why: string) => {
			if (userPlaced || bDrop == null) return null;
			const end = swapEnd(Math.max(1, bars));
			if (end == null) return null;
			const inPoint = type === 'cut' ? bDrop : bDrop - bars * b.bar;
			// (A cut or a brake straight into the drop keeps the energy of a loud ending: it
			// may skip more of the new song's start)
			const skip = type === 'cut' || type === 'brake' ? (hotEnd ? 32 : 16) : 16;
			if (inPoint < from0 - 0.05 || inPoint - from0 > skip * b.bar) return null;
			return {
				type,
				bars,
				startAt: type === 'cut' ? end : end - bars * bar,
				inPoint: beatRound(to.grid, inPoint),
				fit,
				drums: false,
				filter: false,
				stages: false,
				intoPeak: true,
				swap: 1,
				onOne: false,
				rampTo,
				style,
				options: '',
				why: why + (meet ? ` · the tempos meet at ${Math.round(shared)} BPM` : '')
			};
		};
		// The wash out: the old song's last bars wash away in reverb and echo, the new one
		// comes in on the one, clean (no long overlap: good with keys that clash)
		const washOut = () => {
			const end = swapEnd(2);
			if (end == null) return null;
			return {
				type: 'wash' as TransitionType,
				bars: 4,
				startAt: end - 2 * bar,
				// On the one at a strong point: its drop after a loud ending, else where it gets
				// going (not a quiet start after the wash)
				inPoint: userPlaced
					? placed
					: hotEnd && bDrop != null && bDrop - from0 <= 32 * b.bar
						? beatRound(to.grid, bDrop)
						: body - from0 <= 16 * b.bar
							? beatRound(to.grid, body)
							: from0,
				fit,
				drums: false,
				filter: false,
				stages: false,
				intoPeak: false,
				swap: 0.5,
				onOne: false,
				rampTo,
				style: 'wash',
				options: '',
				why:
					'Wash out: the old song washes away in reverb, the new one comes in on the one' +
					(meet ? ` · the tempos meet at ${Math.round(shared)} BPM` : '')
			};
		};

		// A DJ picks the move from the music, and doesn't do the same one every time
		let plan = null;
		if (canBlend) {
			const hot = hotEnd;
			const options: { plan: ReturnType<typeof blend>; score: number }[] = [];
			const add = (option: ReturnType<typeof blend>, score: number) => {
				if (option) options.push({ plan: option, score });
			};
			const eq = blend('eq');
			add(eq, eq?.drums ? (keys === 0 ? 0.9 : 0.6) : 1);
			const filtered = blend('filter');
			add(filtered, 0.8 + (filtered?.intoPeak || introBars < 8 ? 0.25 : 0));
			const stages = blend('stages');
			add(stages, stages && stages.bars >= 16 ? 0.9 : 0.65);
			add(
				intoDrop(
					'dropswap',
					bar > 2.2 ? 4 : 8,
					'dropswap',
					'Build-up into its drop: the new song opens up under the old one, which stutters out on the last beats'
				),
				hot ? 0.95 : 0.6
			);
			add(intoDrop('cut', 1, 'cut', 'Cut on the one, straight into its drop'), hot ? 0.7 : 0.35);
			add(
				intoDrop(
					'brake',
					4,
					'brake',
					'Brake: the old song stops like a record, the new one drops in'
				),
				hot ? 0.5 : 0.3
			);
			add(washOut(), 0.55 + (keys === 0 ? 0.25 : 0) + (meet ? 0.15 : 0));
			// Variety: the move just made much less, the one before a little less; and a
			// little chance (the same for the same two songs) so no set sounds the same
			const songs = `${from.state.song?.id ?? ''}>${to.state.song?.id ?? ''}`;
			const chance = (style: string) => {
				let h = 2166136261;
				for (const ch of songs + style) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
				return ((h >>> 0) % 1000) / 1000;
			};
			for (const o of options) {
				const style = o.plan!.style;
				if (this.styleHistory[0] === style) o.score *= 0.3;
				else if (this.styleHistory[1] === style) o.score *= 0.65;
				o.score *= 0.8 + 0.4 * chance(style);
			}
			options.sort((x, y) => y.score - x.score);
			plan = options[0]?.plan ?? null;
			// (What else it could have done, for a look under the hood)
			if (plan)
				plan.options = options.map((o) => `${o.plan!.style} ${o.score.toFixed(2)}`).join(', ');
		}
		if (!plan && canBlend) {
			// Almost at the end: two bars from the next one, still beatmatched
			const startAt = nextDownbeat(from.grid, now, 0.1);
			if (a.lastBar - startAt >= bar * 2 - 0.05)
				plan = {
					type: 'blend' as TransitionType,
					bars: 2,
					startAt,
					inPoint: userPlaced ? placed : from0,
					fit,
					drums: false,
					swap: 1,
					onOne: false,
					rampTo: null,
					filter: false,
					stages: false,
					intoPeak: false,
					style: 'quick',
					options: '',
					why: 'Quick blend: the song is nearly over'
				};
		}
		if (!plan) {
			// (Only for a song without a beat, or one that's ending right now.) Echo out on the
			// last beat of a phrase, ringing on over the new song, which comes in
			// on the one at its own tempo. Mid-song, after the old song's drop: straight into
			// the new song's drop, the energy stays up
			const earliest = exit ? Math.max(now, exit.from) : now;
			const boundary = exit
				? phraseCeil(a, Math.max(now + a.bar / 4, Math.min(earliest, until - bar)))
				: nextBoundary(now + a.bar / 4);
			const beat = a.bar / 4;
			const drop = b.drops.find((d) => d.start > from0 + b.bar * 2)?.start;
			const slam = !!exit?.mid && !userPlaced && drop != null;
			plan = {
				type: 'echo' as TransitionType,
				bars: bar < 1.6 ? 4 : 2,
				startAt: Math.min(boundary, a.lastBar) - beat,
				inPoint: userPlaced ? placed : slam ? beatRound(to.grid, drop!) : cue,
				fit,
				drums: false,
				swap: 1,
				onOne: true,
				rampTo: null as number | null,
				filter: false,
				stages: false,
				intoPeak: false,
				style: 'echo',
				options: '',
				why: slam
					? 'Echo out after the drop, straight into the next drop'
					: !canBlend
						? 'Echo out: no beat to match'
						: 'Echo out: too little left of the song to blend'
			};
		}
		return plan;
	}

	/**
	 * How a mix goes: its kind and length (Smart picks them from how well the songs fit),
	 * when it starts in the playing song (on its next bar, or phrase if that's close) and
	 * where the new song starts, so that its drop (kiai) comes when the mix is done
	 */
	plan(
		from: Deck,
		to: Deck,
		type = this.transitionType,
		bars = this.transitionBars,
		auto = false
	): {
		type: TransitionType;
		bars: number;
		startAt: number;
		inPoint: number;
		fit: ReturnType<Mixer['compat']>;
		drums?: boolean;
		swap?: number;
		onOne?: boolean;
		rampTo?: number | null;
		filter?: boolean;
		stages?: boolean;
		intoPeak?: boolean;
		style?: string;
		why?: string;
	} {
		const fit = this.compat(from, to);
		if (type === 'smart') {
			const pro = auto ? this.autoPlanFor(from, to) : this.proPlan(from, to, auto);
			if (pro) return pro;
			// Not analysed (yet): a blend, or an echo out if the tempos don't go
			type = fit.rating === 'clash' ? 'echo' : 'bassswap';
			bars = type === 'echo' ? 2 : 16;
		}
		if (
			fit.rating === 'clash' &&
			(type === 'bassswap' || type === 'crossfade' || type === 'filter')
		) {
			type = 'echo';
			bars = Math.min(bars, 4);
		}
		if (type === 'cut') bars = 1;
		// A wash out: two bars of wash, the new song on the one, two bars of its tail
		if (type === 'wash') bars = 4;
		const smartCut = type === 'dropswap' || type === 'brake';
		const pos = from.position();
		const section = sectionAt(from.grid, pos);
		const meter = section?.meter ?? 4;
		const bar = (section?.beat ?? 0.5) * meter;
		// On a phrase (8 bars) if one comes within 4 bars, else on the next bar
		let startAt = nextDownbeat(from.grid, pos, 0.15);
		if (section && type !== 'cut' && type !== 'echo') {
			const phrase = bar * 8;
			const nextPhrase = section.time + Math.ceil((pos + 0.15 - section.time) / phrase) * phrase;
			if (nextPhrase - pos <= bar * 4 + 0.01) startAt = nextPhrase;
			// (A wash out so the new song comes in on the phrase)
			if (type === 'wash') {
				const one =
					section.time + Math.ceil((pos + 0.15 + bar * 2 - section.time) / phrase) * phrase;
				startAt = one - bar * 2;
			}
		}
		// The new song: from its cue, or so its first drop lands when the mix is done
		const toSection = sectionAt(to.grid, to.state.cue);
		const toBar = (toSection?.beat ?? 0.5) * (toSection?.meter ?? 4);
		const base = to.state.hotCues[0] ?? to.state.cue;
		let inPoint = base;
		const drop = to.state.kiai.find((k) => k.start > base + toBar)?.start;
		if (drop !== undefined && type !== 'wash') {
			if (type === 'cut' || type === 'echo' || (smartCut && bars <= 2)) inPoint = drop - toBar;
			else {
				const lead = drop - bars * toBar;
				// Not skipping more than a little intro
				if (lead >= base && lead - base <= 24 * toBar) inPoint = lead;
			}
		}
		if (to.grid.length && inPoint !== base) inPoint = Math.max(base, beatRound(to.grid, inPoint));
		// Where the user put the new song (scrubbed, or played it before) it goes on from there
		const placed = to.position();
		if (
			!to.state.playing &&
			Math.abs(placed - base) > 1 &&
			placed > 0 &&
			placed < to.state.duration - 20
		)
			inPoint = to.grid.length ? beatRound(to.grid, placed) : placed;
		return { type, bars, startAt, inPoint, fit, swap: type === 'wash' ? 0.5 : undefined };
	}

	/** Mixes from the playing deck to the other one (see plan) */
	mix(type = this.transitionType, bars = this.transitionBars, auto = false) {
		const from = this.leading();
		if (!from || this.transition) return false;
		const to = this.other(from.id);
		if (!to.buffer) return false;
		const plan = this.plan(from, to, type, bars, auto);
		const match = to.matchRate(from);
		// An echo out doesn't play the two together: the new song keeps its own tempo (and pitch)
		const sync = plan.type !== 'echo' || !plan.onOne;
		if (match && plan.fit.rating !== 'clash' && sync) {
			to.setTempo(match.rate - 1, true);
			to.state = { ...to.state, synced: true };
			from.state = { ...from.state, synced: false };
		}
		const pos = from.position();
		// Tempos to meet: the old song gets there before the mix (if it isn't already)
		if (plan.rampTo != null && Math.abs(from.state.tempo - plan.rampTo) > 0.003) {
			const seconds = ((plan.startAt - pos - 0.05) / (from.rate + (1 + plan.rampTo))) * 2;
			if (seconds > 0.5) this.startRamp(from, plan.rampTo, seconds);
		}
		const finalRate = this.rampState?.deck === from ? 1 + this.rampState.to : from.rate;
		const section = sectionAt(from.grid, from.position());
		const beatSeconds = (section?.beat ?? 0.5) / finalRate;
		const meter = section?.meter ?? 4;
		// When the old song gets to where the mix starts (a moment ago, if it's late: then it
		// goes on from there, the new song too, so both stay on the beat)
		const now = this.ctx.currentTime;
		const start = now + this.realTimeTo(from, plan.startAt);
		// An echo out starts on the old song's last beat: the new one comes in on the one after;
		// a wash out washes for two bars before it does
		const lead = plan.onOne ? beatSeconds : plan.type === 'wash' ? 2 * meter * beatSeconds : 0;
		if (!to.state.playing) {
			const playAt = start + lead;
			const late = Math.max(0, now + 0.05 - playAt);
			to.seek(plan.inPoint + late * to.rate);
			to.play(Math.max(playAt, now + 0.05));
		} else if (match && sync) {
			to.alignTo(from, match.factor === 1);
		}
		// The new song as loud as the old one was: one much louder (a quiet outro, a loud verse)
		// comes in at the old one's level and rides up to its own after the mix
		let ride = 1;
		if (plan.type === 'blend' && from.analysis && to.analysis) {
			const a = from.analysis;
			const b = to.analysis;
			const swapIn = plan.startAt + plan.bars * a.bar;
			const before = Math.max(
				levelBetween(a, plan.startAt - 4 * a.bar, plan.startAt) ?? 0,
				levelBetween(a, swapIn - 4 * a.bar, swapIn) ?? 0
			);
			const swapB = plan.inPoint + plan.bars * b.bar;
			const next = levelBetween(b, swapB, swapB + 4 * b.bar);
			if (before > 0 && next) {
				const ratio = (next * to.normalize) / (before * from.normalize);
				if (ratio > 1.12) ride = Math.max(0.5, 1 / ratio);
			}
		}
		if (plan.style) this.styleHistory = [plan.style, ...this.styleHistory].slice(0, 4);
		this.autoPlanned = null;
		// A blend goes on a bar after the swap: the old song fades out under the new one's one
		const after = plan.type === 'blend' ? 1 : 0;
		const length = plan.type === 'cut' ? beatSeconds : (plan.bars + after) * meter * beatSeconds;
		this.before[from.id] = {
			eq: from.state.eq,
			kill: from.state.kill,
			filter: from.state.filter,
			echo: from.state.echo,
			reverb: from.state.reverb,
			volume: from.state.volume
		};
		this.before[to.id] = {
			eq: to.state.eq,
			filter: to.state.filter,
			volume: Math.max(to.state.volume, 0.9)
		};
		to.set({
			volume: Math.max(to.state.volume, 0.9),
			kill: { low: false, mid: false, high: false }
		});
		this.transition = {
			from: from.id,
			to: to.id,
			type: plan.type,
			bars: plan.bars,
			start,
			end: start + length,
			beat: beatSeconds,
			drums: plan.drums,
			swap: after ? plan.bars / (plan.bars + after) : plan.swap,
			onOne: plan.onOne,
			ride,
			filter: plan.filter,
			stages: plan.stages
		};
		// The riser is an effect for the hand-picked styles, a pro blend doesn't need one
		// A filter blend into a drop builds up with a riser over its last bars
		if (this.hype && plan.type === 'blend' && plan.filter && plan.intoPeak && plan.bars >= 8)
			this.riser(
				start + (plan.bars - 4) * meter * beatSeconds,
				start + plan.bars * meter * beatSeconds
			);
		if (this.hype && plan.bars >= 4 && !['cut', 'blend', 'echo'].includes(plan.type)) {
			// Up to the swap (the middle) of a bass swap, else most of the mix
			const until =
				plan.type === 'bassswap'
					? 0.5
					: plan.type === 'echo'
						? 0.3
						: plan.type === 'dropswap'
							? 1
							: plan.type === 'loopout'
								? 0.94
								: plan.type === 'brake'
									? 0.8
									: 0.65;
			this.riser(start, start + length * until);
		}
		this.emit();
		return true;
	}

	/** A noise sweep rising into a moment (when the new song takes over) */
	private riser(from: number, to: number) {
		const ctx = this.ctx;
		const length = Math.max(0.5, to - from);
		const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (length + 0.3)), ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const band = ctx.createBiquadFilter();
		band.type = 'bandpass';
		band.Q.value = 1.4;
		band.frequency.setValueAtTime(300, from);
		band.frequency.exponentialRampToValueAtTime(9000, to);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.0001, from);
		gain.gain.exponentialRampToValueAtTime(0.16, to);
		gain.gain.exponentialRampToValueAtTime(0.0001, to + 0.25);
		source.connect(band).connect(gain).connect(this.bus);
		source.start(from);
		source.stop(to + 0.3);
		this.risers.push(source);
	}
	private risers: AudioBufferSourceNode[] = [];

	/** Stops a mix where it is */
	cancelMix() {
		if (!this.transition) return;
		this.decks[this.transition.from].setDry(1);
		for (const source of this.risers) {
			try {
				source.stop();
			} catch {
				// Over already
			}
		}
		this.risers = [];
		this.transition = null;
		this.emit();
	}

	/** Moves the controls along the mix */
	private stepTransition() {
		const t = this.transition!;
		const from = this.decks[t.from];
		const to = this.decks[t.to];
		const now = this.ctx.currentTime;
		if (now < t.start) return;
		const p = Math.max(0, Math.min(1, (now - t.start) / (t.end - t.start || 1)));
		const fromSide = t.from === 'A' ? 0 : 1;
		const toSide = 1 - fromSide;
		const clamp = (x: number) => Math.max(0, Math.min(1, x));
		const lerp = (a: number, b: number, x: number) => a + (b - a) * clamp(x);
		const was = this.before;
		const fromEq = { ...(was[t.from]?.eq ?? { low: 0, mid: 0, high: 0 }) };
		const toEq = { ...(was[t.to]?.eq ?? { low: 0, mid: 0, high: 0 }) };
		/** One beat as a part of the mix */
		const beat = t.beat / (t.end - t.start || 1);
		switch (t.type) {
			case 'bassswap': {
				// The new one comes in without its bass and highs open up; on the middle bar
				// the basslines swap; then the old one's mids and highs fade and it's gone
				const swap = clamp((p - 0.5) / beat);
				to.set({
					eq: {
						low: lerp(EQ_MIN, toEq.low, swap),
						mid: lerp(-8, toEq.mid, p / 0.5),
						high: lerp(-14, toEq.high, p / 0.4)
					}
				});
				from.set({
					eq: {
						low: lerp(fromEq.low, EQ_MIN, swap),
						mid: lerp(fromEq.mid, -10, (p - 0.55) / 0.4),
						high: lerp(fromEq.high, -16, (p - 0.6) / 0.35)
					},
					reverb: this.hype ? lerp(0, 0.35, (p - 0.75) / 0.25) : from.state.reverb
				});
				this.setCrossfader(
					p < 0.85 ? lerp(fromSide, 0.5, p / 0.2) : lerp(0.5, toSide, (p - 0.85) / 0.15)
				);
				break;
			}
			case 'crossfade': {
				// Without two basslines at once: the new one's bass comes as the old one's goes
				to.set({ eq: { ...toEq, low: lerp(EQ_MIN, toEq.low, (p - 0.4) / 0.2) } });
				from.set({ eq: { ...fromEq, low: lerp(fromEq.low, EQ_MIN, (p - 0.4) / 0.2) } });
				this.setCrossfader(lerp(fromSide, toSide, p));
				break;
			}
			case 'filter': {
				// The old one thins out (high-pass), the new one opens up (low-pass)
				const sweep = clamp(p / 0.9);
				from.set({
					filter: lerp(was[t.from]?.filter ?? 0, 0.8, sweep * sweep),
					reverb: this.hype ? lerp(0, 0.4, (p - 0.6) / 0.4) : from.state.reverb
				});
				to.set({ filter: lerp(-0.75, 0, p / 0.65) });
				this.setCrossfader(lerp(fromSide, toSide, (p - 0.2) / 0.75));
				break;
			}
			case 'blend': {
				// The new song's intro under the old one's outro: its highs early, its mids
				// (none with clashing keys) later, its bass not before the swap. The old one keeps
				// its bass to the swap; its mids and highs go (and it thins out) in its last
				// phrase. On the swap the basslines change places on the one, the old song's last
				// beat rings on as an echo (the song itself cut) and fades over the next bar.
				// The levels so the two together are never louder than one: the new song comes
				// in lower, the old one goes down as it comes up, and a new song louder than the
				// old one was comes in at the old one's level (see mix: ride)
				const swapAt = t.swap ?? 1;
				const ride = t.ride ?? 1;
				const full = (was[t.to]?.volume ?? 1) * ride;
				const fromVolume = was[t.from]?.volume ?? 1;
				const barPart = beat * 4;
				const fadeFrom = Math.max(0, swapAt - Math.min(0.5, barPart * 8));
				const swapped = p >= swapAt - beat * 0.05;
				const after = (p - swapAt) / beat;
				if (t.filter) {
					// Filter blend: the new song opens from muffled to full by the swap (slowly
					// at first, faster towards it), the old one thins out over the last half
					const open = clamp(p / swapAt);
					to.set({
						volume: swapped
							? lerp(full * 0.85, full, after / 2)
							: lerp(full * 0.75, full * 0.9, open),
						filter: swapped ? 0 : -0.8 * (1 - open * open),
						eq: { ...toEq, low: swapped ? lerp(-12, toEq.low, after * 2) : EQ_MIN }
					});
					const thin = clamp((p - swapAt * 0.5) / (swapAt * 0.5));
					from.set({
						volume: lerp(fromVolume, fromVolume * 0.9, thin),
						filter: lerp(was[t.from]?.filter ?? 0, 0.5, thin * thin * thin),
						eq: { ...fromEq, low: swapped ? EQ_MIN : fromEq.low },
						echo:
							p >= swapAt - beat
								? lerp(0, 0.45, (p - (swapAt - beat)) / (beat * 0.5))
								: (was[t.from]?.echo ?? 0)
					});
					if (swapped && !t.stage) {
						t.stage = 1;
						from.setDry(0);
					}
					this.setCrossfader(
						swapped
							? lerp(0.5, toSide, (p - swapAt) / Math.max(0.0001, 1 - swapAt))
							: lerp(fromSide, 0.5, p / Math.max(0.06, barPart * 2))
					);
					break;
				}
				if (t.stages) {
					// Three bands: the highs change places a quarter in, the mids half way, the
					// bass on the swap (each in a beat, on the mix's bars)
					const q1 = swapAt * 0.25;
					const q2 = swapAt * 0.5;
					const highs = clamp((p - q1) / beat);
					const mids = clamp((p - q2) / beat);
					to.set({
						volume: swapped
							? lerp(full * 0.9, full, after / 2)
							: lerp(full * 0.7, full * 0.9, p / swapAt),
						eq: {
							high: p < q1 ? lerp(-18, -8, p / q1) : lerp(-8, toEq.high, highs),
							mid: p < q2 ? EQ_MIN : lerp(-12, toEq.mid, mids),
							low: swapped ? lerp(-12, toEq.low, after * 2) : EQ_MIN
						}
					});
					from.set({
						eq: {
							high: p < q1 ? fromEq.high : lerp(fromEq.high, -14, highs),
							mid: p < q2 ? fromEq.mid : lerp(fromEq.mid, -10, mids),
							low: swapped ? EQ_MIN : fromEq.low
						},
						echo:
							p >= swapAt - beat
								? lerp(0, 0.45, (p - (swapAt - beat)) / (beat * 0.5))
								: (was[t.from]?.echo ?? 0)
					});
					if (swapped && !t.stage) {
						t.stage = 1;
						from.setDry(0);
					}
					this.setCrossfader(
						swapped
							? lerp(0.5, toSide, (p - swapAt) / Math.max(0.0001, 1 - swapAt))
							: lerp(fromSide, 0.5, p / Math.max(0.06, barPart * 2))
					);
					break;
				}
				to.set({
					volume: swapped
						? lerp(full * 0.9, full, after / 2)
						: lerp(full * 0.65, full * 0.9, p / swapAt),
					eq: {
						high: lerp(-18, toEq.high, p / 0.35),
						mid: t.drums
							? swapped
								? lerp(-12, toEq.mid, after)
								: EQ_MIN
							: lerp(-12, toEq.mid, p / 0.6),
						// The bass on the one (in half a beat: no click)
						low: swapped ? lerp(-12, toEq.low, after * 2) : EQ_MIN
					}
				});
				const fade = (p - fadeFrom) / Math.max(0.0001, swapAt - fadeFrom);
				const throwAt = swapAt - beat;
				from.set({
					// Only a little down before the swap (the new song has no bass yet: the two
					// together stay as loud as one); it goes on the swap itself
					volume: lerp(fromVolume, fromVolume * 0.9, (p - 0.5) / Math.max(0.0001, swapAt - 0.5)),
					eq: {
						low: swapped ? EQ_MIN : fromEq.low,
						mid: lerp(fromEq.mid, -4, fade),
						high: lerp(fromEq.high, -6, fade)
					},
					filter: lerp(was[t.from]?.filter ?? 0, 0.15, (p - (swapAt - barPart)) / barPart),
					echo:
						p >= throwAt ? lerp(0, 0.45, (p - throwAt) / (beat * 0.5)) : (was[t.from]?.echo ?? 0)
				});
				// On the one the old song itself goes: only its echo rings on
				if (swapped && !t.stage) {
					t.stage = 1;
					from.setDry(0);
				}
				// The new song up over its first bars; after the swap the old one's echo fades
				this.setCrossfader(
					swapped
						? lerp(0.5, toSide, (p - swapAt) / Math.max(0.0001, 1 - swapAt))
						: lerp(fromSide, 0.5, p / Math.max(0.06, barPart * 2))
				);
				break;
			}
			case 'echo': {
				// On the old song's last beat its echo opens; on the one it stops and its echo
				// rings out over the new song, fading away over the rest of the mix
				const oneBeat = t.onOne ? beat : 0.3;
				from.set({
					echo: lerp(0, 0.85, p / (oneBeat * 0.5)),
					reverb: lerp(0, 0.35, p / oneBeat)
				});
				this.setCrossfader(
					p < oneBeat
						? lerp(fromSide, 0.5, p / oneBeat)
						: lerp(0.5, toSide, (p - oneBeat) / Math.max(0.0001, 1 - oneBeat))
				);
				if (p >= oneBeat && from.state.playing) from.pause();
				break;
			}
			case 'dropswap': {
				// The new one builds up under the old one: no bass yet, its low-pass opening.
				// The old one thins out, then stutters in shorter and shorter rolls; on the drop
				// it's cut and the new one's bass comes in
				const beatsLeft = (1 - p) / beat;
				to.set({
					eq: { ...toEq, low: EQ_MIN },
					filter: lerp(-0.7, -0.05, p / 0.92)
				});
				this.setCrossfader(lerp(fromSide, 0.5, p / 0.2));
				from.set({
					eq: { ...fromEq, low: lerp(fromEq.low, -8, (p - 0.55) / 0.35) },
					filter: lerp(0, 0.55, 1 - (beatsLeft - 0) / 8)
				});
				const stage = beatsLeft <= 1 ? 3 : beatsLeft <= 2 ? 2 : beatsLeft <= 4 ? 1 : 0;
				if (stage > (t.stage ?? 0)) {
					t.stage = stage;
					from.loopBeats([0, 1, 0.5, 0.25][stage]);
				}
				break;
			}
			case 'loopout': {
				// The old one loops its bar, the loop halves (8, 4, 2, 1, ½ beats) and thins
				// out; the new one comes in, its bass with the last loops
				const stage = p >= 0.94 ? 5 : p >= 0.875 ? 4 : p >= 0.75 ? 3 : p >= 0.5 ? 2 : 1;
				if (stage > (t.stage ?? 0)) {
					t.stage = stage;
					from.loopBeats([0, 8, 4, 2, 1, 0.5][stage]);
				}
				from.set({ filter: lerp(0, 0.6, (p - 0.3) / 0.7) });
				to.set({ eq: { ...toEq, low: lerp(EQ_MIN, toEq.low, (p - 0.72) / 0.1) } });
				this.setCrossfader(lerp(fromSide, toSide, (p - 0.05) / 0.85));
				break;
			}
			case 'brake': {
				// The new one comes in under the old one without its bass; the old one stops like
				// a halted record so it's still just as the new one drops (on the mix's end)
				to.set({ eq: { ...toEq, low: EQ_MIN } });
				const brakeAt = 1 - 1.1 / Math.max(1.2, t.end - t.start);
				if (p < brakeAt) this.setCrossfader(lerp(fromSide, 0.5, p / 0.3));
				else if (!t.stage) {
					t.stage = 1;
					from.brake();
				}
				break;
			}
			case 'wash': {
				// The old song's last two bars wash away (reverb, echo, a rising high-pass); on
				// the one it's cut, its wash rings on over the new song and fades
				const swapAt = t.swap ?? 0.5;
				if (p < swapAt) {
					const build = clamp(p / swapAt);
					from.set({
						reverb: lerp(0, 0.7, build),
						echo: lerp(0, 0.55, build * build),
						filter: lerp(was[t.from]?.filter ?? 0, 0.45, build * build)
					});
					this.setCrossfader(fromSide);
				} else {
					if (!t.stage) {
						t.stage = 1;
						from.setDry(0);
					}
					this.setCrossfader(lerp(0.5, toSide, (p - swapAt) / Math.max(0.0001, 1 - swapAt)));
				}
				break;
			}
			case 'cut':
				this.setCrossfader(toSide);
				break;
		}
		if (p >= 1) this.finishMix();
	}

	/** After a mix, the new song's tempo goes back to its own over a few bars */
	private glideState: { deck: Deck; from: number; start: number; end: number } | null = null;

	private finishMix() {
		const t = this.transition!;
		const from = this.decks[t.from];
		const to = this.decks[t.to];
		const echo = t.type === 'echo';
		this.transition = null;
		this.risers = [];
		// The old deck stops and gets its sound back; after an echo out, once it rang out
		const done = () => {
			this.setCrossfader(t.to === 'A' ? 0 : 1);
			from.pause();
			if (from.state.loop) from.exitLoop();
			from.setDry(1);
			from.set({
				...this.before[t.from],
				echo: 0,
				reverb: this.before[t.from]?.reverb ?? 0,
				kill: { low: false, mid: false, high: false },
				filter: 0
			});
		};
		if (echo) setTimeout(done, t.onOne ? 300 : 3000);
		else done();
		const level = this.before[t.to]?.volume ?? to.state.volume;
		const ride = t.ride ?? 1;
		to.set({
			eq: this.before[t.to]?.eq ?? { low: 0, mid: 0, high: 0 },
			filter: 0,
			volume: level * ride
		});
		// Came in lower: up to its own level over 16 bars, slowly (nobody hears it rise)
		if (ride < 0.99) {
			const now = this.ctx.currentTime;
			this.levelGlide = {
				deck: to,
				from: level * ride,
				to: level,
				start: now,
				end: now + t.beat * 64
			};
		}
		// The new song leads now
		to.unsync();
		const tempo = to.state.tempo;
		if (this.glide && Math.abs(tempo) > 0.004 && Math.abs(tempo) <= 0.45) {
			// 32 beats, longer for a bigger change (the pitch moves with it)
			const beats = Math.max(32, Math.abs(tempo) * 400);
			this.glideState = {
				deck: to,
				from: tempo,
				start: this.ctx.currentTime + t.beat * 4,
				end: this.ctx.currentTime + t.beat * (4 + beats)
			};
		}
		this.emit();
	}

	/** A deck's level riding up after a mix (it came in lower) */
	private levelGlide: { deck: Deck; from: number; to: number; start: number; end: number } | null =
		null;
	private stepLevelGlide() {
		const g = this.levelGlide!;
		// Another mix with it: that one sets its level
		if (
			this.transition &&
			(this.transition.to === g.deck.id || this.transition.from === g.deck.id)
		) {
			this.levelGlide = null;
			return;
		}
		const p = Math.min(1, (this.ctx.currentTime - g.start) / (g.end - g.start || 1));
		g.deck.set({ volume: g.from + (g.to - g.from) * p * p * (3 - 2 * p) });
		if (p >= 1) this.levelGlide = null;
	}

	/** A deck's tempo moving slowly to another one (before a mix: the tempos meet) */
	private rampState: { deck: Deck; from: number; to: number; start: number; end: number } | null =
		null;
	private startRamp(deck: Deck, to: number, seconds: number) {
		const now = this.ctx.currentTime;
		if (this.glideState?.deck === deck) this.glideState = null;
		this.rampState = { deck, from: deck.state.tempo, to, start: now, end: now + seconds };
	}
	private stepRamp() {
		const r = this.rampState!;
		const p = Math.min(1, (this.ctx.currentTime - r.start) / (r.end - r.start || 1));
		const eased = p * p * (3 - 2 * p);
		r.deck.setTempo(r.from + (r.to - r.from) * eased, r.deck.state.synced);
		if (p >= 1) this.rampState = null;
	}
	/** Real seconds until a deck plays to a point of its song (with its tempo ramp, if any) */
	private realTimeTo(deck: Deck, songTime: number) {
		const left = songTime - deck.position();
		const r = this.rampState;
		if (!r || r.deck !== deck) return left / deck.rate;
		const rampLeft = Math.max(0, r.end - this.ctx.currentTime);
		const end = 1 + r.to;
		// The rest of the ramp at about the average of where it is and where it goes
		const during = (rampLeft * (deck.rate + end)) / 2;
		if (left <= during) return left / ((deck.rate + end) / 2);
		return rampLeft + (left - during) / end;
	}

	private stepGlide() {
		const g = this.glideState!;
		const now = this.ctx.currentTime;
		if (now < g.start) return;
		// A mix (or the user) moved the tempo: it's theirs now
		if (this.transition) {
			this.glideState = null;
			return;
		}
		const p = Math.min(1, (now - g.start) / (g.end - g.start));
		g.deck.setTempo(g.from * (1 - p * p * (3 - 2 * p)), true);
		if (p >= 1) this.glideState = null;
	}

	// --- Auto DJ -------------------------------------------------------------------------------

	startAuto(queue: MapSet[], source: string) {
		this.auto = { on: true, queue, index: -1, source };
		const playing = this.leading();
		if (!playing) {
			this.auto.index = 0;
			const deck = this.decks.A;
			deck.pickedByUser = false;
			deck.load(queue[0]).then(() => {
				if (this.auto.on && this.auto.index === 0) deck.play();
			});
		} else {
			this.auto.index = -1;
		}
		this.emit();
	}

	stopAuto() {
		this.auto = { ...this.auto, on: false };
		this.emit();
	}

	/**
	 * When the playing song should start mixing out: after its last drop (kiai) if there's
	 * room for the mix after it, else the bars before its end; on a bar
	 */
	private mixOutPoint(deck: Deck, other: Deck) {
		// Smart: where the pro plan starts (the outro, on a phrase)
		if (this.transitionType === 'smart') {
			const pro = this.autoPlanFor(deck, other);
			if (pro) return pro.startAt;
		}
		const duration = deck.state.duration;
		const section = sectionAt(deck.grid, duration);
		const bar = (section?.beat ?? 0.5) * (section?.meter ?? 4);
		const { type, bars } = this.plan(deck, other);
		const length = (type === 'cut' ? 1 : bars) * bar;
		let at = duration - length - bar * 2;
		const lastDrop = deck.state.kiai.at(-1);
		if (lastDrop && lastDrop.end + length < duration - bar && lastDrop.end > duration * 0.5)
			at = lastDrop.end - bar;
		const start = section ? section.time + Math.floor((at - section.time) / bar) * bar : at;
		return Math.max(deck.state.cue + bar * 4, start);
	}

	private autoBusy = false;
	/** When the user last touched the DJ controls */
	private userAt = 0;

	/** The user did something on the decks: Auto DJ waits a moment with its mix */
	noteUser() {
		this.userAt = performance.now();
	}

	/** What Auto DJ does next: the song it mixes into and in how many seconds (for the UI) */
	autoStatus(): {
		song: MapSet | null;
		seconds: number | null;
		mixing: boolean;
		how?: string;
	} | null {
		if (!this.auto.on) return null;
		if (this.transition)
			return { song: this.decks[this.transition.to].state.song, seconds: 0, mixing: true };
		const playing = this.leading();
		if (!playing) return { song: null, seconds: null, mixing: false };
		const next = this.other(playing.id);
		if (!next.buffer || next.state.loading)
			return { song: next.state.song, seconds: null, mixing: false };
		const at = this.mixOutPoint(playing, next);
		const seconds = Math.max(0, (at - playing.position()) / (playing.rate || 1));
		const waiting = performance.now() - this.userAt < USER_QUIET_MS;
		const pro = this.transitionType === 'smart' ? this.autoPlanFor(playing, next) : null;
		return {
			song: next.state.song,
			seconds: waiting && seconds === 0 ? null : seconds,
			mixing: false,
			how: pro?.why ?? (this.transitionType === 'smart' ? 'Listening to the songs…' : undefined)
		};
	}

	private async autoStep() {
		if (!this.auto.on || this.autoBusy || this.transition) return;
		const playing = this.leading();
		const queue = this.auto.queue;
		if (!queue.length || !playing) return;
		const next = this.other(playing.id);
		const nextIndex = (this.auto.index + 1) % queue.length;
		// What the user put on the other deck plays next; else the list's next song
		const userPick = next.pickedByUser && next.state.song && !next.state.error;
		if (!userPick && (next.state.song?.id !== queue[nextIndex]?.id || next.state.error)) {
			if (next.state.loading || next.state.playing) return;
			this.autoBusy = true;
			try {
				next.pickedByUser = false;
				await next.load(queue[nextIndex]);
			} finally {
				this.autoBusy = false;
			}
			return;
		}
		if (next.state.loading || !next.buffer || next.state.playing) return;
		// Smart waits for the songs to be analysed (a moment after loading), unless time is short
		const remaining = (playing.state.duration - playing.position()) / (playing.rate || 1);
		if (this.transitionType === 'smart' && (!playing.analysis || !next.analysis) && remaining > 25)
			return;
		// Tempos to meet: the old song moves over the 16 bars before the mix
		if (this.transitionType === 'smart' && !this.rampState) {
			const pro = this.autoPlanFor(playing, next);
			if (pro?.rampTo != null && Math.abs(playing.state.tempo - pro.rampTo) > 0.003) {
				const bar = playing.analysis!.bar;
				const left = pro.startAt - playing.position();
				if (left <= bar * 16 && left > bar * 1.5)
					this.startRamp(playing, pro.rampTo, ((left - bar) * 2) / (playing.rate + 1 + pro.rampTo));
			}
		}
		// A moment early, so the mix starts right on its phrase
		if (playing.position() >= this.mixOutPoint(playing, next) - 0.3 * (playing.rate || 1)) {
			// Not while the user works the decks (syncing, cueing…), unless the song is about
			// to end: the music doesn't stop
			const left = (playing.state.duration - playing.position()) / (playing.rate || 1);
			if (performance.now() - this.userAt < USER_QUIET_MS && left > 20) return;
			if (this.mix(this.transitionType, this.transitionBars, true)) {
				if (!userPick) this.auto = { ...this.auto, index: nextIndex };
				next.pickedByUser = false;
				this.emit();
			}
		}
	}

	private lastPhaseCheck = 0;

	/**
	 * The sync lock: a synced deck keeps the other one's tempo (also when it changes, or
	 * the song's own tempo does) and stays on its beat, corrected with small tempo pushes
	 */
	private keepSync() {
		const now = this.ctx.currentTime;
		const checkPhase = now - this.lastPhaseCheck >= 0.2;
		if (checkPhase) this.lastPhaseCheck = now;
		for (const deck of Object.values(this.decks)) {
			if (!deck.state.synced || !deck.buffer) continue;
			const master = this.other(deck.id);
			if (!master.buffer || !master.state.playing) {
				deck.setAutoBend(0);
				continue;
			}
			const match = deck.matchRate(master);
			if (!match) continue;
			if (Math.abs(deck.rate - match.rate) > 0.0001) deck.setTempo(match.rate - 1, true);
			if (!deck.state.playing || deck.userBending || !checkPhase) continue;
			const beat = (sectionAt(deck.grid, deck.position())?.beat ?? 0.5) / deck.rate;
			const error = deck.phaseOffset(master, match.factor, match.factor === 1) * beat;
			if (Math.abs(error) > 0.15) {
				deck.setAutoBend(0);
				deck.alignTo(master, match.factor === 1);
			} else if (Math.abs(error) > 0.004) {
				// Caught up within about half a second, too little to hear
				deck.setAutoBend(Math.max(-0.03, Math.min(0.03, error * 2)));
			} else deck.setAutoBend(0);
		}
	}

	/** SYNC on a deck: it follows the other one (again to stop) */
	syncDeck(id: DeckId) {
		const deck = this.decks[id];
		if (deck.state.synced) deck.unsync();
		else deck.sync(this.other(id));
	}

	private tick() {
		this.keepSync();
		if (this.transition) this.stepTransition();
		if (this.glideState) this.stepGlide();
		if (this.rampState) this.stepRamp();
		if (this.levelGlide) this.stepLevelGlide();
		this.autoStep();
		if (this.recorder) this.emit();
	}

	// --- Recording ---------------------------------------------------------------------------

	startRecording() {
		if (this.recorder) return;
		const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) =>
			MediaRecorder.isTypeSupported(t)
		);
		this.chunks = [];
		this.recorder = new MediaRecorder(this.stream.stream, type ? { mimeType: type } : undefined);
		this.recorder.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
		this.recorder.start(1000);
		this.recordStart = this.ctx.currentTime;
		this.emit();
	}

	/** Stops recording; the mix as a file */
	stopRecording(): Promise<Blob | null> {
		const recorder = this.recorder;
		if (!recorder) return Promise.resolve(null);
		return new Promise((resolve) => {
			recorder.onstop = () => {
				resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
				this.chunks = [];
			};
			recorder.stop();
			this.recorder = null;
			this.emit();
		});
	}

	// --- One queue with the music player ------------------------------------------------------

	/** The player's queue from its song on (the songs queued with "Play next" first) */
	private playerQueue(): MapSet[] {
		const q = get(songQueue);
		const song = get(currentSong).song;
		const queue = q.queue ?? [];
		const index = q.currentIndex ?? -1;
		if (!song) return [...get(upNext), ...queue];
		const rest = index >= 0 ? [...queue.slice(index + 1), ...queue.slice(0, index)] : queue;
		return [song, ...get(upNext), ...rest.filter((s) => !sameSong(s, song))];
	}

	/** Auto DJ through the player's queue (what plays now is its first song) */
	autoFromPlayer() {
		const queue = this.playerQueue();
		if (!queue.length) return false;
		const lead = this.leading();
		const index = lead?.state.song ? queue.findIndex((s) => sameSong(s, lead.state.song)) : -1;
		this.auto = { on: true, queue, index: index >= 0 ? index : -1, source: 'Your queue' };
		if (!lead) {
			this.auto.index = 0;
			const deck = this.decks.A;
			deck.pickedByUser = false;
			deck.load(queue[0]).then(() => {
				if (this.auto.on && this.auto.index === 0) deck.play();
			});
		}
		this.emit();
		return true;
	}

	/**
	 * Opening the DJ mode: the song that plays goes on deck A where it is (the player keeps
	 * playing until the deck takes over), the queue's next one on deck B, and Auto DJ mixes
	 * through the queue
	 */
	/** Counts the openings and closings of the DJ mode: a slow one that's outdated stops */
	private session = 0;
	/** Leaving the DJ mode, until the player plays on */
	private handover: Promise<void> | null = null;

	async takeFromPlayer() {
		const session = ++this.session;
		// Left and opened again quickly: first the song back in the player
		await this.handover;
		if (session !== this.session) return;
		const song = get(currentSong).song;
		if (!song || this.leading()) return;
		const audio = get(songQueue).audio;
		const playing = !!audio && !audio.paused;
		const deck = this.decks.A;
		deck.pickedByUser = false;
		await deck.load(song);
		// Left again while it loaded: the player keeps playing, the deck stays quiet
		if (session !== this.session || !get(djOpen)) return;
		if (deck.state.error || deck.state.song !== song) return;
		const now = get(songQueue).audio;
		deck.seek(now?.currentTime ?? audio?.currentTime ?? 0);
		// Heard right away: the crossfader on deck A and its channel up (a mix could have
		// left them on B)
		this.cancelMix();
		this.setCrossfader(0);
		if (deck.state.volume < 0.5) deck.set({ volume: 1 });
		// As loud as the player was: songs it hadn't measured yet played without normalization
		deck.startAtLevel(gainOf(now ?? audio));
		if (playing && now && !now.paused) deck.play();
		this.autoFromPlayer();
	}

	/**
	 * Leaving the DJ mode: the song that plays goes back to the player where it is, in the
	 * queue, and plays on there; the decks stop when it does
	 */
	handToPlayer() {
		this.session++;
		const handover = this.giveBack().finally(() => {
			if (this.handover === handover) this.handover = null;
		});
		this.handover = handover;
		return handover;
	}

	private async giveBack() {
		const lead = this.leading();
		const song = lead?.state.song;
		if (!lead || !song || !lead.state.playing) return this.stopAll();
		const position = lead.position();
		const q = get(songQueue);
		let queue = q.queue ?? [];
		let index = queue.findIndex((s) => sameSong(s, song));
		if (index < 0) {
			// A song from the DJ's browser: it plays first, then the queue goes on
			queue = [song, ...queue];
			index = 0;
		}
		this.cancelMix();
		this.stopAuto();
		try {
			// (a little later: the player needs a moment to start)
			await setSongQueue(
				index,
				queue,
				q.type ?? 'playlist',
				q.playlistId ?? null,
				true,
				position + 0.2
			);
		} finally {
			this.decks.A.pause();
			this.decks.B.pause();
		}
	}

	/** Leaving the DJ mode: everything stops */
	stopAll() {
		this.cancelMix();
		this.stopAuto();
		this.decks.A.pause();
		this.decks.B.pause();
	}

	destroy() {
		clearInterval(this.timer);
	}
}

let mixer: Mixer | null = null;

/** The DJ mixer (made the first time; needs a click before, for the browser's audio) */
export function djMixer() {
	mixer ??= new Mixer();
	return mixer;
}

/** Whether the DJ mode is open */
export const djOpen = writable(false);

/** How long Auto DJ waits with a mix after the user touched the decks */
const USER_QUIET_MS = 10000;
