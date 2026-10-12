// Lightning you can hear, like on live lightning maps: a crackle for each new strike on the
// map (from its side of it), and for strikes close to you the thunder itself, as late as the
// sound takes to get to you (3 s per km), the closer the louder and the sharper.

import { get, writable } from 'svelte/store';
import { strikes, type Strike } from './lightning';
import { userSettings } from './user';
import { distanceKm } from '../map';
import { SPEED_OF_SOUND } from '../storm';

/** Whether lightning is heard */
export const thunderOn = writable(false);

/** Without a map: strikes this far from you crackle; this near, thunder too */
const CRACKLE_KM = 150;
const THUNDER_KM = 40;
/** At most this many crackles a second (a big storm has dozens of strikes a second) */
const CRACKLES_PER_SECOND = 10;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let listener: { lat: number; lon: number } | null = null;
let view: { north: number; south: number; west: number; east: number } | null = null;
/** The last strike handled (the ones after it in the list are new) */
let lastHeard: Strike | null = null;
let cracklesThisSecond = 0;
let crackleSecond = 0;
let thundering = 0;

/** Where you are, for the distances (and so the delays) */
export function setListener(place: { lat: number; lon: number } | null) {
	listener = place;
}

/** The part of the world shown on the map: its strikes crackle (null: no map) */
export function setView(bounds: typeof view) {
	view = bounds;
}

function audio() {
	if (!ctx) {
		ctx = new AudioContext();
		out = ctx.createGain();
		out.connect(ctx.destination);
	}
	if (ctx.state !== 'running') ctx.resume().catch(() => {});
	// As loud as the app (its volume is small numbers, 0.05 is normal)
	const settings = get(userSettings).settings;
	const volume = settings?.muted ? 0 : (settings?.volume ?? 0.05);
	out!.gain.value = volume ? Math.min(1.5, Math.max(0.3, volume * 14)) : 0;
	return ctx;
}

function noise(context: AudioContext, seconds: number, brown: boolean) {
	const buffer = context.createBuffer(
		1,
		Math.ceil(context.sampleRate * seconds),
		context.sampleRate
	);
	const data = buffer.getChannelData(0);
	let last = 0;
	for (let i = 0; i < data.length; i++) {
		const white = Math.random() * 2 - 1;
		if (brown) {
			last = (last + 0.02 * white) / 1.02;
			data[i] = last * 3.5;
		} else data[i] = white;
	}
	return buffer;
}

// A few crackles made once (each strike plays one of them, a bit faster or slower)
let crackles: AudioBuffer[] = [];

/** The crackle of a strike: a snap, then a burst of tiny irregular clicks that dies away */
function makeCrackle(context: AudioContext) {
	const rate = context.sampleRate;
	const length = 0.16 + Math.random() * 0.2;
	const buffer = context.createBuffer(1, Math.ceil(rate * length), rate);
	const data = buffer.getChannelData(0);
	let at = 0;
	let first = true;
	while (at < data.length) {
		const decay = Math.exp(-at / (rate * length * 0.3));
		const level = (first ? 1 : 0.25 + Math.random() * 0.75) * decay;
		const clickLength = Math.floor(rate * (first ? 0.004 : 0.0003 + Math.random() * 0.0016));
		for (let i = 0; i < clickLength && at + i < data.length; i++)
			data[at + i] += level * (Math.random() * 2 - 1) * (1 - i / clickLength);
		first = false;
		// Uneven gaps: mostly short, now and then longer
		at += Math.floor(rate * (0.0015 + Math.random() ** 2.5 * 0.035));
	}
	return buffer;
}

/** A crackle for a strike, from its side (-1 left to 1 right) */
function crackle(side: number, level = 1) {
	const context = audio();
	if (crackles.length < 8) crackles.push(makeCrackle(context));
	const now = context.currentTime;
	const source = context.createBufferSource();
	source.buffer = crackles[Math.floor(Math.random() * crackles.length)];
	source.playbackRate.value = 0.8 + Math.random() * 0.45;
	const high = context.createBiquadFilter();
	high.type = 'highpass';
	high.frequency.value = 700;
	const presence = context.createBiquadFilter();
	presence.type = 'peaking';
	presence.frequency.value = 3200;
	presence.gain.value = 6;
	const gain = context.createGain();
	gain.gain.value = 0.55 * level;
	const pan = context.createStereoPanner();
	pan.pan.value = Math.max(-1, Math.min(1, side)) * 0.85;
	source.connect(high).connect(presence).connect(gain).connect(pan).connect(out!);
	source.start(now);
}

