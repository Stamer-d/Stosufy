// The puzzle's own sounds, made with Web Audio: picking a piece up, the wooden "thock" of one
// snapping in with a chime that climbs a pentatonic scale as the picture comes together,
// pieces joining, a miss, and a chord at the end. Their volume is the puzzle's own.

const VOLUME_KEY = 'puzzleVolume';

let context: AudioContext | null = null;
let master: GainNode | null = null;
/** A short room, so the chimes ring a little */
let room: ConvolverNode | null = null;

export function puzzleVolume() {
	try {
		const saved = Number(localStorage.getItem(VOLUME_KEY));
		return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved) ? saved : 0.9;
	} catch {
		return 0.9;
	}
}

export function setPuzzleVolume(volume: number) {
	try {
		localStorage.setItem(VOLUME_KEY, String(volume));
	} catch {
		// (not remembered)
	}
	if (master) master.gain.value = volume * 1.4;
}

function audio() {
	if (!context) {
		context = new AudioContext({ latencyHint: 'interactive' });
		master = context.createGain();
		master.gain.value = puzzleVolume() * 1.4;
		// Keeps several sounds at once from clipping
		const limiter = context.createDynamicsCompressor();
		limiter.threshold.value = -6;
		limiter.ratio.value = 8;
		master.connect(limiter).connect(context.destination);
		room = context.createConvolver();
		room.buffer = impulse(context, 1.1);
		const wet = context.createGain();
		wet.gain.value = 0.22;
		room.connect(wet).connect(master);
	}
	if (context.state === 'suspended') context.resume();
	return context;
}

/** A decaying noise burst as a reverb's room */
function impulse(ctx: BaseAudioContext, seconds: number) {
	const length = Math.round(ctx.sampleRate * seconds);
	const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
	}
	return buffer;
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: AudioContext) {
	if (!noiseBuffer) {
		noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}
	return noiseBuffer;
}

/** A gain that rises in a moment and falls off over `decay` seconds */
function envelope(ctx: AudioContext, at: number, peak: number, decay: number, attack = 0.002) {
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(peak, at + attack);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
	return gain;
}

function tone(
	frequency: number,
	{ at = 0, peak = 0.3, decay = 0.4, type = 'sine' as OscillatorType, bend = 1, wet = false } = {}
) {
	const ctx = audio();
	const start = ctx.currentTime + at;
	const osc = ctx.createOscillator();
	osc.type = type;
	osc.frequency.setValueAtTime(frequency, start);
	if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(frequency * bend, start + decay);
	const gain = envelope(ctx, start, peak, decay);
	osc.connect(gain).connect(master!);
	if (wet) gain.connect(room!);
	osc.start(start);
	osc.stop(start + decay + 0.05);
}

function burst({ at = 0, peak = 0.3, decay = 0.03, frequency = 2000, q = 1 } = {}) {
	const ctx = audio();
	const start = ctx.currentTime + at;
	const source = ctx.createBufferSource();
	source.buffer = noise(ctx);
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.value = frequency;
	filter.Q.value = q;
	const gain = envelope(ctx, start, peak, decay, 0.001);
	source.connect(filter).connect(gain).connect(master!);
	source.start(start, Math.random() * 0.5);
	source.stop(start + decay + 0.05);
}

/** C major pentatonic over three octaves: every step sounds good after the last */
const SCALE = [0, 2, 4, 7, 9].flatMap((step) => [0, 12, 24].map((octave) => step + octave));
SCALE.sort((a, b) => a - b);
const note = (step: number, base = 523.25) =>
	base * 2 ** (SCALE[Math.max(0, Math.min(SCALE.length - 1, step))] / 12);

const vary = (amount = 0.04) => 1 + (Math.random() - 0.5) * amount;

/** A piece picked up: a soft tick */
export function pickSound() {
	burst({ peak: 0.12, decay: 0.02, frequency: 3500 * vary(0.2), q: 2 });
	tone(900 * vary(), { peak: 0.06, decay: 0.04 });
}

