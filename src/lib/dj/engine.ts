// The DJ mode's sound: two decks playing songs from the disk through a mixer (gain, three
// band EQ with kills, a filter, echo and reverb, channel faders, a crossfader, a limiter).
// Beatmaps bring an exact beat grid, so tempo sync, beat-aligned loops, cues and mixes that
// start on the bar work like in DJ software. Mixes are automated over a number of bars.

import { get, writable } from 'svelte/store';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { mapDataStore } from '../stores/data';
import { songQueue } from '../stores/audio';
import { userSettings } from '../stores/user';
import { gainFor } from '../stores/loudness';
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
import type { MapSet } from '../types';

export type DeckId = 'A' | 'B';

export const EQ_MIN = -26;
export const EQ_MAX = 6;
const KILL_DB = -60;
export const HOT_CUES = 8;
export const TEMPO_RANGES = [0.08, 0.16, 0.5];

export type TransitionType = 'crossfade' | 'bassswap' | 'filter' | 'echo' | 'cut';
export const TRANSITIONS: { id: TransitionType; name: string; description: string }[] = [
	{
		id: 'bassswap',
		name: 'Bass swap',
		description: 'Both play, the basslines swap on the middle bar'
	},
	{ id: 'crossfade', name: 'Crossfade', description: 'A smooth fade from one to the other' },
	{
		id: 'filter',
		name: 'Filter sweep',
		description: 'The old one thins out, the new one opens up'
	},
	{ id: 'echo', name: 'Echo out', description: 'The old one echoes away, the new one takes over' },
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
	kiai: []
});

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

export class Deck {
	readonly id: DeckId;
	state: DeckState = freshState();
	buffer: AudioBuffer | null = null;
	grid: Grid = [];
	peaks: Peaks | null = null;
	/** Loudness normalization */
	private normalize = 1;

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
	private onChange: () => void;
	onPlay: () => void = () => {};

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
			this.normalize = map.loudness != null ? gainFor(map.loudness) : 1;
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
		return this.rate * (1 + this.bend);
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
		for (const factor of [1, 2, 0.5, 1.5, 2 / 3]) {
			const rate = (target * factor) / own;
			if (rate >= 0.85 && rate <= 1.15) return { rate, factor };
		}
		return null;
	}

	/** Takes the other deck's tempo and lines up the beats and bars with it */
	sync(master: Deck) {
		const match = this.matchRate(master);
		if (!match) return false;
		this.setTempo(match.rate - 1, true);
		this.state = { ...this.state, synced: true };
		if (this.state.playing && master.state.playing) this.alignTo(master, match.factor === 1);
		this.emit();
		return true;
	}

	/** Moves the song so its beats (and bars) fall on the other deck's */
	alignTo(master: Deck, bars = true) {
		const m = phaseAt(master.grid, master.position());
		const s = phaseAt(this.grid, this.position());
		if (!m || !s) return;
		let shift: number;
		if (bars && m.point.meter === s.point.meter) {
			const meter = s.point.meter;
			shift = m.barBeats - s.barBeats;
			if (shift > meter / 2) shift -= meter;
			if (shift < -meter / 2) shift += meter;
		} else {
			shift = m.beatPhase - s.beatPhase;
			if (shift > 0.5) shift -= 1;
			if (shift < -0.5) shift += 1;
		}
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
		smooth(this.echoWet.gain, s.echo * 0.9);
		smooth(this.echoFeedback.gain, s.echo > 0 ? 0.35 + s.echo * 0.3 : 0);
		smooth(this.reverbWet.gain, s.reverb * 0.8);
		// The fader feels like a real one: quiet at the bottom
		smooth(this.fader.gain, s.volume * s.volume);
		this.applyEcho();
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
}

export const dj = writable<DjState | null>(null);

