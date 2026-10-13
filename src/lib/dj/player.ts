// What a deck plays when: a timeline of segments on the audio clock. Each says from when on
// the song plays (or not), from where, how fast, in a loop or not, and with key lock. Mixes
// plan theirs ahead (the new song starts on the beat, the old one speeds up, the new one
// glides back to its own tempo), so the sound follows the plan to the sample however busy
// the app is. The position of the song at any time comes from the same timeline.
// The decks play in an AudioWorklet (deckProcessor.js, with the key lock); where the web view
// can't run one, buffer sources play the timeline instead (without key lock).

import { createWorkletPlayer, type WorkletPlayer, type WorkletSegment } from './stretch';

export interface Segment {
	/** Time of the audio clock it starts at */
	at: number;
	playing: boolean;
	/** Where in the song it is then (s) */
	input: number;
	/** How fast it plays (1: its own tempo) */
	rate: number;
	loop: { start: number; end: number } | null;
	/** Played faster or slower, it keeps its pitch */
	keyLock: boolean;
}

/** Where a segment has the song at a time (in its loop, if it has one) */
export function placeAt(segment: Segment, time: number) {
	const unwrapped = segment.playing
		? segment.input + (time - segment.at) * segment.rate
		: segment.input;
	const loop = segment.loop;
	if (loop && loop.end > loop.start && unwrapped >= loop.end)
		return loop.start + ((unwrapped - loop.start) % (loop.end - loop.start));
	return unwrapped;
}

/** Audio is made in blocks of 128 samples: changes start on a block, so they're exact */
const QUANTUM = 128;

export class Player {
	readonly output: GainNode;
	readonly ctx: BaseAudioContext;
	timeline: Segment[] = [
		{ at: -Infinity, playing: false, input: 0, rate: 1, loop: null, keyLock: true }
	];
	/** Counts the changes to the timeline */
	version = 0;
	private worklet: WorkletPlayer | null = null;
	private buffer: AudioBuffer | null = null;
	private sources: { node: AudioBufferSourceNode; gain: GainNode; start: number }[] = [];

	private constructor(ctx: BaseAudioContext) {
		this.ctx = ctx;
		this.output = ctx.createGain();
	}

	static async create(ctx: BaseAudioContext) {
		const player = new Player(ctx);
		player.worklet = await createWorkletPlayer(ctx);
		player.worklet?.node.connect(player.output);
		return player;
	}

	/** Whether songs keep their pitch when played faster or slower */
	get canKeyLock() {
		return !!this.worklet?.keyLock;
	}

	/** The first block at or after a time */
	quantize(time: number) {
		const rate = this.ctx.sampleRate;
		return (Math.ceil((time * rate) / QUANTUM - 1e-6) * QUANTUM) / rate;
	}

