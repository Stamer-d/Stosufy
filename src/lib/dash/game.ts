// A Dash level being played: the attempts, dying and starting again (from the start, or in
// practice from the last checkpoint), autoplay, and the best progress per song. Presses count
// at the song time they were made, also when they come in a moment late (the page was busy
// drawing): the game goes back to just before them and plays those steps again.

import {
	STEP,
	copyState,
	press,
	startState,
	step,
	type InputEvent,
	type PlayerState
} from './physics';
import type { Difficulty, Level } from './generate';

export type Status = 'ready' | 'playing' | 'dead' | 'complete';

export interface Checkpoint {
	state: PlayerState;
	x: number;
	y: number;
}

/** How long it waits after dying before it starts again (ms) */
export const RESPAWN = 1000;
/** How long the player waits at a checkpoint before it goes on (ms of the song) */
const CHECKPOINT_LEAD = 450;
/** How far back a press that comes in late may still change what happened (ms of the song) */
export const ROLLBACK = 60;
/** How many steps are kept for that */
const KEEP = Math.ceil(ROLLBACK / STEP) + 2;

/** The game before a step: where a late press starts again from */
interface Kept {
	state: PlayerState;
	next: number;
	lastCheckpoint: number;
	checkpoints: number;
}

export class DashGame {
	state: PlayerState;
	status: Status = 'ready';
	attempt = 1;
	practice = false;
	auto = false;
	checkpoints: Checkpoint[] = [];
	diedAt = 0;
	jumps = 0;
	/** The presses and releases of this attempt, in order of time; from `next` on not used yet */
	private inputs: InputEvent[] = [];
	private next = 0;
	/** The game before each of the last steps */
	private kept: Kept[] = [];
	/** What happened in the last steps, and when (played again, it isn't told twice) */
	private told: { time: number; name: string }[] = [];
	/** Played again up to here after a late press */
	private replayed = -Infinity;
	private planIndex = 0;
	private lastCheckpoint = 0;
	/** When this attempt started (song ms) */
	attemptStart = 0;
	/** The state one step before (for drawing between the steps) */
	private before = { time: 0, y: 0, rotation: 0, mode: '', mini: false, gravity: 1, section: 0 };

	constructor(public level: Level) {
		this.state = startState(level.world, level.start);
		this.remember();
	}

	private remember() {
		const s = this.state;
		this.before = {
			time: s.time,
			y: s.y,
			rotation: s.rotation,
			mode: s.mode,
			mini: s.mini,
			gravity: s.gravity,
			section: s.section
		};
	}

	/**
	 * The player as it should be drawn at a song time: between the last two steps, so it moves
	 * as smoothly as the screen does (the steps are 240 a second, the frames aren't)
	 */
	view(time: number): PlayerState {
		const s = this.state;
		const b = this.before;
		if (
			this.status !== 'playing' ||
			s.time <= b.time ||
			b.mode !== s.mode ||
			b.mini !== s.mini ||
			b.gravity !== s.gravity ||
			b.section !== s.section
		)
			return s;
		const f = Math.max(0, Math.min(1, (time - s.time) / STEP));
		const at = b.time + (s.time - b.time) * f;
		// A teleport (the spider) or a snap: no sliding across
		const y = Math.abs(s.y - b.y) > 1.5 ? s.y : b.y + (s.y - b.y) * f;
		const turn = s.rotation - b.rotation;
		const rotation = Math.abs(turn) > Math.PI / 2 ? s.rotation : b.rotation + turn * f;
		return { ...s, time: at, x: this.level.world.xAt(at), y, rotation };
	}

	get progress() {
		return Math.max(0, Math.min(100, (this.state.x / this.level.xEnd) * 100));
	}

	/** Where the song should be for this attempt (ms) */
	begin(fromCheckpoint = false): number {
		this.inputs = [];
		this.next = 0;
		this.kept = [];
		this.told = [];
		this.replayed = -Infinity;
		const checkpoint =
			fromCheckpoint && this.practice ? this.checkpoints[this.checkpoints.length - 1] : null;
		this.state = checkpoint
			? copyState(checkpoint.state)
			: startState(this.level.world, this.level.start);
		this.state.held = false;
		this.state.buffered = false;
		this.status = 'playing';
		this.lastCheckpoint = this.state.time;
		this.attemptStart = this.state.time;
		this.planIndex = 0;
		while (
			this.planIndex < this.level.plan.length &&
			this.level.plan[this.planIndex].time < this.state.time
		)
			this.planIndex++;
		if (!checkpoint) this.checkpoints = [];
		this.remember();
		return checkpoint ? Math.max(0, this.state.time - CHECKPOINT_LEAD) : this.level.start;
	}

	/** The button, at the song time it was pressed or let go */
	input(down: boolean, time: number) {
		if (this.auto || this.status !== 'playing') return;
		if (down) this.jumps++;
		// From before where the game is: back to then, if that's not too long ago
		if (time < this.state.time && !this.rewind(time)) time = this.state.time;
		let i = this.inputs.length;
		while (i > this.next && this.inputs[i - 1].time > time) i--;
		this.inputs.splice(i, 0, { time, down });
	}

