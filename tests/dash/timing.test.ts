// The map's timing points against the song (timing.ts): a new tempo's line set a bar too early or
// too late goes where the song changes, beats a few ms beside the song's go onto them (with the
// notes), and a map that's right stays as it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChart } from '../../src/lib/addons/dash/chart';
import { hearSong } from '../../src/lib/addons/dash/audio';
import { alignTiming, songOffset } from '../../src/lib/addons/dash/timing';
import { makeAudio, makeOsu, type SongOptions } from './fixtures';

/** 128 BPM, 170 from bar 24 on (where the song changes) */
const AT = 1000 + 24 * 4 * (60000 / 128);
const NEW = 60000 / 170;
const song = (change: Partial<NonNullable<SongOptions['change']>> = {}): SongOptions => ({
	bpm: 128,
	length: 75,
	style: 'intense',
	change: { at: AT, bpm: 170, ...change }
});

async function aligned(options: SongOptions) {
	const chart = parseChart(makeOsu(options))!;
	chart.sound = await hearSong(makeAudio(options).buffer);
	return { before: chart, after: alignTiming(chart) };
}

test('a map whose timing is right stays as it is', async () => {
	const { before, after } = await aligned(song());
	assert.equal(after.timing.length, 2);
	for (let i = 0; i < 2; i++)
		assert.ok(
			Math.abs(after.timing[i].time - before.timing[i].time) < 1,
			`${after.timing[i].time} ${before.timing[i].time}`
		);
});

test('a new tempo set a bar too early or too late goes where the song changes', async () => {
	for (const bars of [-1, 1, 2]) {
		const { before, after } = await aligned(song({ mapAt: AT + bars * 4 * NEW }));
		assert.ok(Math.abs(before.timing[1].time - AT) > 1000);
		assert.ok(
			Math.abs(after.timing[1].time - AT) < 2,
			`${bars} bars off: ${after.timing[1].time} instead of ${AT}`
		);
	}
});

test('beats a few ms beside the song go onto its beats, with the notes', async () => {
	for (const shift of [-24, 30]) {
		const { before, after } = await aligned(song({ shift }));
		assert.ok(
			Math.abs(after.timing[1].time - AT) <= 6,
			`${shift} ms off: ${after.timing[1].time} instead of ${AT}`
		);
		// (the song's first tempo stays)
		assert.equal(after.timing[0].time, before.timing[0].time);
		const note = before.notes.find((n) => n.time > AT + 2000)!;
		const moved = after.notes[before.notes.indexOf(note)];
		assert.ok(Math.abs(moved.time - (note.time - shift)) <= 6, `${note.time} → ${moved.time}`);
	}
});

test('without the song, the map stays as it is', () => {
	const chart = parseChart(makeOsu(song({ mapAt: AT - 4 * NEW })))!;
	assert.equal(alignTiming(chart), chart);
});

test("a map whose notes are all a bit beside the song's sound is moved onto it", async () => {
	for (const off of [-30, 0, 45]) {
		// (the song's beats at 1000 ms; the map says `off` ms earlier)
		const options: SongOptions = { bpm: 128, length: 60, style: 'intense' };
		const chart = parseChart(makeOsu({ ...options, offset: 1000 - off }))!;
		chart.sound = await hearSong(makeAudio({ ...options, offset: 1000 }).buffer);
		const found = songOffset(chart.sound, chart.notes);
		assert.ok(Math.abs(found - off) <= 4, `${off} ms off: found ${found}`);
		const after = alignTiming(chart);
		assert.ok(Math.abs(after.timing[0].time - 1000) <= 4, `${after.timing[0].time}`);
		assert.ok(Math.abs(after.notes[0].time - (chart.notes[0].time + off)) <= 4);
	}
});

test("without the song's sound, or with too few notes to tell, the map stays", () => {
	const chart = parseChart(makeOsu({ bpm: 128, length: 60, style: 'intense' }))!;
	assert.equal(songOffset(null, chart.notes), 0);
	assert.equal(alignTiming(chart), chart);
});
