// A level being played (game.ts): the same presses give the same run however many frames a
// second it's drawn at and however unevenly; a press that comes in late counts when it was made;
// starting again starts from nothing; a hitch doesn't run away with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashGame, ROLLBACK } from '../../src/lib/dash/game';
import { SPEEDS, STEP, type InputEvent } from '../../src/lib/dash/physics';
import { levelOf, tap, world } from './worlds';

/** A few seconds of cube with spikes to jump, then a UFO part: the presses that get through */
function course() {
	const w = world({ length: 4000 }, { mode: 'ufo', length: 3000 });
	const at = (time: number) => SPEEDS[1] * (time / 1000);
	const inputs: InputEvent[] = [];
	for (const time of [600, 1400, 2300, 3200]) {
		w.spike(at(time) + 3, 0);
		inputs.push(...tap(time, 90));
	}
	inputs.push(...tap(4400), ...tap(4900), ...tap(5400), ...tap(5900));
	return { level: levelOf(w), inputs };
}

/**
 * Plays it frame by frame: each press handed over at the first frame after it was made (with
 * its own time), as the page does. Returns the end and what happened.
 */
function play(frames: number[], options: { auto?: boolean; late?: number } = {}) {
	const { level, inputs } = course();
	const game = new DashGame(level);
	game.auto = !!options.auto;
	game.begin(false);
	const happened: string[] = [];
	/** When it jumped (each jump's step, as the frames see them) */
	const jumps: number[] = [];
	let k = 0;
	for (const time of frames) {
		// Late: the frame is drawn first, the press handed over after it
		if (!options.late)
			while (k < inputs.length && inputs[k].time <= time) {
				game.input(inputs[k].down, inputs[k].time);
				k++;
			}
		happened.push(...game.update(time));
		if (game.state.jumpedAt > 0 && game.state.jumpedAt !== jumps[jumps.length - 1])
			jumps.push(game.state.jumpedAt);
		if (options.late)
			while (k < inputs.length && inputs[k].time <= time) {
				game.input(inputs[k].down, inputs[k].time);
				k++;
			}
	}
	return { game, happened, jumps };
}

/** Frames at a steady rate, a bit past the end of the course (7 s) */
const steady = (fps: number, until = 7200) => {
	const frames: number[] = [];
	for (let t = 0; t <= until; t += 1000 / fps) frames.push(t);
	frames.push(until);
	return frames;
};

const summary = ({ game, happened, jumps }: ReturnType<typeof play>) => ({
	jumps: jumps.map((t) => t.toFixed(6)).join(','),
	status: game.status,
	time: game.state.time,
	x: game.state.x,
	y: game.state.y,
	vy: game.state.vy,
	mode: game.state.mode,
	happened: happened.join(',')
});

test('the presses get through the course (or the course would test nothing)', () => {
	const { game } = play(steady(60));
	assert.equal(game.status, 'complete');
	const { level } = course();
	const none = new DashGame(level);
	none.begin(false);
	for (const t of steady(60)) none.update(t);
	assert.equal(none.status, 'dead', 'without pressing it crashes');
});

test('the same run at 24, 30, 60, 144, 240 and 360 frames a second', () => {
	const at60 = summary(play(steady(60)));
	for (const fps of [24, 30, 144, 240, 360])
		assert.deepEqual(summary(play(steady(fps))), at60, `${fps} fps`);
});

test('the same run with frames coming unevenly, and with hitches', () => {
	const at60 = summary(play(steady(60)));
	let seed = 3;
	const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const frames: number[] = [];
	for (let t = 0; t < 7200;) {
		t += rnd() < 0.05 ? 250 + rnd() * 400 : 4 + rnd() * 40;
		frames.push(Math.min(7200, t));
	}
	assert.deepEqual(summary(play(frames)), at60);
});

test('a press handed over after the frame that passed it counts when it was made', () => {
	const onTime = summary(play(steady(60)));
	// At 30 frames a second it comes in up to 33 ms late: within what's played again
	assert.ok(1000 / 30 < ROLLBACK);
	assert.deepEqual(summary(play(steady(30), { late: 1 })), onTime);
	assert.deepEqual(summary(play(steady(24), { late: 1 })), onTime);
});

test('played again after a late press, nothing is told twice', () => {
	const { happened } = play(steady(30), { late: 1 });
	const onTime = play(steady(60)).happened;
	for (const name of ['jump', 'land', 'portal', 'complete'])
		assert.equal(
			happened.filter((h) => h === name).length,
			onTime.filter((h) => h === name).length,
			name
		);
});

test('a press later than it can go back for counts from now', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.begin(false);
	game.update(400);
	game.input(true, 400 - ROLLBACK - 50);
	game.update(400 + STEP * 2);
	assert.equal(game.status, 'playing');
	assert.ok(game.state.jumpedAt >= 400, `jumped at ${game.state.jumpedAt}`);
});

test('a press counts for the jumps once, however often it is played again', () => {
	const { game } = play(steady(24), { late: 1 });
	assert.equal(game.jumps, 8);
});

test('starting again: from the start, with nothing held or left over', () => {
	const { level, inputs } = course();
	const game = new DashGame(level);
	game.begin(false);
	game.input(true, 100);
	for (const t of steady(60, 3000)) game.update(t);
	assert.equal(game.status, 'dead');
	const songAt = game.begin(false);
	assert.equal(songAt, level.start);
	assert.equal(game.status, 'playing');
	assert.equal(game.state.time, level.start);
	assert.equal(game.state.x, level.world.xAt(level.start));
	assert.equal(game.state.held, false);
	assert.equal(game.state.dead, false);
	// And the run from there is the run from a new game
	for (const e of inputs) game.input(e.down, e.time);
	for (const t of steady(60)) game.update(t);
	assert.equal(game.status, 'complete');
});

