// The level and the song together: the song clock (clock.ts) between the audio element's
// updates, after seeks, with the audio delay and for input events; what's heard in the song
// (audio.ts) at the times it's played; and the level's presses on the song's notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SongClock } from '../../src/lib/dash/clock';
import { hearSong, hitAt, loudness } from '../../src/lib/dash/audio';
import { parseChart } from '../../src/lib/dash/chart';
import { generateLevel } from '../../src/lib/dash/generate';
import { makeAudio, makeOsu } from './fixtures';

/**
 * A song playing from `from` (ms): the audio element's time as the page sees it, in steps of
 * about 20 ms, a few ms off now and then; read by the clock at every frame (`every` ms)
 */
function playing(clock: SongClock, from: number, seconds: number, every = 7) {
	let seed = 5;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const reads: { now: number; truth: number; read: number }[] = [];
	let raw = from;
	let nextUpdate = 0;
	for (let now = 0; now <= seconds * 1000; now += every) {
		const truth = from + now;
		if (now >= nextUpdate) {
			raw = truth - rnd() * 6;
			nextUpdate = now + 15 + rnd() * 10;
		}
		reads.push({ now, truth, read: clock.read(raw, 1000 + now, false) });
	}
	return reads;
}

test('paused, the clock is the audio time as it is', () => {
	const clock = new SongClock();
	assert.equal(clock.read(1234, 50, true), 1234);
});

test('playing, the clock runs on smoothly between the audio updates and never goes back', () => {
	const reads = playing(new SongClock(), 2000, 5);
	for (let i = 1; i < reads.length; i++) assert.ok(reads[i].read >= reads[i - 1].read);
	const settled = reads.filter((r) => r.now > 500);
	const worst = Math.max(...settled.map((r) => Math.abs(r.read - r.truth)));
	assert.ok(worst < 12, `off by up to ${worst.toFixed(1)} ms`);
});

test('the same at 30 and at 240 frames a second', () => {
	for (const every of [1000 / 30, 1000 / 240]) {
		const settled = playing(new SongClock(), 0, 4, every).filter((r) => r.now > 500);
		const worst = Math.max(...settled.map((r) => Math.abs(r.read - r.truth)));
		assert.ok(worst < 12, `${(1000 / every).toFixed(0)} fps: off by ${worst.toFixed(1)} ms`);
	}
});

test('a seek is taken at once, and so is the time after jumped()', () => {
	const clock = new SongClock();
	playing(clock, 5000, 1);
	// (the song went back to 1 s, the page is at 1000 + 1000 ms)
	assert.equal(clock.read(1000, 2010, false), 1000);
	clock.jumped();
	assert.equal(clock.read(7000, 2020, false), 7000);
});

test('the audio delay holds the game back by as much', () => {
	const clock = new SongClock();
	clock.delay = 150;
	assert.equal(clock.read(1000, 0, true), 850);
	const settled = playing(clock, 3000, 3).filter((r) => r.now > 500);
	for (const r of settled) assert.ok(Math.abs(r.read - (r.truth - 150)) < 12);
});

test('an input event counts at the time it happened, not when it was handled', () => {
	const clock = new SongClock();
	const at = (event: number, now: number) => clock.at(event, 5000, now, true);
	assert.equal(at(980, 1000), 5000 - 20);
	// (no time stamp to go by, or one from long ago: now)
	assert.equal(at(0, 1000), 5000);
	assert.equal(at(1200, 1000), 5000);
});

// --- What's heard ------------------------------------------------------------------------

test('the kicks are heard where they are played, the hi-hats are hits but no kicks', async () => {
	const song = {
		bpm: 128,
		length: 40,
		style: 'mixed' as const,
		breaks: [[10000, 14000]] as [number, number][]
	};
	const { buffer, kicks, hats } = makeAudio(song);
	const sound = await hearSong(buffer);
	const heard = (t: number) => {
		let best = 0;
		let at = t;
		for (let n = Math.floor((t - 40) / sound.hop); n <= Math.ceil((t + 40) / sound.hop); n++)
			if ((sound.kicks![n] ?? 0) > best) {
				best = sound.kicks![n];
				at = n * sound.hop;
			}
		return { best, at };
	};
	const played = (t: number) => !(t > 10000 && t < 14000);
	for (const t of kicks.filter(played)) {
		const { best, at } = heard(t);
		assert.ok(best > 0.7, `kick at ${t.toFixed(0)}: ${best.toFixed(2)}`);
		assert.ok(Math.abs(at - t) <= 10, `kick at ${t.toFixed(0)} heard at ${at.toFixed(0)}`);
	}
	const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
	assert.ok(mean(hats.filter(played).map((t) => heard(t).best)) < 0.6, 'hi-hats are no kicks');
	assert.ok(mean(hats.filter(played).map((t) => hitAt(sound, t))) > 0.6, 'hi-hats are hits');
	assert.ok(loudness(sound, 10500, 13500) < 0.1, 'the break is quiet');
	assert.ok(
		loudness(sound, 25000, 35000) > loudness(sound, 2000, 9000) * 1.4,
		'louder when intense'
	);
});

test("the analysis' time doesn't drift over a long song", async () => {
	const song = { bpm: 140, length: 240, style: 'calm' as const };
	const { buffer, kicks } = makeAudio(song);
	const sound = await hearSong(buffer);
	assert.ok(Math.abs(sound.loud.length * sound.hop - 240000) < sound.hop * 2);
	for (const t of kicks.slice(-20)) {
		const n = Math.round(t / sound.hop);
		const near = Math.max(...[-1, 0, 1].map((k) => sound.kicks![n + k] ?? 0));
		assert.ok(near > 0.7, `kick at ${(t / 1000).toFixed(1)} s heard ${near.toFixed(2)}`);
	}
});

// --- The level on the song ---------------------------------------------------------------

test("the level's clicks are on the song's notes, its beats on the beatmap's", async () => {
	const song = {
		bpm: 150,
		length: 70,
		style: 'mixed' as const,
		kiai: [[40000, 62000]] as [number, number][]
	};
	const chart = parseChart(makeOsu(song))!;
	const notes = chart.notes.map((n) => n.time);
	chart.sound = await hearSong(makeAudio(song).buffer);
	const beat = 60000 / song.bpm;
	for (const difficulty of ['normal', 'insane'] as const) {
		const level = generateLevel(chart, { difficulty, seed: 'sync', duration: 70000 });
		const onTheMusic = (t: number) => {
			const quarter = (t - 1000) / (beat / 4);
			return (
				notes.some((n) => Math.abs(n - t) <= 10) ||
				Math.abs(quarter - Math.round(quarter)) * (beat / 4) <= 10
			);
		};
		const clicks = level.plan.filter(
			(e) =>
				e.down && ['cube', 'ball', 'ufo', 'spider'].includes(level.world.sectionAt(e.time).mode)
		);
		assert.ok(clicks.length > 20);
		const off = clicks.filter((e) => !onTheMusic(e.time));
		assert.equal(off.length, 0, `off the music: ${off.map((e) => e.time.toFixed(0)).join(', ')}`);
		for (const b of level.beats) {
			const k = (b.time - 1000) / beat;
			assert.ok(Math.abs(k - Math.round(k)) < 1e-6);
		}
		// Where the player is and when: one way and back, the whole level
		for (let t = level.start; t <= level.end; t += 97) {
			assert.ok(Math.abs(level.world.timeAt(level.world.xAt(t)) - t) < 1e-6);
			assert.ok(level.world.xAt(t + 97) > level.world.xAt(t));
		}
	}
});
