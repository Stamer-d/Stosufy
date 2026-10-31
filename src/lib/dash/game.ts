// A Dash level being played: the attempts, dying and starting again (from the start, or in
// practice from the last checkpoint), autoplay, and the best progress per song.

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

export class DashGame {
	state: PlayerState;
	status: Status = 'ready';
	attempt = 1;
	practice = false;
	auto = false;
	checkpoints: Checkpoint[] = [];
	diedAt = 0;
	jumps = 0;
	/** Presses not handled yet */
	private queue: InputEvent[] = [];
	private planIndex = 0;
	private lastCheckpoint = 0;
	/** When this attempt started (song ms) */
	attemptStart = 0;
	/** The state one step before (for drawing between the steps) */
	private before = { time: 0, y: 0, rotation: 0, mode: '' };

	constructor(public level: Level) {
		this.state = startState(level.world, level.start);
		this.remember();
	}

	private remember() {
		const s = this.state;
		this.before = { time: s.time, y: s.y, rotation: s.rotation, mode: s.mode };
	}

	/**
	 * The player as it should be drawn at a song time: between the last two steps, so it moves
	 * as smoothly as the screen does (the steps are 240 a second, the frames aren't)
	 */
	view(time: number): PlayerState {
		const s = this.state;
		const b = this.before;
		if (this.status !== 'playing' || s.time <= b.time || b.mode !== s.mode) return s;
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
		this.queue = [];
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

	/** The button, at a song time */
	input(down: boolean, time: number) {
		if (this.auto || this.status !== 'playing') return;
		this.queue.push({ time, down });
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
				while (this.queue.length && this.queue[0].time <= next) {
					const event = this.queue.shift()!;
					if (event.down && !s.held) this.jumps++;
					press(s, event.down);
				}
			}
			if (this.status === 'complete') {
				// Past the end: on it goes, nothing can stop it
				s.time = next;
				s.x = this.level.world.xAt(next);
				continue;
			}
			this.remember();
			for (const e of step(this.level.world, s, next)) happened.push(e);
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
				happened.push('complete');
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
				happened.push('checkpoint');
			}
		}
		return happened;
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