/** Thunder from a strike some km away, in some seconds */
function thunder(km: number, bearing: number, delay: number) {
	if (thundering >= 4) return;
	const context = audio();
	const start = context.currentTime + Math.max(0, delay);
	const length = 2.5 + Math.min(6, km / 5);
	const near = Math.max(0, 1 - km / THUNDER_KM);
	const pan = context.createStereoPanner();
	pan.pan.value = Math.sin((bearing * Math.PI) / 180) * 0.6;
	pan.connect(out!);
	thundering++;
	setTimeout(() => thundering--, (Math.max(0, delay) + length) * 1000);

	// Close by: the crack first
	if (km < 4) {
		const crack = context.createBufferSource();
		crack.buffer = noise(context, 0.35, false);
		const high = context.createBiquadFilter();
		high.type = 'highpass';
		high.frequency.value = 900;
		const gain = context.createGain();
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.9 * (1 - km / 4) + 0.1, start + 0.008);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
		crack.connect(high).connect(gain).connect(pan);
		crack.start(start);
	}

	// The rumble: low, rolling (a few swells), duller the further it is
	const rumble = context.createBufferSource();
	rumble.buffer = noise(context, length + 0.5, true);
	const low = context.createBiquadFilter();
	low.type = 'lowpass';
	low.frequency.value = 120 + 900 * near * near;
	const gain = context.createGain();
	const peak = 0.12 + 0.88 * near ** 1.3;
	gain.gain.setValueAtTime(0.0001, start);
	gain.gain.exponentialRampToValueAtTime(peak, start + 0.05 + (1 - near) * 0.6);
	let t = start + 0.4;
	let level = peak;
	while (t < start + length) {
		level *= 0.55 + Math.random() * 0.35;
		const swell = Math.min(peak, level * (1.2 + Math.random() * 0.8));
		gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, swell), t);
		t += 0.35 + Math.random() * 0.7;
	}
	gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
	rumble.connect(low).connect(gain).connect(pan);
	rumble.start(start);
	rumble.stop(start + length + 0.5);
}

function bearingTo(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
	const rad = Math.PI / 180;
	const y = Math.sin((to.lon - from.lon) * rad) * Math.cos(to.lat * rad);
	const x =
		Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
		Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos((to.lon - from.lon) * rad);
	return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function hear(list: Strike[]) {
	// New strikes are added at the end (in the order they come, not always by time)
	const from = lastHeard ? list.lastIndexOf(lastHeard) + 1 : list.length;
	const fresh = from > 0 ? list.slice(from) : list.filter((s) => s.time > Date.now() - 20000);
	lastHeard = list.at(-1) ?? lastHeard;
	if (!get(thunderOn) || !fresh.length) return;
	const now = Date.now();
	for (const strike of fresh) {
		// Strikes long ago (sent late) make no sound
		if (now - strike.time > 20000) continue;
		const km = listener ? distanceKm(listener, strike) : Infinity;
		let side: number | null = null;
		if (view) {
			const inside =
				strike.lat <= view.north &&
				strike.lat >= view.south &&
				strike.lon >= view.west &&
				strike.lon <= view.east;
			if (inside) side = ((strike.lon - view.west) / (view.east - view.west)) * 2 - 1;
		} else if (km <= CRACKLE_KM) side = Math.sin((bearingTo(listener!, strike) * Math.PI) / 180);
		if (side !== null) {
			const second = Math.floor(now / 1000);
			if (second !== crackleSecond) {
				crackleSecond = second;
				cracklesThisSecond = 0;
			}
			if (cracklesThisSecond++ < CRACKLES_PER_SECOND) {
				// A bit after each other, not all on the same moment
				const spread = Math.random() * 250;
				setTimeout(() => crackle(side!, 0.6 + Math.random() * 0.4), spread);
			}
		}
		if (km <= THUNDER_KM) {
			// The sound left the strike when it happened: what's left of its way to you
			const delay = km / SPEED_OF_SOUND - (now - strike.time) / 1000;
			if (delay > -2) thunder(km, bearingTo(listener!, strike), delay);
		}
	}
}

strikes.subscribe(hear);

/** Turns the sound on (needs a click, for the browser's audio) or off */
export function toggleThunder() {
	const on = !get(thunderOn);
	thunderOn.set(on);
	if (on) {
		audio();
		// A taste of it, so it's clear it's on
		crackle(0);
	}
}
