// @ts-nocheck (runs in the AudioWorklet, see stretch.ts)
// A deck's player: plays the song along a timeline of segments (from a time of the audio
// clock on: playing or not, where in the song, how fast, a loop, key lock). Every change is
// planned ahead, so mixes start, speed up and stop exactly on the beat.
// At its own tempo (or without key lock) the song is read as it is, sample for sample. Played
// faster or slower with key lock it goes through Signalsmith Stretch, which keeps the pitch;
// the two blend into each other over a few milliseconds. Jumps and loops crossfade too, so
// nothing clicks. `__stretchFactory` (Signalsmith's WebAssembly module) is put in front of
// this code.

/** Equal-power crossfade between the plain and the stretched sound (s) */
const PATH_FADE = 0.04;
/** Crossfade of a jump or a loop's wrap (samples) */
const JUMP_FADE = 192;

class DeckProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.segments = [
			{ at: -Infinity, active: false, input: 0, rate: 1, loopStart: 0, loopEnd: 0, stretch: false }
		];
		this.channels = [];
		/** 0: the plain sound, 1: the stretched one */
		this.blend = 0;
		this.level = 0;
		/** The plain sound's last position (s) and rate, to crossfade jumps */
		this.last = null;
		this.jump = null;
		this.silent = Infinity;
		this.wasPlaying = false;
		this.plain = [new Float32Array(128), new Float32Array(128)];
		this.port.onmessage = (event) => this.message(event.data);
		this.stretchReady = false;
		__stretchFactory()
			.then((wasm) => {
				this.wasm = wasm;
				wasm._main();
				wasm._presetDefault(2, sampleRate);
				wasm._setTransposeSemitones(0, 8000 / sampleRate);
				wasm._setFormantSemitones(0, false);
				wasm._setFormantBase(0);
				this.inputLatency = wasm._inputLatency();
				this.outputLatency = wasm._outputLatency() / sampleRate;
				// Longer than one block of the stretcher, so it can be fed from anywhere
				this.length = wasm._inputLatency() + wasm._outputLatency();
				const pointer = wasm._setBuffers(2, this.length);
				const bytes = this.length * 4;
				this.inPointers = [pointer, pointer + bytes];
				this.outPointers = [pointer + bytes * 2, pointer + bytes * 3];
				this.stretchReady = true;
				this.port.postMessage({ type: 'ready', latency: this.outputLatency, keyLock: true });
			})
			.catch((error) => {
				this.port.postMessage({ type: 'ready', latency: 0, keyLock: false, error: String(error) });
			});
	}

	message(data) {
		if (data.type === 'buffer') {
			this.channels = data.channels;
			this.last = null;
		} else if (data.type === 'timeline') {
			// The new segments replace everything from the first one's time on
			const first = data.segments[0]?.at ?? Infinity;
			const kept = this.segments.filter((s) => s.at < first);
			this.segments = kept.length ? kept : [this.segments[0]];
			this.segments.push(...data.segments);
		}
		if (data.id != null) this.port.postMessage({ type: 'ack', id: data.id });
	}

	segmentAt(time) {
		let found = this.segments[0];
		for (const s of this.segments) {
			if (s.at <= time + 1e-9) found = s;
			else break;
		}
		return found;
	}

	/** A sample of the song at a position (s), between samples linearly */
	read(channel, position) {
		const index = position * sampleRate;
		const i = Math.floor(index);
		const data = this.channels[channel % this.channels.length];
		if (i < 0 || i + 1 >= data.length) return i >= 0 && i < data.length ? data[i] : 0;
		const f = index - i;
		return f < 1e-6 ? data[i] : data[i] + (data[i + 1] - data[i]) * f;
	}

	/** The plain sound of one block into this.plain */
	renderPlain(segment, n) {
		const [left, right] = this.plain;
		const t0 = currentTime;
		let start;
		let step;
		let loopStart = 0;
		let loopLength = 0;
		if (segment.active) {
			step = segment.rate / sampleRate;
			start = segment.input + (t0 - segment.at) * segment.rate;
			// At its own speed: whole samples (no blur from reading between them)
			if (Math.abs(segment.rate - 1) < 1e-9) start = Math.round(start * sampleRate) / sampleRate;
			loopStart = segment.loopStart;
			loopLength = segment.loopEnd - segment.loopStart;
			// Another segment that doesn't go on from where the last one was: the old place fades
			// out while the new one comes in
			if (this.last && this.last.segment !== segment) {
				const place =
					loopLength > 0 && start >= segment.loopEnd
						? loopStart + ((start - loopStart) % loopLength)
						: start;
				if (Math.abs(place - this.last.next) * sampleRate > 1.5)
					this.jump = { position: this.last.next, step: this.last.step, left: JUMP_FADE };
			}
		} else if (this.last) {
			// Stopped: goes on where it was while it fades out
			start = this.last.next;
			step = this.last.step;
		} else {
			left.fill(0);
			right.fill(0);
			return;
		}
		const loopEnd = loopStart + loopLength;
		for (let k = 0; k < n; k++) {
			let p = start + k * step;
			let tail = null;
			if (loopLength > 0 && p >= loopEnd) {
				const into = (p - loopStart) % loopLength;
				// Just wrapped: the sound past the loop's end fades out under its start
				const since = into / step;
				if (since < JUMP_FADE) tail = { p: loopEnd + into, g: since / JUMP_FADE };
				p = loopStart + into;
			}
			let l = this.read(0, p);
			let r = this.read(1, p);
			if (tail) {
				const a = Math.sin((tail.g * Math.PI) / 2);
				const b = Math.cos((tail.g * Math.PI) / 2);
				l = l * a + this.read(0, tail.p) * b;
				r = r * a + this.read(1, tail.p) * b;
			}
			if (this.jump) {
				const g = 1 - this.jump.left / JUMP_FADE;
				const a = Math.sin((g * Math.PI) / 2);
				const b = Math.cos((g * Math.PI) / 2);
				const q = this.jump.position;
				l = l * a + this.read(0, q) * b;
				r = r * a + this.read(1, q) * b;
				this.jump.position += this.jump.step;
				if (--this.jump.left <= 0) this.jump = null;
			}
			left[k] = l;
			right[k] = r;
		}
		let next = start + n * step;
		if (loopLength > 0 && next >= loopEnd) next = loopStart + ((next - loopStart) % loopLength);
		this.last = { segment, next, step };
	}

	/** The stretched sound of one block (in the stretcher's output buffers) */
	renderStretched(n) {
		const wasm = this.wasm;
		// What's computed now is heard after the stretcher's latency
		const time = currentTime + this.outputLatency;
		const segment = this.segmentAt(time);
		const memory = wasm.exports ? wasm.exports.memory.buffer : wasm.HEAP8.buffer;
		const inputs = this.inPointers.map((p) => new Float32Array(memory, p, this.length));
		if (!segment.active || !segment.stretch) {
			inputs.forEach((buffer) => buffer.fill(0, 0, n));
			wasm._process(n, n);
			return;
		}
		const unwrapped = segment.input + (time - segment.at) * segment.rate;
		const end = Math.round(unwrapped * sampleRate) + this.inputLatency;
		const start = end - this.length;
		const loopStart = Math.round(segment.loopStart * sampleRate);
		const loopLength = Math.round(segment.loopEnd * sampleRate) - loopStart;
		const total = this.channels[0].length;
		for (let c = 0; c < 2; c++) {
			const source = this.channels[c % this.channels.length];
			const target = inputs[c];
			if (loopLength > 0 && end > loopStart + loopLength) {
				for (let i = 0; i < this.length; i++) {
					let p = start + i;
					if (p >= loopStart) p = loopStart + ((p - loopStart) % loopLength);
					target[i] = p >= 0 && p < total ? source[p] : 0;
				}
			} else {
				const from = Math.max(0, Math.min(total, start));
				const to = Math.max(0, Math.min(total, end));
				target.fill(0);
				if (to > from) target.set(source.subarray(from, to), from - start);
			}
		}
		wasm._seek(this.length, segment.rate);
		wasm._process(0, n);
	}

	process(_inputs, outputs) {
		const out = outputs[0];
		if (!out?.length) return true;
		const n = out[0].length;
		const segment = this.segmentAt(currentTime);
		while (this.segments.length > 1 && this.segments[1].at <= currentTime) this.segments.shift();
		const loaded = this.channels.length > 0;
		const playing = loaded && segment.active;
		// The stretcher runs from a moment before it's heard until it faded out
		const ahead = this.stretchReady ? this.segmentAt(currentTime + this.outputLatency) : null;
		const wantStretch = this.stretchReady && playing && segment.stretch;
		const stretching =
			this.stretchReady &&
			loaded &&
			(this.blend > 0 ||
				wantStretch ||
				(ahead.active && ahead.stretch) ||
				this.silent < sampleRate);
		if (stretching) {
			this.renderStretched(n);
			this.silent = ahead.active && ahead.stretch ? 0 : this.silent + n;
		} else this.silent = Infinity;
		const plainNeeded = loaded && (playing || this.level > 0);
		if (plainNeeded) this.renderPlain(segment, n);
		else {
			this.last = null;
			this.jump = null;
		}
		// Starting to play: straight on the right sound (the stretcher ran ahead already)
		if (playing && !this.wasPlaying) this.blend = wantStretch ? 1 : 0;
		this.wasPlaying = playing;
		const memory = stretching
			? this.wasm.exports
				? this.wasm.exports.memory.buffer
				: this.wasm.HEAP8.buffer
			: null;
		const stretched = stretching
			? this.outPointers.map((p) => new Float32Array(memory, p, n))
			: null;
		const blendStep = 1 / (PATH_FADE * sampleRate);
		const levelStep = 1 / (0.004 * sampleRate);
		const blendTarget = wantStretch ? 1 : 0;
		const levelTarget = playing ? 1 : 0;
		const [left, right] = out.length > 1 ? out : [out[0], out[0]];
		for (let k = 0; k < n; k++) {
			this.blend += Math.max(-blendStep, Math.min(blendStep, blendTarget - this.blend));
			this.level += Math.max(-levelStep, Math.min(levelStep, levelTarget - this.level));
			const s = Math.sin((this.blend * Math.PI) / 2);
			const d = Math.cos((this.blend * Math.PI) / 2) * this.level;
			let l = plainNeeded ? this.plain[0][k] * d : 0;
			let r = plainNeeded ? this.plain[1][k] * d : 0;
			if (stretched) {
				l += stretched[0][k] * s;
				r += stretched[1][k] * s;
			}
			left[k] = l;
			if (right !== left) right[k] = r;
		}
		return true;
	}
}

registerProcessor('stosufy-deck', DeckProcessor);
