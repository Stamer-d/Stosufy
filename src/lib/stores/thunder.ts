// Lightning you can hear, like on live lightning maps: a short blip for each new strike
// around you (from its side), and for strikes close by the thunder itself, as late as the
// sound takes to get to you (3 s per km), the closer the louder and the sharper.

import { get, writable } from 'svelte/store';
import { strikes, type Strike } from './lightning';
import { userSettings } from './user';
import { distanceKm } from '../map';
import { SPEED_OF_SOUND } from '../storm';

/** Whether lightning is heard */
export const thunderOn = writable(false);

/** Strikes this far away get a blip; this near, thunder */
const BLIP_KM = 150;
const THUNDER_KM = 40;

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let listener: { lat: number; lon: number } | null = null;
let lastStrike = Date.now();
let blipsThisSecond = 0;
let blipSecond = 0;
let thundering = 0;

/** Where you are, for the distances (and so the delays) */
export function setListener(place: { lat: number; lon: number } | null) {
	listener = place;
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
	out!.gain.value = Math.min(1.5, volume * 14);
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

/** A short blip for a strike, from its direction */
function blip(bearing: number, km: number) {
	const context = audio();
	const now = context.currentTime;
	const osc = context.createOscillator();
	osc.type = 'triangle';
	osc.frequency.setValueAtTime(2200, now);
	osc.frequency.exponentialRampToValueAtTime(700, now + 0.05);
	const gain = context.createGain();
	const level = 0.05 + 0.1 * (1 - km / BLIP_KM);
	gain.gain.setValueAtTime(level, now);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
	const pan = context.createStereoPanner();
	pan.pan.value = Math.sin((bearing * Math.PI) / 180) * 0.8;
	osc.connect(gain).connect(pan).connect(out!);
	osc.start(now);
	osc.stop(now + 0.08);
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
	const fresh = list.filter((s) => s.time > lastStrike);
	if (fresh.length) lastStrike = Math.max(...fresh.map((s) => s.time));
	if (!get(thunderOn) || !listener) return;
	const now = Date.now();
	for (const strike of fresh) {
		const km = distanceKm(listener, strike);
		if (km > BLIP_KM) continue;
		const bearing = bearingTo(listener, strike);
		const second = Math.floor(now / 1000);
		if (second !== blipSecond) {
			blipSecond = second;
			blipsThisSecond = 0;
		}
		if (blipsThisSecond++ < 8) blip(bearing, km);
		if (km <= THUNDER_KM) {
			// The sound left the strike when it happened: what's left of its way to you
			const delay = km / SPEED_OF_SOUND - (now - strike.time) / 1000;
			if (delay > -2) thunder(km, bearing, delay);
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
		blip(90, 20);
	}
}