test('practice: from the last checkpoint, the song a moment before it', () => {
	const { level, inputs } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.begin(false);
	for (const e of inputs.filter((e) => e.time < 3000)) game.input(e.down, e.time);
	for (const t of steady(60)) game.update(t);
	assert.equal(game.status, 'dead');
	assert.ok(game.checkpoints.length > 0);
	const checkpoint = game.checkpoints[game.checkpoints.length - 1];
	const songAt = game.begin(true);
	assert.equal(game.state.time, checkpoint.state.time);
	assert.equal(songAt, checkpoint.state.time - 450);
});

test('a hitch moves the game on by a second at most', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.auto = true;
	game.begin(false);
	game.update(100);
	game.update(6000);
	assert.ok(game.state.time <= 1100 + STEP, `at ${game.state.time}`);
});

test('autoplay plays the level the same at any frame rate', () => {
	const { level, inputs } = course();
	level.plan = inputs;
	const ends = [24, 60, 240].map((fps) => {
		const game = new DashGame(level);
		game.auto = true;
		game.begin(false);
		for (const t of steady(fps)) game.update(t);
		return { status: game.status, x: game.state.x, y: game.state.y };
	});
	assert.equal(ends[0].status, 'complete');
	assert.deepEqual(ends[1], ends[0]);
	assert.deepEqual(ends[2], ends[0]);
});

test('practice: a checkpoint set by the player, also in the air, is where it starts again', () => {
	const { level, inputs } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.autoCheckpoints = false;
	game.begin(false);
	for (const e of inputs.filter((e) => e.time < 2000)) game.input(e.down, e.time);
	game.update(1450);
	assert.equal(game.state.grounded, false, 'in the air after the jump at 1400');
	assert.ok(game.placeCheckpoint(game.state.time));
	assert.equal(game.checkpoints.length, 1);
	const set = game.checkpoints[0];
	assert.equal(set.manual, true);
	assert.ok(set.state.vy !== 0, 'the jump goes on from there');
	for (const t of steady(60, 3000)) game.update(t);
	assert.equal(game.status, 'dead', 'no press for the spike at 2300');
	assert.equal(game.checkpoints.length, 1, 'no automatic ones when they are off');
	game.begin(true);
	assert.equal(game.state.time, set.state.time);
	assert.equal(game.state.y, set.state.y);
	assert.equal(game.state.vy, set.state.vy);
});

test('practice: a checkpoint asked for between two steps is set when the game gets there', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.autoCheckpoints = false;
	game.begin(false);
	game.update(500);
	assert.ok(game.placeCheckpoint(520));
	assert.equal(game.checkpoints.length, 0);
	const happened = game.update(560);
	assert.ok(happened.includes('checkpoint'));
	assert.equal(game.checkpoints.length, 1);
	assert.ok(Math.abs(game.checkpoints[0].state.time - 520) <= STEP);
});

test('practice: the last checkpoint can be taken away, also while waiting to respawn', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.autoCheckpoints = false;
	game.begin(false);
	game.update(300);
	game.placeCheckpoint(300);
	game.update(500);
	game.placeCheckpoint(500);
	game.update(520);
	assert.equal(game.checkpoints.length, 2);
	assert.ok(game.removeCheckpoint());
	assert.equal(game.checkpoints.length, 1);
	assert.ok(Math.abs(game.checkpoints[0].state.time - 300) <= STEP);
	// (one asked for and not set yet goes first)
	game.placeCheckpoint(game.state.time + 30);
	assert.ok(game.removeCheckpoint());
	game.update(600);
	assert.equal(game.checkpoints.length, 1);
	// Crashes into the first spike, then the last one goes before it starts again
	for (const t of steady(60, 2000)) game.update(t);
	assert.equal(game.status, 'dead');
	assert.ok(game.removeCheckpoint());
	assert.equal(game.checkpoints.length, 0);
	assert.equal(game.removeCheckpoint(), false);
	assert.equal(game.begin(true), level.start, 'none left: from the start');
});

test('practice: a checkpoint of the player stays when it crashes right after it', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.begin(false);
	// (no presses: it crashes into the first spike, a moment after the checkpoint)
	let t = 0;
	while (game.status === 'playing' && t < 2000) {
		t += 1000 / 60;
		game.update(t);
		if (!game.checkpoints.some((c) => c.manual) && game.state.x > level.world.xAt(600) + 1.6)
			game.placeCheckpoint(game.state.time);
	}
	assert.equal(game.status, 'dead');
	assert.ok(game.checkpoints.some((c) => c.manual));
});

test('practice: a late press that goes back before a checkpoint of the player keeps it', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.practice = true;
	game.autoCheckpoints = false;
	game.begin(false);
	game.update(580);
	game.placeCheckpoint(580);
	game.update(610);
	// The press for the spike, made at 570 but handed over now: played again from before it
	game.input(true, 570);
	game.input(false, 660);
	game.update(700);
	assert.equal(game.checkpoints.length, 1, 'set again where it was');
	assert.equal(game.checkpoints[0].manual, true);
	assert.ok(Math.abs(game.checkpoints[0].state.time - 580) <= STEP);
	assert.ok(game.checkpoints[0].state.jumpedAt > 0, 'from the run with the late press in it');
});

test('without practice no checkpoint is set', () => {
	const { level } = course();
	const game = new DashGame(level);
	game.begin(false);
	game.update(300);
	assert.equal(game.placeCheckpoint(300), false);
	assert.equal(game.checkpoints.length, 0);
});