	async setBuffer(buffer: AudioBuffer | null) {
		this.buffer = buffer;
		this.stopSources(-Infinity);
		this.timeline = [
			{ at: -Infinity, playing: false, input: 0, rate: 1, loop: null, keyLock: true }
		];
		this.version++;
		if (this.worklet) {
			await this.worklet.schedule([this.toWorklet(this.timeline[0])]);
			const channels = buffer
				? Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) =>
						buffer.getChannelData(c).slice()
					)
				: [];
			await this.worklet.setBuffer(channels);
		}
	}

	segmentAt(time = this.ctx.currentTime) {
		let found = this.timeline[0];
		for (const segment of this.timeline) {
			if (segment.at <= time + 1e-9) found = segment;
			else break;
		}
		return found;
	}

	/** Where the song is at a time of the audio clock (s) */
	position(time = this.ctx.currentTime) {
		return placeAt(this.segmentAt(time), time);
	}

	/** The time of the audio clock a playing segment gets to a point of the song (null: never) */
	timeOf(songTime: number, from = this.ctx.currentTime) {
		for (let i = 0; i < this.timeline.length; i++) {
			const s = this.timeline[i];
			const end = this.timeline[i + 1]?.at ?? Infinity;
			if (end <= from || !s.playing || s.loop || s.rate <= 0) continue;
			const start = Math.max(s.at, from);
			const at = s.at + (songTime - s.input) / s.rate;
			if (at >= start - 1e-6 && at < end) return at;
		}
		return null;
	}

	/**
	 * Replaces the timeline from the first segment's time on (the times are moved onto blocks;
	 * a segment's input is where the song is then)
	 */
	schedule(segments: Segment[]) {
		if (!segments.length) return;
		const now = this.ctx.currentTime;
		// (moved onto a block, the song is that much further by then)
		const fixed = segments.map((s) => {
			const at = this.quantize(s.at);
			return { ...s, at, input: s.playing ? s.input + (at - s.at) * s.rate : s.input };
		});
		const first = fixed[0].at;
		let kept = this.timeline.filter((s) => s.at < first);
		// Long gone segments aren't needed (the one playing now is)
		while (kept.length > 1 && kept[1].at <= now) kept = kept.slice(1);
		this.timeline = [...(kept.length ? kept : [this.timeline[0]]), ...fixed];
		this.version++;
		if (this.worklet) this.worklet.schedule(fixed.map((s) => this.toWorklet(s)));
		else this.playSources(first);
	}

	/** Changes from a time on: the song goes on from where it is then, with these changes */
	change(at: number, change: Partial<Omit<Segment, 'at'>>, keepLater = false) {
		const time = this.quantize(at);
		const current = this.segmentAt(time);
		const later = keepLater ? this.timeline.filter((s) => s.at > time) : [];
		const segment = { ...current, input: placeAt(current, time), ...change, at: time };
		// (a loop's position is inside the loop)
		this.schedule([segment, ...later]);
		return segment;
	}

	private toWorklet(s: Segment): WorkletSegment {
		return {
			at: s.at,
			active: s.playing,
			input: s.input,
			rate: s.rate,
			loopStart: s.loop?.start ?? 0,
			loopEnd: s.loop?.end ?? 0,
			stretch: s.keyLock && this.canKeyLock && Math.abs(s.rate - 1) > 1e-4
		};
	}

	// --- Without the worklet: buffer sources -------------------------------------------

	private stopSources(from: number) {
		const end = Math.max(from, this.ctx.currentTime);
		for (const source of this.sources) {
			try {
				if (source.start < end - 1e-6) {
					// Playing then: fades out
					source.gain.gain.cancelScheduledValues(end);
					source.gain.gain.setValueAtTime(1, end);
					source.gain.gain.linearRampToValueAtTime(0, end + 0.005);
					source.node.stop(end + 0.006);
				} else {
					source.node.stop();
					source.node.disconnect();
				}
			} catch {
				// Stopped already
			}
		}
		this.sources = [];
	}

	private playSources(from: number) {
		if (!this.buffer) return;
		this.stopSources(from);
		const runs: Segment[][] = [];
		for (let i = 0; i < this.timeline.length; i++) {
			const s = this.timeline[i];
			const end = this.timeline[i + 1]?.at ?? Infinity;
			if (end <= from || !s.playing) continue;
			const run = runs.at(-1);
			const previous = run?.at(-1);
			const continuous =
				previous &&
				this.timeline[i - 1] === previous &&
				!s.loop &&
				!previous.loop &&
				Math.abs(placeAt(previous, s.at) - s.input) < 1e-4;
			if (continuous) run!.push(s);
			else runs.push([s]);
		}
		const now = this.ctx.currentTime;
		for (const run of runs) {
			const first = run[0];
			const start = Math.max(first.at, from, now);
			const node = this.ctx.createBufferSource();
			node.buffer = this.buffer;
			if (first.loop) {
				node.loop = true;
				node.loopStart = first.loop.start;
				node.loopEnd = first.loop.end;
			}
			const gain = this.ctx.createGain();
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(1, start + 0.005);
			node.connect(gain).connect(this.output);
			node.playbackRate.setValueAtTime(first.rate, start);
			for (const s of run.slice(1)) node.playbackRate.setValueAtTime(s.rate, s.at);
			const offset = placeAt(first, start);
			if (offset < 0) node.start(start - offset / first.rate, 0);
			else node.start(start, offset);
			const last = run.at(-1)!;
			const end = this.timeline[this.timeline.indexOf(last) + 1]?.at;
			if (end != null && Number.isFinite(end)) {
				gain.gain.setValueAtTime(1, end);
				gain.gain.linearRampToValueAtTime(0, end + 0.005);
				node.stop(end + 0.006);
			}
			this.sources.push({ node, gain, start });
		}
	}
}
