// The DJ mode's sound: two decks playing songs from the disk through a mixer (gain, a three
// band isolator EQ with kills, a filter, echo and reverb, channel faders, a crossfader, a
// limiter). Beatmaps bring an exact beat grid (checked against the audio), so tempo sync,
// beat-aligned loops, cues and mixes on the phrase work like in DJ software.
// Each deck plays a timeline planned on the audio clock (player.ts), with key lock. Mixes are
// planned from the two songs' structure (mixplan.ts) and their moves are put on the audio
// clock ahead of time (automation.ts): they sound exactly as planned, to the sample.

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
	beatIndex,
	beatRound,
	beatTime,
	bpmOf,
	gridFrom,
	mainSection,
	phaseAt,
	sectionAt,
	shiftGrid,
	type Grid
} from './grid';
import { computePeaks, type Peaks } from './peaks';
import { decodeAudio } from '../audioDecode';
import { analyzeSong, barCeil, barIndex, roughAnalysis, type SongAnalysis } from './analysis';
import { Player, placeAt, type Segment } from './player';
import {
	planMix,
	tempoFit,
	type DeckView,
	type Fit,
	type MixPlan,
	type MixStyle,
	type TransitionType
} from './mixplan';
import { mixCurves, NEUTRAL, valueAt, type Curves, type MixParam } from './automation';
import type { MapSet } from '../types';

export type { TransitionType, MixStyle, MixPlan, Fit };
export type DeckId = 'A' | 'B';

/** The master level the DJ mode starts with */
const DEFAULT_MASTER = 0.85;

export const EQ_MIN = -26;
export const EQ_MAX = 6;
export const HOT_CUES = 8;
export const TEMPO_RANGES = [0.08, 0.16, 0.5];

/** Changes to a playing deck take effect this far ahead (s), so they're exactly on time */
const LEAD = 0.03;
/** Isolator EQ crossovers (Hz) */
const LOW_CUT = 200;
const HIGH_CUT = 2500;

export const TRANSITIONS: { id: TransitionType; name: string; description: string }[] = [
	{
		id: 'smart',
		name: 'Smart',
		description:
			"Mixes like a DJ: on the songs' phrases, the new song's intro under the old one's outro, the tempos matched with key lock, the move that fits the two songs"
	},
	{
		id: 'blend',
		name: 'Blend',
		description: 'The new song comes in under the old one, the basslines swap on a phrase'
	},
	{
		id: 'filter',
		name: 'Filter',
		description: 'The new song opens up as the old one thins out'
	},
	{ id: 'crossfade', name: 'Crossfade', description: 'A smooth fade from one to the other' },
	{
		id: 'build',
		name: 'Build-up',
		description:
			'The old song builds up (thinning out into reverb and echo), the new one drops in on the one'
	},
	{
		id: 'echo',
		name: 'Echo out',
		description: 'The old song echoes away, the new one comes in on the one'
	},
	{
		id: 'wash',
		name: 'Wash out',
		description: 'The old song washes away in reverb, the new one comes in on the one'
	},
	{
		id: 'brake',
		name: 'Brake',
		description: 'The old song stops like a record, the new one comes in on the one'
	},
	{ id: 'cut', name: 'Cut', description: 'A hard switch on the one' }
];

/** The name of a mix's style */
export const STYLE_NAMES: Record<MixStyle, string> = {
	blend: 'Blend',
	filter: 'Filter blend',
	crossfade: 'Crossfade',
	build: 'Build-up',
	echo: 'Echo out',
	wash: 'Wash out',
	brake: 'Brake',
	cut: 'Cut',
	segue: 'Segue'
};

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
	// Suspended, or interrupted (Safari's WebKit, e.g. after the Mac slept): on again
	if (context.state !== 'running' && context.state !== 'closed') context.resume().catch(() => {});
	return context;
}