	/** Back to the game before the step a press at `time` belongs to; false if too long ago */
	private rewind(time: number) {
		let k = this.kept.length - 1;
		while (k >= 0 && this.kept[k].state.time >= time) k--;
		if (k < 0 || this.state.time - time > ROLLBACK) return false;
		const kept = this.kept[k];
		this.replayed = Math.max(this.replayed, this.state.time);
		this.kept.length = k;
		this.state = copyState(kept.state);
		this.next = kept.next;
		this.lastCheckpoint = kept.lastCheckpoint;
		this.checkpoints.length = kept.checkpoints;
		this.remember();
		return true;
	}

	/** Until the song time; returns what happened */
	update(time: number): string[] {
		const happened: string[] = [];
		if (this.status !== 'playing' && this.status !== 'complete') return happened;
		const s = this.state;
		// A hitch (or the song went on without us): not more than a second at once
		if (time - s.time > 1000) time = s.time + 1000;
		const plan = this.level.plan;
		while (s.time + STEP <= time && !s.dead) {
			const next = s.time + STEP;
			if (this.auto) {
				while (this.planIndex < plan.length && plan[this.planIndex].time <= next) {
					press(s, plan[this.planIndex].down);
					this.planIndex++;
				}
			} else {
				this.kept.push({
					state: copyState(s),
					next: this.next,
					lastCheckpoint: this.lastCheckpoint,
					checkpoints: this.checkpoints.length
				});
				if (this.kept.length > KEEP * 2) this.kept.splice(0, this.kept.length - KEEP);
				while (this.next < this.inputs.length && this.inputs[this.next].time <= next)
					press(s, this.inputs[this.next++].down);
			}
			if (this.status === 'complete') {
				// Past the end: on it goes, nothing can stop it
				s.time = next;
				s.x = this.level.world.xAt(next);
				continue;
			}
			this.remember();
			for (const name of step(this.level.world, s, next)) this.tell(happened, name, next);
			if (s.dead) {
				this.status = 'dead';
				this.diedAt = performance.now();
				// A checkpoint right before dying is no good
				const last = this.checkpoints[this.checkpoints.length - 1];
				if (last && s.time - last.state.time < 350 && this.checkpoints.length > 1)
					this.checkpoints.pop();
				break;
			}
			if (s.x >= this.level.xEnd) {
				this.status = 'complete';
				this.tell(happened, 'complete', next);
			}
			if (
				this.practice &&
				s.time - this.lastCheckpoint > 2200 &&
				(s.grounded ||
					s.mode === 'ship' ||
					s.mode === 'wave' ||
					s.mode === 'swing' ||
					s.mode === 'ufo') &&
				s.time - s.boostedAt > 300
			) {
				this.lastCheckpoint = s.time;
				const copy = copyState(s);
				this.checkpoints.push({ state: copy, x: s.x, y: s.y });
				this.tell(happened, 'checkpoint', next);
			}
		}
		return happened;
	}

	/** Something happened at a step (unless it was told already, before a late press) */
	private tell(happened: string[], name: string, time: number) {
		if (time <= this.replayed && this.told.some((t) => t.time === time && t.name === name)) return;
		happened.push(name);
		this.told.push({ time, name });
		if (this.told.length > 64) this.told = this.told.filter((t) => t.time > time - ROLLBACK * 2);
	}
}

// --- The best progress ---------------------------------------------------------------------

const KEY = 'stosufy-dash-best';

function readBest(): Record<string, { normal: number; practice: number; attempts: number }> {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '{}');
	} catch {
		return {};
	}
}

export function bestKey(song: string, difficulty: Difficulty) {
	return `${song}:${difficulty}`;
}

export function bestOf(key: string) {
	return readBest()[key] ?? { normal: 0, practice: 0, attempts: 0 };
}

/** The best progress on a beatmap set's levels at a difficulty, whichever of its maps made them */
export function bestOfSet(setId: string | number, difficulty: Difficulty) {
	const best = { normal: 0, practice: 0, attempts: 0 };
	for (const [key, entry] of Object.entries(readBest())) {
		if (!key.startsWith(`${setId}:`) || !key.endsWith(`:${difficulty}`)) continue;
		best.normal = Math.max(best.normal, entry.normal);
		best.practice = Math.max(best.practice, entry.practice);
		best.attempts = Math.max(best.attempts, entry.attempts);
	}
	return best;
}

export function saveBest(key: string, progress: number, practice: boolean, attempts: number) {
	const all = readBest();
	const entry = all[key] ?? { normal: 0, practice: 0, attempts: 0 };
	if (practice) entry.practice = Math.max(entry.practice, progress);
	else entry.normal = Math.max(entry.normal, progress);
	entry.attempts = Math.max(entry.attempts, attempts);
	all[key] = entry;
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {
		// Full or not allowed: only for now then
	}
	return entry;
}
