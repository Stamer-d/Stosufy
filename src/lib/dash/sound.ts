// The Dash mode's sounds, made on the spot: crashing, a checkpoint, the level done.

let context: AudioContext | null = null;

function audio() {
	try {
		context ??= new AudioContext();
		if (context.state === 'suspended') context.resume().catch(() => {});
		return context;
	} catch {
		return null;
	}
}

function noiseBuffer(ctx: AudioContext, seconds: number) {
	const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++)
		data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
	return buffer;
}

export function playDashSound(name: 'death' | 'checkpoint' | 'complete', volume = 0.5) {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	const out = ctx.createGain();
	out.gain.value = volume;
	out.connect(ctx.destination);
	if (name === 'death') {
		// A crunch and a falling thump
		const source = ctx.createBufferSource();
		source.buffer = noiseBuffer(ctx, 0.5);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(5000, now);
		filter.frequency.exponentialRampToValueAtTime(300, now + 0.45);
		source.connect(filter).connect(out);
		source.start(now);
		const thump = ctx.createOscillator();
		const gain = ctx.createGain();
		thump.type = 'triangle';
		thump.frequency.setValueAtTime(180, now);
		thump.frequency.exponentialRampToValueAtTime(40, now + 0.3);
		gain.gain.setValueAtTime(0.9, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
		thump.connect(gain).connect(out);
		thump.start(now);
		thump.stop(now + 0.4);
	} else {
		const notes = name === 'checkpoint' ? [880, 1320] : [523, 659, 784, 1047, 1319];
		notes.forEach((frequency, i) => {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'square';
			osc.frequency.value = frequency;
			const at = now + i * (name === 'checkpoint' ? 0.06 : 0.09);
			gain.gain.setValueAtTime(0, at);
			gain.gain.linearRampToValueAtTime(name === 'checkpoint' ? 0.08 : 0.12, at + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
			osc.connect(gain).connect(out);
			osc.start(at);
			osc.stop(at + 0.4);
		});
	}
}
