// Built-in hitsounds, synthesized, for when no osu! skin is chosen or a skin lacks a sample.
// Normal is a bright click, soft a muted one, drum a deeper kit.

import type { HitSound, SampleSet } from './chart';

type Synth = (t: number) => number;

const noise = () => Math.random() * 2 - 1;
const decay = (t: number, length: number) => Math.exp(-t / length);
const tone = (t: number, frequency: number) => Math.sin(2 * Math.PI * frequency * t);

const SOUNDS: Record<SampleSet, Record<HitSound, { length: number; synth: Synth }>> = {
	normal: {
		normal: {
			length: 0.08,
			synth: (t) => tone(t, 1600) * decay(t, 0.012) * 0.6 + noise() * decay(t, 0.004) * 0.5
		},
		whistle: { length: 0.25, synth: (t) => tone(t, 2200 + 800 * t) * decay(t, 0.07) * 0.5 },
		finish: {
			length: 0.9,
			synth: (t) => (noise() * 0.7 + tone(t, 5200) * 0.2) * decay(t, 0.22) * 0.5
		},
		clap: {
			length: 0.18,
			synth: (t) =>
				noise() *
				(decay(t, 0.01) +
					decay(Math.max(0, t - 0.012), 0.01) * (t > 0.012 ? 1 : 0) +
					decay(Math.max(0, t - 0.024), 0.05) * (t > 0.024 ? 1 : 0)) *
				0.45
		},
		slidertick: { length: 0.04, synth: (t) => tone(t, 2600) * decay(t, 0.006) * 0.35 }
	},
	soft: {
		normal: { length: 0.1, synth: (t) => tone(t, 700) * decay(t, 0.02) * 0.6 },
		whistle: { length: 0.3, synth: (t) => tone(t, 1300 + 300 * t) * decay(t, 0.09) * 0.4 },
		finish: {
			length: 0.8,
			synth: (t) => (noise() * 0.4 + tone(t, 3100) * 0.2) * decay(t, 0.2) * 0.45
		},
		clap: { length: 0.15, synth: (t) => noise() * decay(t, 0.03) * 0.35 },
		slidertick: { length: 0.04, synth: (t) => tone(t, 1500) * decay(t, 0.008) * 0.3 }
	},
	drum: {
		normal: {
			length: 0.25,
			synth: (t) => tone(t, 55 + 110 * decay(t, 0.03)) * decay(t, 0.08) * 0.9
		},
		whistle: {
			length: 0.3,
			synth: (t) => tone(t, 180 + 60 * decay(t, 0.05)) * decay(t, 0.09) * 0.7
		},
		finish: { length: 1.2, synth: (t) => noise() * decay(t, 0.35) * 0.5 },
		clap: {
			length: 0.22,
			synth: (t) => (noise() * 0.6 + tone(t, 190) * 0.4) * decay(t, 0.05) * 0.7
		},
		slidertick: { length: 0.05, synth: (t) => tone(t, 900) * decay(t, 0.01) * 0.35 }
	}
};

const cache = new Map<string, AudioBuffer>();

/** The built-in sample of a set and sound */
export function builtinSample(context: BaseAudioContext, set: SampleSet, sound: HitSound) {
	const key = `${set}-${sound}`;
	let buffer = cache.get(key);
	if (!buffer) {
		const { length, synth } = SOUNDS[set][sound];
		const rate = context.sampleRate;
		buffer = context.createBuffer(1, Math.ceil(length * rate), rate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = synth(i / rate);
		// Fade the last 5 ms, so nothing clicks
		const fade = Math.min(data.length, Math.round(rate * 0.005));
		for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
		cache.set(key, buffer);
	}
	return buffer;
}
