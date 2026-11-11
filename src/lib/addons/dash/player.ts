// The song of a Dash level, played from its decoded audio: it starts at any moment exact to the
// sample, and its time is the audio clock's. An audio element can't do that: it starts again
// from the nearest frame of the file (some 25 to 50 ms off; with a variable bitrate hundreds),
// and each restart from a checkpoint or after an intro would be that much beside the level.

import { outputDelay, playbackContext, playbackInput } from '../../stores/equalizer';

export class BufferSong {
	private source: AudioBufferSourceNode | null = null;
	private gain: GainNode | null = null;
	/** The context time the source started at, where in the song (s), and how fast */
	private when = 0;
	private from = 0;
	private rate = 1;
	/** Where it was paused (ms), if it is */
	private pausedAt: number | null = null;

	constructor(private buffer: AudioBuffer) {}

	/** Whether the song can be played this way now (the audio context runs) */
	static async ready() {
		try {
			const ctx = playbackContext();
			if (ctx.state !== 'running') await ctx.resume().catch(() => {});
			return ctx.state === 'running';
		} catch {
			return false;
		}
	}

	get playing() {
		return !!this.source;
	}

	/** Plays from a song time (ms) on, a moment from now (false if it couldn't) */
	start(fromMs: number, rate = 1, volume = 1) {
		this.stop();
		try {
			const ctx = playbackContext();
			if (ctx.state !== 'running') return false;
			const source = ctx.createBufferSource();
			source.buffer = this.buffer;
			source.playbackRate.value = rate;
			const gain = ctx.createGain();
			gain.gain.value = volume;
			source.connect(gain).connect(playbackInput());
			const from = Math.max(0, Math.min(this.buffer.duration, fromMs / 1000));
			const when = ctx.currentTime + 0.02;
			source.start(when, from);
			source.onended = () => {
				if (this.source === source) this.source = null;
			};
			this.source = source;
			this.gain = gain;
			this.when = when;
			this.from = from;
			this.rate = rate;
			this.pausedAt = null;
			return true;
		} catch (error) {
			console.warn('Could not play the decoded song', error);
			this.source = null;
			return false;
		}
	}

	/** Where the song is in what's being put out now (ms; what's heard is the output delay later) */
	private position(ctx: AudioContext, back = 0) {
		return (this.from + (ctx.currentTime - back - this.when) * this.rate) * 1000;
	}

	/** Where the song is as it's heard now (ms) */
	time() {
		if (this.pausedAt !== null) return this.pausedAt;
		const ctx = playbackContext();
		return this.position(ctx, outputDelay(ctx));
	}

	setVolume(volume: number) {
		if (this.gain && Math.abs(this.gain.gain.value - volume) > 0.001) this.gain.gain.value = volume;
	}

	pause() {
		if (!this.source) return;
		const at = Math.max(0, this.position(playbackContext()));
		this.stop();
		this.pausedAt = at;
	}

	resume(volume = 1) {
		if (this.pausedAt === null) return false;
		return this.start(this.pausedAt, this.rate, volume);
	}

	/** Stops (softly, over a few ms: no click); returns where the song was (ms) */
	stop() {
		const source = this.source;
		const gain = this.gain;
		this.source = null;
		this.gain = null;
		this.pausedAt = null;
		if (!source) return 0;
		const ctx = playbackContext();
		const at = this.position(ctx);
		try {
			gain?.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
			source.stop(ctx.currentTime + 0.05);
			source.onended = () => {
				source.disconnect();
				gain?.disconnect();
			};
		} catch {
			// Stopped already
		}
		return Math.max(0, at);
	}
}