/**
 * A piece snapping where it belongs: a wooden thock and a chime, higher the further along
 * the puzzle is (`progress` 0–1); `strength` 0–1 makes it fuller (a 300 against a 50)
 */
export function snapSound(progress: number, strength = 1) {
	tone(190 * vary(), { peak: 0.55, decay: 0.09, bend: 0.5 });
	burst({ peak: 0.4, decay: 0.025, frequency: 1800 * vary(0.2), q: 1.2 });
	burst({ at: 0.004, peak: 0.18, decay: 0.012, frequency: 6000, q: 0.8 });
	const step = Math.round(progress * (SCALE.length - 4));
	tone(note(step), { at: 0.01, peak: 0.16 + strength * 0.12, decay: 0.55, wet: true });
	if (strength > 0.7)
		tone(note(step + 2), { at: 0.055, peak: 0.1, decay: 0.5, type: 'triangle', wet: true });
}

/** Two loose pieces joining: a lighter click and a low chime */
export function joinSound(size = 2) {
	tone(240 * vary(), { peak: 0.35, decay: 0.07, bend: 0.6 });
	burst({ peak: 0.28, decay: 0.02, frequency: 2400 * vary(0.2), q: 1.4 });
	tone(note(Math.min(6, Math.floor(Math.log2(size) * 2)), 261.63), {
		at: 0.01,
		peak: 0.12,
		decay: 0.4,
		wet: true
	});
}

/** A miss: a dull bonk going down */
export function missSound() {
	tone(150, { peak: 0.35, decay: 0.22, type: 'triangle', bend: 0.6 });
	burst({ peak: 0.15, decay: 0.05, frequency: 400, q: 0.7 });
}

/** A combo milestone: a quick sparkle */
export function sparkleSound() {
	[12, 14].forEach((step, i) =>
		tone(note(step), { at: i * 0.06, peak: 0.12, decay: 0.35, type: 'triangle', wet: true })
	);
}

/** The puzzle is whole: a rising chord that rings out, over a soft whoosh */
export function finishSound() {
	const ctx = audio();
	const start = ctx.currentTime;
	const source = ctx.createBufferSource();
	source.buffer = noise(ctx);
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.Q.value = 0.8;
	filter.frequency.setValueAtTime(400, start);
	filter.frequency.exponentialRampToValueAtTime(5000, start + 0.9);
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, start);
	gain.gain.exponentialRampToValueAtTime(0.12, start + 0.5);
	gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.2);
	source.connect(filter).connect(gain).connect(master!);
	source.start(start);
	source.stop(start + 1.3);
	[0, 2, 4, 5, 7, 10].forEach((step, i) =>
		tone(note(step), { at: 0.08 * i, peak: 0.16, decay: 1.6, wet: true })
	);
	tone(note(0, 261.63), { at: 0.45, peak: 0.18, decay: 2, type: 'triangle', wet: true });
	tone(note(10), { at: 0.5, peak: 0.1, decay: 2.2, type: 'triangle', wet: true });
}

/** A piece landing on the table (the 3D view): a light knock */
export function landSound(pitch = 1) {
	tone(320 * pitch * vary(0.1), { peak: 0.14, decay: 0.05, bend: 0.6 });
	burst({ peak: 0.1, decay: 0.015, frequency: 2600 * vary(0.3), q: 1.5 });
}

/** The pieces flying apart or back together (the 3D view) */
export function whooshSound(up = true) {
	const ctx = audio();
	const start = ctx.currentTime;
	const source = ctx.createBufferSource();
	source.buffer = noise(ctx);
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.Q.value = 1.2;
	filter.frequency.setValueAtTime(up ? 500 : 3500, start);
	filter.frequency.exponentialRampToValueAtTime(up ? 3500 : 500, start + 0.5);
	const gain = envelope(ctx, start, 0.16, 0.5, 0.15);
	source.connect(filter).connect(gain).connect(master!);
	source.start(start);
	source.stop(start + 0.75);
}