class Mixer {
	ctx: AudioContext;
	decks: Record<DeckId, Deck>;
	private master: GainNode;
	private recordGain!: GainNode;
	readonly analyser: AnalyserNode;
	private stream: MediaStreamAudioDestinationNode;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recordStart = 0;
	crossfader = 0.5;
	masterLevel = 0.85;
	transition: TransitionState | null = null;
	transitionType: TransitionType = 'bassswap';
	transitionBars = 16;
	auto: AutoDjState = { on: false, queue: [], index: -1, source: '' };
	private timer: ReturnType<typeof setInterval>;
	/** What the decks were like before a mix changed them, to put back after */
	private before: Partial<Record<DeckId, Partial<DeckState>>> = {};

	constructor() {
		const ctx = audioContext();
		this.ctx = ctx;
		const bus = ctx.createGain();
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
		this.master.gain.setTargetAtTime(this.masterLevel * app, this.ctx.currentTime, 0.02);
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

	/** The deck that's heard: the playing one (the louder side if both play) */
	leading(): Deck | null {
		const { A, B } = this.decks;
		if (A.state.playing && !B.state.playing) return A;
		if (B.state.playing && !A.state.playing) return B;
		if (A.state.playing && B.state.playing) return this.crossfader <= 0.5 ? A : B;
		return null;
	}

	/**
	 * Mixes from the playing deck to the other one: matches its tempo, starts it on the next
	 * bar of the playing one (from its cue) and blends them over some bars
	 */
	mix(type = this.transitionType, bars = this.transitionBars) {
		const from = this.leading();
		if (!from || this.transition) return false;
		const to = this.other(from.id);
		if (!to.buffer) return false;
		const match = to.matchRate(from);
		// Too different to beat-match: a quick echo out or cut works best
		if (!match && (type === 'bassswap' || type === 'crossfade' || type === 'filter')) type = 'echo';
		if (match) to.setTempo(match.rate - 1, true);
		const section = sectionAt(from.grid, from.position());
		const beatSeconds = (section?.beat ?? 0.5) / from.rate;
		const meter = section?.meter ?? 4;
		let start = this.ctx.currentTime + 0.05;
		if (!to.state.playing) {
			if (match && section) {
				// On the next bar of the playing song
				const pos = from.position();
				const downbeat = nextDownbeat(from.grid, pos, 0.15);
				start = this.ctx.currentTime + (downbeat - pos) / from.rate;
			}
			to.seek(to.state.hotCues[0] ?? to.state.cue);
			to.play(start);
		} else if (match) {
			to.alignTo(from, match.factor === 1);
		}
		const length = type === 'cut' ? beatSeconds : bars * meter * beatSeconds;
		this.before[from.id] = {
			eq: from.state.eq,
			kill: from.state.kill,
			filter: from.state.filter,
			echo: from.state.echo,
			volume: from.state.volume
		};
		this.before[to.id] = {
			eq: to.state.eq,
			kill: to.state.kill,
			filter: to.state.filter,
			echo: to.state.echo
		};
		to.set({ volume: Math.max(to.state.volume, 0.9) });
		this.transition = {
			from: from.id,
			to: to.id,
			type,
			bars,
			start,
			end: start + length
		};
		this.emit();
		return true;
	}

	/** Stops a mix where it is */
	cancelMix() {
		if (!this.transition) return;
		this.decks[this.transition.from].setDry(1);
		this.transition = null;
		this.emit();
	}

	/** Moves the controls along the mix */
	private stepTransition() {
		const t = this.transition!;
		const from = this.decks[t.from];
		const to = this.decks[t.to];
		const now = this.ctx.currentTime;
		const p = Math.max(0, Math.min(1, (now - t.start) / (t.end - t.start || 1)));
		if (now < t.start) return;
		const fromSide = t.from === 'A' ? 0 : 1;
		const toSide = 1 - fromSide;
		const lerp = (a: number, b: number, x: number) => a + (b - a) * Math.max(0, Math.min(1, x));
		const was = this.before;
		switch (t.type) {
			case 'crossfade':
				this.setCrossfader(lerp(fromSide, toSide, p));
				break;
			case 'bassswap': {
				// In the middle both play; the basslines swap on the middle bar
				this.setCrossfader(p < 0.5 ? lerp(fromSide, 0.5, p * 2) : lerp(0.5, toSide, (p - 0.5) * 2));
				const swapped = p >= 0.5;
				if (to.state.kill.low === swapped || from.state.kill.low !== swapped) {
					to.set({ kill: { ...to.state.kill, low: !swapped } });
					from.set({ kill: { ...from.state.kill, low: swapped } });
				}
				break;
			}
			case 'filter':
				from.set({ filter: lerp(was[t.from]?.filter ?? 0, 0.85, p) });
				to.set({ filter: lerp(-0.8, 0, p / 0.7) });
				this.setCrossfader(lerp(fromSide, toSide, (p - 0.3) / 0.7));
				break;
			case 'echo':
				// The old one echoes for a moment, then stops: only its echo rings out
				from.set({ echo: lerp(0, 0.85, p / 0.3) });
				this.setCrossfader(lerp(fromSide, 0.5, p / 0.3));
				if (p >= 0.3 && from.state.playing) from.pause();
				break;
			case 'cut':
				this.setCrossfader(toSide);
				break;
		}
		if (p >= 1) this.finishMix();
	}

	private finishMix() {
		const t = this.transition!;
		const from = this.decks[t.from];
		const to = this.decks[t.to];
		const echo = t.type === 'echo';
		this.transition = null;
		// The old deck stops and gets its sound back; after an echo out, once it rang out
		const done = () => {
			this.setCrossfader(t.to === 'A' ? 0 : 1);
			from.pause();
			from.setDry(1);
			from.set({
				...this.before[t.from],
				echo: 0,
				kill: { low: false, mid: false, high: false },
				filter: 0
			});
		};
		if (echo) setTimeout(done, 3000);
		else done();
		to.set({ kill: { ...to.state.kill, low: false }, filter: 0 });
		this.emit();
	}

	// --- Auto DJ -------------------------------------------------------------------------------

	startAuto(queue: MapSet[], source: string) {
		this.auto = { on: true, queue, index: -1, source };
		const playing = this.leading();
		if (!playing) {
			this.auto.index = 0;
			const deck = this.decks.A;
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

	/** When the playing song should start mixing out: the bars before its end */
	private mixOutPoint(deck: Deck) {
		const duration = deck.state.duration;
		const section = sectionAt(deck.grid, duration);
		const bar = (section?.beat ?? 0.5) * (section?.meter ?? 4);
		const bars = this.transitionType === 'cut' ? 1 : this.transitionBars;
		// Mixed before the last bar or two, on a bar
		const at = duration - bar * (bars + 2);
		const start = section ? section.time + Math.floor((at - section.time) / bar) * bar : at;
		return Math.max(deck.state.cue + bar * 4, start);
	}

	private autoBusy = false;

	private async autoStep() {
		if (!this.auto.on || this.autoBusy || this.transition) return;
		const playing = this.leading();
		const queue = this.auto.queue;
		if (!queue.length) return;
		if (!playing) return;
		const next = this.other(playing.id);
		const nextIndex = (this.auto.index + 1) % queue.length;
		// The next song waits on the other deck
		if (next.state.song?.id !== queue[nextIndex]?.id || next.state.error) {
			if (next.state.loading) return;
			this.autoBusy = true;
			try {
				await next.load(queue[nextIndex]);
			} finally {
				this.autoBusy = false;
			}
			return;
		}
		if (next.state.loading || !next.buffer || next.state.playing) return;
		if (playing.position() >= this.mixOutPoint(playing)) {
			if (this.mix()) {
				this.auto = { ...this.auto, index: nextIndex };
				this.emit();
			}
		}
	}

	private tick() {
		if (this.transition) this.stepTransition();
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