/** A reverb's sound: decaying noise */
function impulse(ctx: BaseAudioContext, seconds = 2.4) {
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

/** The time a list of playing segments gets to a point of the song (s on the audio clock) */
function timeOn(segments: Segment[], songTime: number) {
	for (let i = segments.length - 1; i >= 0; i--) {
		const s = segments[i];
		if (!s.playing || s.rate <= 0) continue;
		if (songTime >= s.input - 1e-9 || i === 0) return s.at + (songTime - s.input) / s.rate;
	}
	return segments[0]?.at ?? 0;
}

export class Deck {
	readonly id: DeckId;
	state: DeckState = freshState();
	buffer: AudioBuffer | null = null;
	grid: Grid = [];
	peaks: Peaks | null = null;
	/** The loudness normalization's factor for this song */
	normalize = 1;
	/** The song's structure and key (see analysis.ts), once worked out */
	analysis: SongAnalysis | null = null;
	/** What plays when (null until the player started) */
	player: Player | null = null;
	readonly ready: Promise<Player>;
	/** Played faster or slower, songs keep their pitch */
	keyLock = true;

	private ctx: BaseAudioContext;
	private input: GainNode;
	private bands: Record<'low' | 'mid' | 'high', { user: GainNode; auto: GainNode }>;
	private userLowpass: BiquadFilterNode;
	private userHighpass: BiquadFilterNode;
	private autoLowpass: BiquadFilterNode;
	private autoHighpass: BiquadFilterNode;
	private dry: GainNode;
	private echoSend: GainNode;
	private echoSendAuto: GainNode;
	private echoDelay: DelayNode;
	private echoFeedback: GainNode;
	private reverbSend: GainNode;
	private reverbSendAuto: GainNode;
	private autoVolume: GainNode;
	private fader: GainNode;
	/** The crossfader's part */
	readonly xfade: GainNode;
	readonly analyser: AnalyserNode;

	/** Temporary tempo push (nudge, jog) and the sync lock's small pushes */
	private bend = 0;
	private autoBend = 0;
	private braking = false;
	private loadId = 0;
	/** Loaded by the user (not Auto DJ): Auto DJ plays it next instead of its own pick */
	pickedByUser = false;
	/** The cue was set by the user (else it's the first beat) */
	private cueSet = false;
	/** A mix's moves on this deck, and until when its echo is the mix's */
	private curves: Curves | null = null;
	private curvesRest = 0;
	private echoMixUntil = 0;
	/** Until when a play or pause by hand is still on its way to the timeline */
	private settleAt = 0;
	private onChange: () => void;
	onPlay: () => void = () => {};
	beforePlay: (deck: Deck) => void = () => {};

	constructor(
		id: DeckId,
		ctx: BaseAudioContext,
		output: AudioNode,
		reverb: AudioBuffer,
		onChange: () => void
	) {
		this.id = id;
		this.ctx = ctx;
		this.onChange = onChange;
		const gain = (value = 1) => {
			const g = ctx.createGain();
			g.gain.value = value;
			return g;
		};
		// (a low- or high-pass's Q is in dB here: -3.01 dB is Butterworth, two make Linkwitz–Riley)
		const filter = (type: BiquadFilterType, frequency: number, q = -3.0103) => {
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = frequency;
			f.Q.value = q;
			return f;
		};
		this.input = gain();
		// The isolator: three bands split by Linkwitz–Riley crossovers (they add up flat), each
		// with the user's knob and the mix's moves; a kill takes the band out completely
		const sum = gain();
		const band = (...chain: BiquadFilterNode[]) => {
			let node: AudioNode = this.input;
			for (const f of chain) node = node.connect(f);
			const user = gain();
			const auto = gain();
			node.connect(user).connect(auto).connect(sum);
			return { user, auto };
		};
		this.bands = {
			low: band(filter('lowpass', LOW_CUT), filter('lowpass', LOW_CUT)),
			mid: band(
				filter('highpass', LOW_CUT),
				filter('highpass', LOW_CUT),
				filter('lowpass', HIGH_CUT),
				filter('lowpass', HIGH_CUT)
			),
			high: band(filter('highpass', HIGH_CUT), filter('highpass', HIGH_CUT))
		};
		this.userLowpass = filter('lowpass', 22000, 0.9);
		this.userHighpass = filter('highpass', 10, 0.9);
		this.autoLowpass = filter('lowpass', NEUTRAL.lp, 0.8);
		this.autoHighpass = filter('highpass', NEUTRAL.hp, 0.8);
		const tap = sum
			.connect(this.userLowpass)
			.connect(this.userHighpass)
			.connect(this.autoLowpass)
			.connect(this.autoHighpass);
		const post = gain();
		this.dry = gain();
		tap.connect(this.dry).connect(post);
		// Echo and reverb are sends: turned off, what's in them rings out
		this.echoSend = gain(0);
		this.echoSendAuto = gain(0);
		this.echoDelay = ctx.createDelay(4);
		this.echoFeedback = gain(0.45);
		const echoWet = gain(0.85);
		tap.connect(this.echoSend).connect(this.echoDelay);
		tap.connect(this.echoSendAuto).connect(this.echoDelay);
		this.echoDelay.connect(this.echoFeedback).connect(this.echoDelay);
		this.echoDelay.connect(echoWet).connect(post);
		const convolver = ctx.createConvolver();
		convolver.buffer = reverb;
		this.reverbSend = gain(0);
		this.reverbSendAuto = gain(0);
		const reverbWet = gain(0.8);
		tap.connect(this.reverbSend).connect(convolver);
		tap.connect(this.reverbSendAuto).connect(convolver);
		convolver.connect(reverbWet).connect(post);
		this.autoVolume = gain();
		this.fader = gain();
		this.xfade = gain();
		this.analyser = ctx.createAnalyser();
		this.analyser.fftSize = 1024;
		post.connect(this.autoVolume).connect(this.fader).connect(this.xfade).connect(output);
		this.fader.connect(this.analyser);
		this.ready = Player.create(ctx).then((player) => {
			player.output.connect(this.input);
			this.player = player;
			return player;
		});
		this.apply();
	}

	private emit() {
		this.onChange();
	}

	/** Whether the cue was set by the user (else it's the first beat) */
	get cueByUser() {
		return this.cueSet;
	}

	/** Whether this deck's songs keep their pitch when faster or slower */
	get canKeyLock() {
		return !!this.player?.canKeyLock;
	}

	// --- Loading ---------------------------------------------------------------------------

	async load(song: MapSet) {
		const id = ++this.loadId;
		const keep = { volume: this.state.volume, tempoRange: this.state.tempoRange };
		this.state = { ...freshState(), ...keep, song, loading: true };
		this.buffer = null;
		this.peaks = null;
		this.analysis = null;
		this.grid = [];
		this.cueSet = false;
		this.bend = this.autoBend = 0;
		const player = await this.ready;
		player.setBuffer(null);
		this.apply();
		this.emit();
		try {
			const stored = get(mapDataStore)[song.id];
			const mapId = String(song.beatmaps?.[0]?.id ?? '');
			const map = stored?.beatmaps?.[mapId]?.audioFile
				? stored.beatmaps[mapId]
				: Object.values(stored?.beatmaps ?? {}).find((m) => m.audioFile);
			if (!map?.audioFile) throw new Error('Download the song to mix it');
			const buffer = await decodeAudio(this.ctx, await readAudio(map.audioFile));
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
			await this.take(id, buffer, timing, kiai ?? [], lufs, map.audioFile);
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

	/** A decoded song on the deck: its grid, cue, waveform, and (a moment later) its analysis */
	private async take(
		id: number,
		buffer: AudioBuffer,
		timing: { time: number; beatLength: number; meter?: number }[] | undefined,
		kiai: { start: number; end: number }[],
		lufs: number | null,
		file: string
	) {
		const player = await this.ready;
		await player.setBuffer(buffer);
		if (id !== this.loadId) return;
		this.buffer = buffer;
		this.grid = gridFrom(timing);
		// Like the player: only with the loudness normalization on (it's a setting)
		const normalizing = get(userSettings).settings?.normalize ?? true;
		this.normalize = normalizing && lufs != null ? gainFor(lufs) : 1;
		const main = mainSection(this.grid, buffer.duration);
		const cue = this.firstBeat();
		player.change(this.ctx.currentTime, { playing: false, input: cue, rate: 1, loop: null });
		this.state = {
			...this.state,
			loading: false,
			duration: buffer.duration,
			baseBpm: bpmOf(main),
			cue,
			kiai: kiai.map((k) => ({ start: k.start / 1000, end: k.end / 1000 }))
		};
		this.apply();
		this.emit();
		const peaks = await computePeaks(buffer);
		if (id === this.loadId) {
			this.peaks = peaks;
			this.emit();
		}
		// What a DJ hears in it: where its beats are, energy, intro, peaks, outro, phrases, key
		const analysis =
			analysed.get(file) ??
			(await analyzeSong(buffer, this.grid, this.state.kiai, cue).catch((error) => {
				console.warn('Could not analyse the song', error);
				return null;
			}));
		if (analysis) analysed.set(file, analysis);
		if (id !== this.loadId || !analysis) return;
		this.analysis = analysis;
		if (analysis.shift) {
			// The beatmap's beats a little off the audio: the grid (and the cue) where they are
			const shift = analysis.shift;
			this.grid = shiftGrid(this.grid, shift);
			const kiaiShifted = this.state.kiai.map((k) => ({
				start: k.start + shift,
				end: k.end + shift
			}));
			const moved = !this.cueSet ? this.firstBeat() : this.state.cue;
			if (!this.state.playing && Math.abs(this.position() - this.state.cue) < 0.01)
				player.change(this.ctx.currentTime, { input: moved });
			this.state = { ...this.state, cue: moved, kiai: kiaiShifted };
		}
		this.state = { ...this.state, key: analysis.key?.camelot ?? null };
		this.emit();
	}

	/** The song's first beat on the grid (most songs start with a little silence) */
	private firstBeat() {
		const first = this.grid[0];
		if (!first) return 0;
		const bar = first.beat * first.meter;
		let cue = first.time;
		while (cue < 0) cue += bar;
		return cue;
	}

	/** A song the user chose (Auto DJ plays it next) */
	userLoad(song: MapSet) {
		this.pickedByUser = true;
		return this.load(song);
	}

	eject() {
		this.loadId++;
		this.player?.setBuffer(null);
		const keep = { volume: this.state.volume, tempoRange: this.state.tempoRange };
		this.state = { ...freshState(), ...keep };
		this.buffer = null;
		this.peaks = null;
		this.analysis = null;
		this.grid = [];
		this.apply();
		this.emit();
	}

	// --- Playing ---------------------------------------------------------------------------

	/** The tempo fader's rate */
	get rate() {
		return 1 + this.state.tempo;
	}

	/** The rate it plays at: the tempo fader, nudges and the sync lock's pushes */
	get liveRate() {
		return this.rate * (1 + this.bend + this.autoBend);
	}

	/** When a change made now takes effect: a moment ahead while it plays, else now */
	private changeAt() {
		return this.ctx.currentTime + (this.state.playing ? LEAD : 0);
	}

	/** Changes what plays from a moment on (anything planned after it is dropped) */
	private change(change: Partial<Omit<Segment, 'at'>>, at = this.changeAt()) {
		return this.player?.change(at, { keyLock: this.keyLock, ...change });
	}

	/** Where the song is (s) at a time of the audio clock (now); in a loop, inside it */
	position(time = this.ctx.currentTime) {
		if (!this.player) return 0;
		return Math.min(this.player.position(time), this.state.duration || Infinity);
	}

	/** The tempo now (BPM), as it plays */
	bpm(at = this.position()) {
		const rate = this.player?.segmentAt().rate ?? this.rate;
		return (bpmOf(sectionAt(this.grid, at)) || this.state.baseBpm) * rate;
	}

	/** Plays; with a time of the audio clock, starts exactly then */
	play(when?: number) {
		if (!this.buffer || !this.player || this.state.playing) return;
		audioContext();
		if (this.position() >= this.state.duration - 0.05) this.change({ input: this.state.cue });
		// Started by hand while synced: on the other deck's beat
		if (when === undefined) this.beforePlay(this);
		const at = when ?? this.ctx.currentTime + LEAD;
		const segment = this.change({ playing: true, rate: this.liveRate, loop: this.loopRange() }, at);
		this.settleAt = segment?.at ?? at;
		this.state = { ...this.state, playing: true };
		this.onPlay();
		this.emit();
	}

	pause() {
		if (!this.state.playing) return;
		this.braking = false;
		const at = this.changeAt();
		this.settleAt = this.change({ playing: false }, at)?.at ?? at;
		this.state = { ...this.state, playing: false };
		this.emit();
	}

	toggle() {
		if (this.state.playing) this.pause();
		else this.play();
	}

	seek(time: number) {
		const to = Math.max(-30, Math.min(this.state.duration, time));
		this.change({ input: to });
		this.emit();
	}

	/** Jumps a number of beats (negative: back), keeping the beat */
	beatJump(beats: number) {
		const section = sectionAt(this.grid, this.position());
		if (!section) return;
		this.seek(this.position(this.changeAt()) + beats * section.beat);
	}

	setTempo(tempo: number, keepSync = false) {
		const range = Math.max(this.state.tempoRange, Math.abs(tempo));
		this.state = {
			...this.state,
			tempo,
			tempoRange: TEMPO_RANGES.find((r) => r >= range) ?? 0.5,
			synced: keepSync ? this.state.synced : false
		};
		if (this.state.playing) this.change({ rate: this.liveRate });
		this.emit();
	}

	/** Pushes the tempo for a moment (nudge or jog), to line up beats by ear */
	setBend(bend: number) {
		// Pushing it by hand: the user leads now, not the sync lock
		if (bend !== 0 && this.state.synced) this.unsync();
		if (bend === this.bend) return;
		this.bend = bend;
		if (this.state.playing) this.change({ rate: this.liveRate });
	}

	/** Small tempo pushes by the sync lock to stay on the beat */
	setAutoBend(bend: number) {
		if (bend === this.autoBend) return;
		this.autoBend = bend;
		if (this.state.playing) this.change({ rate: this.liveRate });
	}

	get userBending() {
		return this.bend !== 0;
	}

	/** Pushed or braking: its rate isn't the tempo fader's */
	get pushed() {
		return this.bend !== 0 || this.autoBend !== 0 || this.braking;
	}

	setKeyLock(on: boolean) {
		this.keyLock = on;
		if (this.state.playing) this.change({});
	}

	/** Follows its timeline (a mix plays it, speeds it up, stops it): what the deck shows */
	follow(now: number) {
		if (!this.player || !this.buffer) return false;
		const segment = this.player.segmentAt(now);
		let changed = false;
		let playing = segment.playing;
		if (playing && !segment.loop && this.position(now) >= this.state.duration - 0.005) {
			// The song is over
			this.change({ playing: false, input: this.state.duration }, now);
			playing = false;
		}
		// (played or paused by hand a moment ago: the timeline isn't there yet, and a deck that
		// was just paused mustn't count as started again, which would stop the player)
		if (playing !== this.state.playing && now >= this.settleAt) {
			this.state = { ...this.state, playing };
			if (playing) this.onPlay();
			else this.braking = false;
			changed = true;
		}
		if (playing && !this.pushed) {
			const tempo = segment.rate - 1;
			if (Math.abs(tempo - this.state.tempo) > 0.0004) {
				const range = Math.max(this.state.tempoRange, Math.abs(tempo));
				this.state = {
					...this.state,
					tempo,
					tempoRange: TEMPO_RANGES.find((r) => r >= range) ?? 0.5
				};
				changed = true;
			}
		}
		return changed;
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
			this.cueSet = true;
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
			const pos = this.position(this.changeAt());
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

	private loopRange() {
		const loop = this.state.loop;
		return loop ? { start: loop.start, end: loop.end } : null;
	}

	/** A loop of some beats from the beat the song is in; again to leave it */
	loop(beats: number) {
		if (!this.buffer) return;
		if (this.state.loop?.beats === beats) {
			this.exitLoop();
			return;
		}
		this.loopBeats(beats);
	}

	private setLoopRange(start: number, end: number, beats: number) {
		this.state = { ...this.state, loop: { start, end, beats } };
		this.change({ loop: { start, end } });
		this.emit();
	}

	/** A loop of a number of beats from where the loop starts (or this beat) */
	loopBeats(beats: number) {
		if (!this.buffer) return;
		const pos = this.position(this.changeAt());
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
		this.state = { ...this.state, loop: null };
		this.change({ loop: null });
		this.emit();
	}

	// --- Sync ------------------------------------------------------------------------------

	/** The tempo that matches another deck: the same, or double or half for very different
	 * tempos. Null if they're too far apart */
	matchRate(master: Deck) {
		const own = bpmOf(sectionAt(this.grid, this.position())) || this.state.baseBpm;
		const target = master.bpm();
		if (!own || !target) return null;
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
	 * How many of its own beats this deck is off the other one's grid at a time of the audio
	 * clock (positive: it's behind). With the same tempo, bars line up too; at double or half
	 * tempo, beats do.
	 */
	phaseOffset(master: Deck, factor = 1, bars = true, time = this.ctx.currentTime) {
		const m = phaseAt(master.grid, master.position(time));
		const s = phaseAt(this.grid, this.position(time));
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

	/** Puts the paused song where it starts (a moment after play) on the other deck's beat */
	alignPaused(master: Deck) {
		const match = this.matchRate(master);
		if (!match || this.state.playing) return;
		const pos = this.position();
		const s = phaseAt(this.grid, pos);
		if (!s) return;
		const time = this.ctx.currentTime + LEAD;
		const shift = this.phaseOffset(master, match.factor, match.factor === 1, time);
		this.change({ input: pos + shift * s.point.beat });
		this.emit();
	}

	/** Moves the song so its beats (and bars) fall on the other deck's */
	alignTo(master: Deck, bars = true) {
		const match = this.matchRate(master);
		const time = this.changeAt();
		const pos = this.position(time);
		const s = phaseAt(this.grid, pos);
		if (!s) return;
		const shift = this.phaseOffset(master, match?.factor ?? 1, bars, time);
		if (Math.abs(shift) < 0.002) return;
		this.change({ input: pos + shift * s.point.beat }, time);
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

	// --- Mixer controls --------------------------------------------------------------------

	set(change: Partial<DeckState>) {
		this.state = { ...this.state, ...change };
		this.apply();
		this.emit();
	}

	private applyEcho() {
		if (this.ctx.currentTime < this.echoMixUntil) return;
		const section = sectionAt(this.grid, this.position());
		const beat = (section?.beat ?? 0.5) / this.rate;
		const now = this.ctx.currentTime;
		this.echoDelay.delayTime.setTargetAtTime(Math.min(3.9, beat * 0.75), now, 0.05);
		this.echoFeedback.gain.setTargetAtTime(0.42 + this.state.echo * 0.25, now, 0.05);
	}

	/** Puts the controls' values on the sound */
	apply() {
		const s = this.state;
		const now = this.ctx.currentTime;
		const smooth = (param: AudioParam, value: number) => param.setTargetAtTime(value, now, 0.012);
		smooth(this.input.gain, this.normalize * dbToGain(s.gain));
		for (const band of ['low', 'mid', 'high'] as const)
			smooth(this.bands[band].user.gain, s.kill[band] ? 0 : dbToGain(s.eq[band]));
		// The filter: down from 22 kHz to the left, up from 10 Hz to the right
		const amount = Math.abs(s.filter);
		smooth(this.userLowpass.frequency, s.filter < 0 ? 22000 * Math.pow(60 / 22000, amount) : 22000);
		smooth(this.userHighpass.frequency, s.filter > 0 ? 10 * Math.pow(8000 / 10, amount) : 10);
		smooth(this.echoSend.gain, s.echo);
		smooth(this.reverbSend.gain, s.reverb);
		// The fader feels like a real one: quiet at the bottom
		smooth(this.fader.gain, s.volume * s.volume);
		this.applyEcho();
	}

	// --- A mix's moves ---------------------------------------------------------------------

	private mixParams(): Record<MixParam, AudioParam> {
		return {
			low: this.bands.low.auto.gain,
			mid: this.bands.mid.auto.gain,
			high: this.bands.high.auto.gain,
			hp: this.autoHighpass.frequency,
			lp: this.autoLowpass.frequency,
			dry: this.dry.gain,
			vol: this.autoVolume.gain,
			echo: this.echoSendAuto.gain,
			reverb: this.reverbSendAuto.gain
		};
	}

	/** Puts a mix's moves on the audio clock; at `rest` they're all back where they rest */
	scheduleCurves(curves: Curves, rest: number) {
		this.releaseCurves(0);
		const now = this.ctx.currentTime;
		const params = this.mixParams();
		for (const [name, list] of Object.entries(curves) as [MixParam, Curves[MixParam]][]) {
			if (!list?.length) continue;
			const param = params[name];
			const points = [...list].sort((x, y) => x.t - y.t);
			param.cancelScheduledValues(now);
			param.setValueAtTime(NEUTRAL[name], now);
			let first = true;
			for (const point of points) {
				const t = Math.max(point.t, now);
				if (first) param.setValueAtTime(point.v, t);
				else param.linearRampToValueAtTime(point.v, t);
				first = false;
			}
			param.setValueAtTime(NEUTRAL[name], Math.max(rest, points.at(-1)!.t + 0.001));
		}
		this.curves = curves;
		this.curvesRest = rest;
	}

	/** Stops a mix's moves where they are and brings them back to rest (over some seconds) */
	releaseCurves(over = 0.3) {
		const curves = this.curves;
		this.curves = null;
		if (!curves) return;
		const now = this.ctx.currentTime;
		const params = this.mixParams();
		for (const [name, list] of Object.entries(curves) as [MixParam, Curves[MixParam]][]) {
			const param = params[name];
			const value = now >= this.curvesRest ? NEUTRAL[name] : valueAt(list, now, NEUTRAL[name]);
			param.cancelScheduledValues(now);
			param.setValueAtTime(value, now);
			if (over > 0) param.linearRampToValueAtTime(NEUTRAL[name], now + over);
			else param.setValueAtTime(NEUTRAL[name], now);
		}
	}

	/** Fades the deck out over some seconds (a mix stopped after its swap) */
	fadeOut(seconds: number) {
		const now = this.ctx.currentTime;
		const param = this.autoVolume.gain;
		param.cancelScheduledValues(now);
		param.setValueAtTime(param.value, now);
		param.linearRampToValueAtTime(0, now + seconds);
		param.setValueAtTime(1, now + seconds + 0.1);
		this.change({ playing: false }, now + seconds + 0.05);
	}

	/** The mix's echo (its time and feedback) from a time until another */
	mixEcho(echo: { time: number; feedback: number }, from: number, until: number) {
		this.echoMixUntil = until;
		this.echoDelay.delayTime.cancelScheduledValues(from);
		this.echoFeedback.gain.cancelScheduledValues(from);
		this.echoDelay.delayTime.setValueAtTime(Math.min(3.9, echo.time), from);
		this.echoFeedback.gain.setValueAtTime(echo.feedback, from);
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
		const time = this.changeAt();
		if (on) {
			const pos = this.position(time);
			this.holds.roll = { value: beats, slip: { pos, ctx: time } };
			const beat = sectionAt(this.grid, pos)?.beat ?? 0.5;
			const start = beatFloor(this.grid, pos);
			this.state = {
				...this.state,
				loop: { start, end: start + beats * beat, beats }
			};
			this.change({ loop: { start, end: start + beats * beat } }, time);
			this.emit();
		} else {
			const slip = this.holds.roll?.slip;
			delete this.holds.roll;
			this.state = { ...this.state, loop: null };
			const input = slip ? slip.pos + (time - slip.ctx) * this.liveRate : undefined;
			this.change({ loop: null, ...(input != null ? { input } : {}) }, time);
			this.emit();
		}
	}

	/** A record stopping: slows down to a halt (by a time of the audio clock, or in a second) */
	brake(by?: number, length = 1.1) {
		if (!this.player || !this.state.playing) return;
		const end = by ?? this.ctx.currentTime + LEAD + length;
		const start = Math.max(this.ctx.currentTime + LEAD, end - length);
		const segments = this.brakeSegments(start, end);
		this.player.schedule(segments);
		this.braking = true;
	}

	/** The timeline of a brake: the rate down to nothing (the pitch with it) */
	brakeSegments(start: number, end: number, from = this.player!.segmentAt(start)) {
		const steps = 40;
		const r0 = from.playing ? from.rate : this.liveRate;
		let pos = placeAt(from, start);
		const segments: Segment[] = [];
		const step = (end - start) / steps;
		for (let i = 0; i < steps; i++) {
			const rate = r0 * (1 - (i + 0.5) / steps);
			segments.push({
				at: start + i * step,
				playing: true,
				input: pos,
				rate,
				loop: null,
				keyLock: false
			});
			pos += rate * step;
		}
		segments.push({
			at: end,
			playing: false,
			input: pos,
			rate: r0,
			loop: null,
			keyLock: this.keyLock
		});
		return segments;
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
	type: MixStyle;
	bars: number;
	/** Audio clock times: the new song starts, the swap, all done (the old one's tail rang out) */
	start: number;
	swap: number;
	end: number;
	/** One beat (s, real time) */
	beat: number;
	why: string;
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
	keyLock: boolean;
	/** Whether the key lock runs here */
	canKeyLock: boolean;
	glide: boolean;
}

export const dj = writable<DjState | null>(null);

/** A mix that runs: what it planned, and the decks' timelines as it left them */
interface RunningMix {
	plan: MixPlan;
	from: Deck;
	to: Deck;
	versions: [number, number];
}

export class Mixer {
	ctx: BaseAudioContext;
	decks: Record<DeckId, Deck>;
	private master: GainNode;
	private bus!: GainNode;
	private recordGain!: GainNode;
	readonly analyser: AnalyserNode;
	/** What recordings take (null where the web view can't record) */
	private stream: MediaStreamAudioDestinationNode | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private recordStart = 0;
	crossfader = 0.5;
	masterLevel = DEFAULT_MASTER;
	transition: TransitionState | null = null;
	transitionType: TransitionType = 'smart';
	transitionBars = 16;
	auto: AutoDjState = { on: false, queue: [], index: -1, source: '' };
	/** Played faster or slower, songs keep their pitch */
	keyLock = true;
	/** After a mix, the new song glides back to its own tempo */
	glide = true;
	private timer: ReturnType<typeof setInterval>;
	private running: RunningMix | null = null;
	/** The styles of the last mixes (newest first): the next one picks another now and then */
	private styleHistory: string[] = [];
	/** Auto DJ's plan for the coming mix, kept once made (see autoPlanFor) */
	private autoPlanned: { key: string; plan: MixPlan } | null = null;

	constructor(ctx: BaseAudioContext = audioContext()) {
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
		// Not in every web view: the DJ mode works without, only recording doesn't
		try {
			if (typeof MediaRecorder !== 'undefined' && ctx instanceof AudioContext) {
				this.stream = ctx.createMediaStreamDestination();
				recordLimiter.connect(this.stream);
			}
		} catch (error) {
			console.warn("Recording mixes isn't possible here:", error);
			this.stream = null;
		}
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
			deck.ready.then(() => this.emit());
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
				keyLock: this.keyLock,
				canKeyLock: this.decks.A.canKeyLock,
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

	setOptions(options: { keyLock?: boolean; glide?: boolean }) {
		if (options.glide != null) this.glide = options.glide;
		if (options.keyLock != null) {
			this.keyLock = options.keyLock;
			for (const deck of Object.values(this.decks)) deck.setKeyLock(options.keyLock);
		}
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

	/** What the planner sees of a deck */
	private view(deck: Deck): DeckView | null {
		if (!deck.buffer || !deck.player) return null;
		const s = deck.state;
		const analysis = deck.analysis ?? roughAnalysis(deck.grid, s.duration, s.cue);
		const position = deck.position();
		const hot = s.hotCues[0];
		const own = hot ?? (deck.cueByUser ? s.cue : null);
		const fallback = own ?? analysis.firstBar;
		// Put somewhere by the user (scrubbed, or played before): it starts from there
		const placed =
			!s.playing &&
			Math.abs(position - fallback) > 1 &&
			Math.abs(position - s.cue) > 1 &&
			position > 0 &&
			position < s.duration - 20;
		return {
			analysis,
			grid: deck.grid,
			position,
			rate: deck.player.segmentAt().playing ? deck.player.segmentAt().rate : deck.liveRate,
			playing: s.playing,
			start: placed ? beatRound(deck.grid, position) : fallback,
			placed: placed || own != null,
			songId: String(s.song?.id ?? '')
		};
	}

	/** How the next song's tempo fits the playing one's */
	compat(from: Deck, to: Deck): Fit {
		const a = this.view(from);
		const b = this.view(to);
		if (!a || !b) return { rating: 'clash', change: null, factor: 1 };
		const { rating, change, factor } = tempoFit(a, b);
		return { rating, change, factor };
	}

	/** The mix the decks would get now (by hand, or Auto DJ's) */
	plan(
		from: Deck,
		to: Deck,
		type = this.transitionType,
		bars = this.transitionBars,
		auto = false
	): MixPlan | null {
		const a = this.view(from);
		const b = this.view(to);
		if (!a || !b) return null;
		return planMix(a, b, {
			type,
			bars,
			auto,
			keyLock: this.keyLock && from.canKeyLock,
			history: this.styleHistory
		});
	}

	/** What a mix pressed now would do, and in how many seconds it starts (for the UI) */
	preview(): { plan: MixPlan; seconds: number } | null {
		const from = this.leading();
		if (!from || this.transition) return null;
		const to = this.other(from.id);
		if (!to.buffer || to.state.loading) return null;
		const plan = this.plan(from, to);
		if (!plan) return null;
		return { plan, seconds: this.secondsTo(from, plan.startA) };
	}

	/** Real seconds until a playing deck gets to a point of its song */
	private secondsTo(deck: Deck, songTime: number) {
		const at = deck.player?.timeOf(songTime);
		if (at != null) return Math.max(0, at - this.ctx.currentTime);
		return Math.max(0, (songTime - deck.position()) / (deck.liveRate || 1));
	}

	/**
	 * Auto DJ's plan for the coming mix: made once and kept (the countdown and the mix itself
	 * follow the same plan), made again when the songs change or a deck is moved
	 */
	private autoPlanFor(from: Deck, to: Deck) {
		const key = [
			from.id,
			from.state.song?.id,
			to.state.song?.id,
			from.player?.version,
			to.player?.version,
			!!from.analysis,
			!!to.analysis,
			this.keyLock,
			this.transitionType
		].join(':');
		const kept = this.autoPlanned;
		if (kept && kept.key === key && from.position() <= kept.plan.startA + 0.05) return kept.plan;
		const plan = this.plan(from, to, this.transitionType, this.transitionBars, true);
		this.autoPlanned = plan ? { key, plan } : null;
		return plan;
	}

	/** Mixes from the playing deck to the other one (see mixplan.ts) */
	mix(type = this.transitionType, bars = this.transitionBars, auto = false) {
		const from = this.leading();
		if (!from || this.transition) return false;
		const to = this.other(from.id);
		if (!to.buffer || !to.player || !from.player || to.state.loading) return false;
		if (to.state.playing) return this.mixPlaying(from, to, bars);
		const plan = auto ? this.autoPlanFor(from, to) : this.plan(from, to, type, bars, false);
		if (!plan) return false;
		return this.run(plan, from, to);
	}

	/**
	 * Plays a planned mix: the old song's timeline (its tempo moving to where they meet, its
	 * stop), the new song's (its start on the beat, locked to the old one's beats while they
	 * play together, gliding back to its own tempo after), and the moves on the mixer
	 */
	private run(plan: MixPlan, from: Deck, to: Deck) {
		const pa = from.player!;
		const pb = to.player!;
		const t0 = pa.quantize(this.ctx.currentTime + LEAD);
		const current = pa.segmentAt(t0);
		if (!current.playing) return false;
		const posA = placeAt(current, t0);
		const r0 = current.rate;
		const keyLock = from.keyLock;
		const segmentsA: Segment[] = [
			{ at: t0, playing: true, input: posA, rate: r0, loop: null, keyLock }
		];
		// The old song's tempo moves to where the two meet, beat by beat, before the mix
		if (Math.abs(plan.rateA - r0) > 1e-4) {
			const from0 = Math.max(posA, Math.min(plan.rampFrom ?? posA, plan.startA - 0.01));
			const length = plan.startA - from0;
			const beat = sectionAt(from.grid, from0)?.beat ?? 0.5;
			const steps = Math.max(1, Math.round(length / beat));
			let t = t0 + (from0 - posA) / r0;
			for (let k = 0; k < steps; k++) {
				const x = (k + 0.5) / steps;
				const rate = r0 + (plan.rateA - r0) * x * x * (3 - 2 * x);
				const input = from0 + (length * k) / steps;
				segmentsA.push({ at: t, playing: true, input, rate, loop: null, keyLock });
				t += length / steps / rate;
			}
			segmentsA.push({
				at: t,
				playing: true,
				input: plan.startA,
				rate: plan.rateA,
				loop: null,
				keyLock
			});
		}
		const timeA = (song: number) => timeOn(segmentsA, song);
		const tStart = timeA(plan.startA);
		const tSwap = timeA(plan.swapA);
		const tEnd = timeA(plan.endA);
		const beat = (sectionAt(from.grid, plan.swapA)?.beat ?? 0.5) / plan.rateA;
		// The old song stops: slowing to a halt (brake), or once it's gone
		let stopA = tSwap;
		if (plan.style === 'brake') {
			const last = segmentsA.at(-1)!;
			const start = Math.max(t0, tSwap - Math.min(1.4, beat * 3));
			const brake = from.brakeSegments(start, tSwap, {
				...last,
				input: last.input + (start - last.at) * last.rate,
				at: start
			});
			segmentsA.push(...brake);
		} else {
			// (a segue lets what's left of the old song ring a bar under the new one)
			const stop = Math.max(tEnd, tSwap + (plan.style === 'segue' ? beat * 4 : 0)) + 0.05;
			stopA = stop;
			segmentsA.push({
				at: stop,
				playing: false,
				input: plan.startA + (stop - tStart) * plan.rateA,
				rate: plan.rateA,
				loop: null,
				keyLock
			});
		}

		// The new song
		const keyLockB = to.keyLock;
		const segmentsB: Segment[] = [];
		if (plan.beatmatch) {
			// Beat for beat on the old song's beats while they play (and a bar more)
			const iA = Math.round(beatIndex(from.grid, plan.startA));
			const iB = Math.round(beatIndex(to.grid, plan.startB));
			const beats = Math.ceil(beatIndex(from.grid, plan.endA) - iA) + 4;
			const at = (k: number) => tStart + (beatTime(from.grid, iA + k) - plan.startA) / plan.rateA;
			// Its beats as they're played: its first bars looped a few times (a short intro made
			// longer), then on from there
			const loop = plan.loopB;
			const span = loop ? loop.bars * (sectionAt(to.grid, plan.startB)?.meter ?? 4) : 0;
			const looped = loop ? span * loop.times : 0;
			const beatOf = (v: number) =>
				!loop ? iB + v : v < looped ? iB + (v % span) : iB + span + (v - looped);
			const song = (k: number) => beatTime(to.grid, beatOf(k * plan.factor));
			for (let k = 0; k < beats; k++) {
				const t = at(k);
				const input = song(k);
				// (on to its next beat; at a loop's end it jumps back after this one)
				const rate =
					(beatTime(to.grid, beatOf(k * plan.factor) + plan.factor) - input) / (at(k + 1) - t);
				const last = segmentsB.at(-1);
				if (
					last &&
					Math.abs(last.rate - rate) < 1e-6 &&
					Math.abs(last.input + (t - last.at) * last.rate - input) < 1e-4
				)
					continue;
				segmentsB.push({
					at: t,
					playing: true,
					input,
					rate,
					loop: null,
					keyLock: keyLockB
				});
			}
			// Then back to its own tempo, slowly (longer for a bigger change)
			const last = segmentsB.at(-1)!;
			const tFree = at(beats);
			const posFree = song(beats);
			if (this.glide && Math.abs(last.rate - 1) > 0.003) {
				const ownBeat = sectionAt(to.grid, posFree)?.beat ?? 0.5;
				const count = Math.round(Math.max(32, Math.abs(last.rate - 1) * 400));
				let t = tFree;
				let pos = posFree;
				for (let j = 0; j < count; j++) {
					const x = (j + 0.5) / count;
					const rate = last.rate + (1 - last.rate) * x * x * (3 - 2 * x);
					segmentsB.push({ at: t, playing: true, input: pos, rate, loop: null, keyLock: keyLockB });
					t += ownBeat / rate;
					pos += ownBeat;
				}
				segmentsB.push({
					at: t,
					playing: true,
					input: pos,
					rate: 1,
					loop: null,
					keyLock: keyLockB
				});
			}
		} else {
			// On the one (after the old song's build-up or effect)
			segmentsB.push({
				at: tSwap,
				playing: true,
				input: plan.startB,
				rate: plan.rateB,
				loop: null,
				keyLock: keyLockB
			});
		}
		// (waiting at its start until then)
		pb.schedule([
			{
				at: t0,
				playing: false,
				input: plan.startB,
				rate: segmentsB[0].rate,
				loop: null,
				keyLock: keyLockB
			},
			...segmentsB
		]);
		pa.schedule(segmentsA);

		// The moves on the mixer
		// Where the old song has no bass left before the swap, or is quiet: the new one needn't
		// be held back from there
		const a = from.analysis;
		const freeFrom = (test: (bar: SongAnalysis['bars'][number]) => boolean) => {
			if (!a || plan.pre <= 0) return null;
			let free = plan.swapA;
			for (let i = barIndex(a, plan.swapA - 0.01); i >= 0; i--) {
				const bar = a.bars[i];
				if (bar.start < plan.startA - 1e-3 || !test(bar)) break;
				free = bar.start;
			}
			return free < plan.swapA - 1e-3 ? timeA(free) : null;
		};
		const curves = mixCurves(plan, {
			start: tStart,
			swap: tSwap,
			end: tEnd,
			beat,
			bassFree: freeFrom((bar) => bar.bass < 0.3),
			quiet: a ? freeFrom((bar) => bar.energy < a.peakLevel * 0.3) : null
		});
		// (its moves back at rest only once it's quiet: its filters jumping back, or its level
		// coming up again while the player lets out its last samples, would thump)
		from.scheduleCurves(curves.A, Math.max(curves.tail, stopA + 0.3));
		const restB = Math.max(tStart, ...Object.values(curves.B).map((list) => list?.at(-1)?.t ?? 0));
		to.scheduleCurves(curves.B, restB + 0.01);
		if (curves.echo) from.mixEcho(curves.echo, Math.max(t0, tStart - 0.01), curves.tail);
		// Both heard through the crossfader (the old one already is), the new one's fader up
		if (this.crossfader !== 0.5) this.setCrossfader(0.5);
		if (from.state.loop) from.state = { ...from.state, loop: null };
		to.set({
			volume: Math.max(to.state.volume, 0.9),
			kill: { low: false, mid: false, high: false }
		});
		from.state = { ...from.state, synced: false };
		to.state = { ...to.state, synced: false };
		this.transition = {
			from: from.id,
			to: to.id,
			type: plan.style,
			bars: plan.pre + plan.post,
			start: tStart,
			swap: tSwap,
			end: Math.max(tEnd, tSwap, curves.tail),
			beat,
			why: plan.why
		};
		this.running = { plan, from, to, versions: [pa.version, pb.version] };
		this.styleHistory = [plan.style, ...this.styleHistory].slice(0, 4);
		this.autoPlanned = null;
		this.emit();
		return true;
	}

	/**
	 * A mix with the new song playing already (started by hand): it stays where it is (in
	 * sync), the old song's bass swaps out and it fades over the bars picked
	 */
	private mixPlaying(from: Deck, to: Deck, bars: number) {
		if (!to.state.synced) to.sync(from);
		const a = from.analysis ?? roughAnalysis(from.grid, from.state.duration, from.state.cue);
		const now = this.ctx.currentTime + LEAD;
		const position = from.position(now);
		const rate = from.liveRate || 1;
		const beat = (sectionAt(from.grid, position)?.beat ?? 0.5) / rate;
		// The swap on the next bar, then the old song fades out over a quarter of the bars
		const swap = now + (barCeil(a, position + a.bar * 0.5) - position) / rate;
		const end = swap + Math.max(2, bars / 4) * beat * 4;
		const plan: MixPlan = {
			style: 'blend',
			startA: position,
			startB: to.position(now),
			swapA: position,
			swapB: to.position(now),
			endA: position,
			pre: 0,
			post: Math.max(2, bars / 4),
			beatmatch: true,
			factor: 1,
			rateA: rate,
			rampFrom: null,
			rateB: to.liveRate,
			drums: false,
			throwEcho: false,
			loopB: null,
			keys: null,
			fit: this.compat(from, to),
			why: 'Blend from here: the basslines swap on the bar, the old song fades out',
			options: ''
		};
		const curves = mixCurves(plan, { start: now, swap, end, beat });
		from.scheduleCurves(curves.A, end + 0.05);
		from.player!.change(end + 0.05, { playing: false });
		this.transition = {
			from: from.id,
			to: to.id,
			type: 'blend',
			bars: plan.post,
			start: now,
			swap,
			end: end + 0.1,
			beat,
			why: plan.why
		};
		this.running = { plan, from, to, versions: [from.player!.version, to.player!.version] };
		this.emit();
		return true;
	}

	/**
	 * Stops a mix: before its swap the new song fades out again and the old one plays on as it
	 * was; after it the old song fades out and the new one plays on
	 */
	cancelMix() {
		const t = this.transition;
		const run = this.running;
		this.transition = null;
		this.running = null;
		if (!t || !run) return;
		// (Auto DJ waits a moment before it plans another)
		this.noteUser();
		const { from, to } = run;
		const now = this.ctx.currentTime;
		const at = now + LEAD;
		const beat = Math.max(0.2, t.beat);
		if (now < t.swap) {
			from.releaseCurves(beat);
			from.player?.change(at, {});
			if (now >= t.start && to.state.playing) {
				to.releaseCurves(0);
				to.fadeOut(beat);
			} else {
				to.releaseCurves(0);
				to.player?.change(at, {});
			}
		} else {
			to.releaseCurves(beat);
			if (from.state.playing) {
				from.releaseCurves(0);
				from.fadeOut(beat);
			} else from.releaseCurves(0.05);
		}
		this.emit();
	}

	/** A mix that ran its course: the new song leads */
	private finishMix() {
		const t = this.transition!;
		this.transition = null;
		this.running = null;
		const from = this.decks[t.from];
		const to = this.decks[t.to];
		this.setCrossfader(t.to === 'A' ? 0 : 1);
		from.follow(this.ctx.currentTime);
		to.unsync();
		this.emit();
	}

	// --- Auto DJ -------------------------------------------------------------------------------

	startAuto(queue: MapSet[], source: string) {
		this.auto = { on: true, queue, index: -1, source };
		const playing = this.leading();
		if (playing) {
			// (from the song that plays, if it's in the list)
			this.auto.index = queue.findIndex((s) => sameSong(s, playing.state.song));
		} else {
			this.auto.index = 0;
			const deck = this.decks.A;
			deck.pickedByUser = false;
			deck.load(queue[0]).then(() => {
				if (this.auto.on && this.auto.index === 0) deck.play();
			});
		}
		this.emit();
	}

	/**
	 * The queue's next song after the one that played last, never the song that plays now (nor
	 * one with the same audio): -1 if there's none
	 */
	private autoNextIndex(playing: MapSet | null) {
		const queue = this.auto.queue;
		for (let k = 1; k <= queue.length; k++) {
			const i = (((this.auto.index + k) % queue.length) + queue.length) % queue.length;
			const song = queue[i];
			if (song && !(playing && (sameSong(song, playing) || song.id === playing.id))) return i;
		}
		return -1;
	}

	/** The song Auto DJ mixes into next (the one the user put on the other deck, else the queue's) */
	autoNext(): MapSet | null {
		if (!this.auto.on) return null;
		const lead = this.leading();
		const next = lead ? this.other(lead.id) : null;
		if (next?.pickedByUser && next.state.song) return next.state.song;
		const i = this.autoNextIndex(lead?.state.song ?? null);
		return i >= 0 ? this.auto.queue[i] : null;
	}

	stopAuto() {
		this.auto = { ...this.auto, on: false };
		this.emit();
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
		if (this.transition) {
			const seconds = Math.max(0, this.transition.start - this.ctx.currentTime);
			return {
				song: this.decks[this.transition.to].state.song,
				seconds,
				mixing: seconds === 0,
				how: this.transition.why
			};
		}
		const playing = this.leading();
		if (!playing) return { song: null, seconds: null, mixing: false };
		const next = this.other(playing.id);
		if (!next.buffer || next.state.loading)
			return { song: next.state.song, seconds: null, mixing: false };
		if (!playing.analysis || !next.analysis)
			return {
				song: next.state.song,
				seconds: null,
				mixing: false,
				how: 'Listening to the songs…'
			};
		const plan = this.autoPlanFor(playing, next);
		if (!plan) return { song: next.state.song, seconds: null, mixing: false };
		const seconds = this.secondsTo(playing, plan.startA);
		const waiting = performance.now() - this.userAt < USER_QUIET_MS;
		return {
			song: next.state.song,
			seconds: waiting && seconds < 1 ? null : seconds,
			mixing: false,
			how: plan.why
		};
	}

	private async autoStep() {
		if (!this.auto.on || this.autoBusy || this.transition) return;
		const playing = this.leading();
		const queue = this.auto.queue;
		if (!queue.length || !playing) return;
		const next = this.other(playing.id);
		const nextIndex = this.autoNextIndex(playing.state.song);
		// What the user put on the other deck plays next; else the list's next song (never the
		// one that plays)
		const userPick = next.pickedByUser && next.state.song && !next.state.error;
		if (!userPick && nextIndex < 0) return;
		if (!userPick && (!sameSong(next.state.song, queue[nextIndex]) || next.state.error)) {
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
		// The mix is planned from both songs' analysis (a moment after loading), unless time is short
		const remaining = (playing.state.duration - playing.position()) / (playing.liveRate || 1);
		if ((!playing.analysis || !next.analysis) && remaining > 25) return;
		const plan = this.autoPlanFor(playing, next);
		if (!plan) return;
		// Put on the audio clock well ahead (it then happens on time whatever the app does),
		// not while the user works the decks (unless the song is about to end)
		const ahead = this.secondsTo(playing, plan.rampFrom ?? plan.startA);
		if (ahead > 40) return;
		if (performance.now() - this.userAt < USER_QUIET_MS && ahead > 6 && remaining > 20) return;
		if (this.mix(this.transitionType, this.transitionBars, true)) {
			if (!userPick) this.auto = { ...this.auto, index: nextIndex };
			next.pickedByUser = false;
			this.emit();
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
			if (Math.abs(error) > 0.05) {
				deck.setAutoBend(0);
				deck.alignTo(master, match.factor === 1);
			} else if (Math.abs(error) > 0.003) {
				// Caught up within about half a second, too little to hear (with key lock)
				deck.setAutoBend(Math.max(-0.02, Math.min(0.02, error * 2)));
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
		const now = this.ctx.currentTime;
		let changed = false;
		for (const deck of Object.values(this.decks)) changed = deck.follow(now) || changed;
		const run = this.running;
		if (run && this.transition) {
			// The user moved a deck the mix plays: it stops (see cancelMix)
			const [va, vb] = run.versions;
			if (run.from.player?.version !== va || run.to.player?.version !== vb) this.cancelMix();
			else if (now >= this.transition.end) this.finishMix();
		}
		this.keepSync();
		this.autoStep();
		if (changed || this.recorder) this.emit();
	}

	// --- Recording ---------------------------------------------------------------------------

	/** Whether mixes can be recorded here */
	get canRecord() {
		return !!this.stream;
	}

	/** Starts recording the mix; false where that isn't possible */
	startRecording() {
		if (this.recorder) return true;
		if (!this.stream) return false;
		const type = [
			'audio/webm;codecs=opus',
			'audio/ogg;codecs=opus',
			'audio/webm',
			'audio/mp4'
		].find((t) => MediaRecorder.isTypeSupported(t));
		try {
			this.chunks = [];
			this.recorder = new MediaRecorder(this.stream.stream, type ? { mimeType: type } : undefined);
			this.recorder.ondataavailable = (event) => event.data.size && this.chunks.push(event.data);
			this.recorder.start(1000);
		} catch (error) {
			console.error('Could not start recording the mix:', error);
			this.recorder = null;
			return false;
		}
		this.recordStart = this.ctx.currentTime;
		this.emit();
		return true;
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
