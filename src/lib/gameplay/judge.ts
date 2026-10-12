// Plays a beatmap like osu! (stable) judges it: from cursor positions and keys over time
// (a replay, the autoplay's moves or the player's own mouse and keys) it works out the hits,
// 300s, 100s, 50s and misses, slider ticks and breaks, spinner spins, the combo, the score
// (osu!'s classic ScoreV1) and the accuracy. The same for all three, so they look and sound
// the same: hitsounds only play for what's hit, a combo break plays its sound.

import { MOD, parseGameplay, sliderBall, type GameplayBeatmap, type HitObject } from './beatmap';
import type { Frame } from './replay';

export type Result = 300 | 100 | 50 | 0;

export interface Judgement {
	time: number;
	x: number;
	y: number;
	result: Result;
	/** The end of a combo of only 300s (geki) or 300s and 100s (katu) */
	special?: 'geki' | 'katu';
	/** A missed slider tick or repeat: the combo breaks, shown smaller */
	sliderBreak?: boolean;
}

/**
 * A sound the play makes: the beatmap's hitsounds at a time of the map (only what's hit),
 * a spinner bonus or a combo break. "at" is when it plays (ms into the song).
 */
export type PlaySound =
	| { kind: 'hit'; time: number; at: number }
	| { kind: 'spinnerbonus'; at: number }
	| { kind: 'combobreak'; at: number };

export interface Snapshot {
	time: number;
	score: number;
	combo: number;
	maxCombo: number;
	accuracy: number;
	counts: { 300: number; 100: number; 50: number; 0: number };
}

export interface ObjectState {
	/** When the circle or slider head was hit (null: not hit) */
	hitTime: number | null;
	/** The head's result, once judged, and when */
	head: Result | null;
	headAt: number | null;
	/** The object's result and when it was judged */
	result: Result | null;
	judgedAt: number | null;
	/** Slider: whether each tick, repeat and the end were hit (null: not yet) */
	points: (boolean | null)[];
	/** Slider: when the ball was followed */
	tracking: { start: number; end: number }[];
	/** Spinner: how far it was spun (radians), over time */
	spins: { time: number; total: number }[];
}

export const KEY = { M1: 1, M2: 2, K1: 4, K2: 8 } as const;
/** osu! caps spinning at about 477 RPM */
const MAX_SPIN = (477 / 60000) * Math.PI * 2;
const FOLLOW_AREA = 2.4;
const COMBO_BREAK_SOUND = 20;
/** Before this the play hasn't started (nothing judged before the first input) */
const NOT_STARTED = -Infinity;

const MOD_MULTIPLIERS: [number, number][] = [
	[MOD.Easy, 0.5],
	[MOD.NoFail, 0.5],
	[MOD.HalfTime, 0.3],
	[MOD.HardRock, 1.06],
	[MOD.Hidden, 1.06],
	[MOD.DoubleTime, 1.12],
	[MOD.Nightcore, 1.12],
	[MOD.Flashlight, 1.12],
	[MOD.SpunOut, 0.9]
];

export function modMultiplier(mods: number) {
	let multiplier = 1;
	for (const [mod, value] of MOD_MULTIPLIERS) {
		// Nightcore includes Double Time: count it once
		if (mod === MOD.DoubleTime && mods & MOD.Nightcore) continue;
		if (mods & mod) multiplier *= value;
	}
	return multiplier;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.hypot(a.x - b.x, a.y - b.y);

/** The first index of a sorted list with time > t, minus one (the last at or before t) */
export function lastAtOrBefore<T extends { time: number }>(list: T[], time: number) {
	let low = 0;
	let high = list.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (list[mid].time <= time) {
			found = mid;
			low = mid + 1;
		} else high = mid - 1;
	}
	return found;
}

export interface Judge {
	beatmap: GameplayBeatmap;
	mods: number;
	states: ObjectState[];
	judgements: Judgement[];
	snapshots: Snapshot[];
	sounds: PlaySound[];
	/** Every input, in order */
	frames: Frame[];
	/** Key presses: which key (KEY bit) and when */
	presses: { time: number; key: number }[];
	/** Feeds an input; times must not go back (use reset for that) */
	input(frame: Frame): void;
	/** Judges everything up to a time (objects that weren't hit are missed) */
	update(time: number): void;
	/** Starts over; objects before the time are left out (not judged) */
	reset(time: number): void;
	/** Called for every sound as it's decided */
	onSound: ((sound: PlaySound) => void) | null;
}

export function createJudge(beatmap: GameplayBeatmap, mods = beatmap.mods): Judge {
	const { objects, radius, windows } = beatmap;
	const relax = !!(mods & MOD.Relax);
	const multiplier = beatmap.difficultyMultiplier * modMultiplier(mods);

	const fresh = (object: HitObject): ObjectState => ({
		hitTime: null,
		head: null,
		headAt: null,
		result: null,
		judgedAt: null,
		points: object.slider ? object.slider.points.map(() => null) : [],
		tracking: [],
		spins: []
	});

	const judge: Judge = {
		beatmap,
		mods,
		states: objects.map(fresh),
		judgements: [],
		snapshots: [],
		sounds: [],
		frames: [],
		presses: [],
		input,
		update,
		reset,
		onSound: null
	};

	let score = 0;
	let combo = 0;
	let maxCombo = 0;
	const counts = { 300: 0, 100: 0, 50: 0, 0: 0 };
	/** The first object whose head isn't judged yet: only it can be hit (osu!'s note lock) */
	let next = 0;
	/** Objects started but not finished (sliders being slid, spinners being spun) */
	let active: number[] = [];
	let last: Frame | null = null;
	let started = NOT_STARTED;
	/** Per combo: whether all were 300s, and whether all were at least 100s */
	let comboPerfect = true;
	let comboGood = true;
	/** Spinner: the cursor's angle at the last input */
	let lastAngle: number | null = null;

	const snapshot = (time: number) => {
		const total = counts[300] + counts[100] + counts[50] + counts[0];
		judge.snapshots.push({
			time,
			score,
			combo,
			maxCombo,
			accuracy: total
				? (counts[300] * 300 + counts[100] * 100 + counts[50] * 50) / (total * 300)
				: 1,
			counts: { ...counts }
		});
	};

	const sound = (event: PlaySound) => {
		// In order of when they play
		const list = judge.sounds;
		let i = list.length;
		while (i > 0 && list[i - 1].at > event.at) i--;
		list.splice(i, 0, event);
		judge.onSound?.(event);
	};

	const addCombo = () => {
		combo++;
		maxCombo = Math.max(maxCombo, combo);
	};

	const breakCombo = (time: number) => {
		if (combo >= COMBO_BREAK_SOUND) sound({ kind: 'combobreak', at: time });
		combo = 0;
	};

	/** The score of a judged object, with osu!'s combo bonus */
	const scoreHit = (result: Result) => {
		score += result + Math.floor((result * Math.max(0, combo - 1) * multiplier) / 25);
	};

	/** The final result of a circle, slider or spinner */
	const finish = (index: number, result: Result, time: number, x: number, y: number) => {
		const object = objects[index];
		const state = judge.states[index];
		state.result = result;
		state.judgedAt = time;
		counts[result]++;
		if (result) {
			scoreHit(result);
			// Sliders count their combo for each part
			if (object.kind !== 'slider') addCombo();
		} else if (object.kind !== 'slider') breakCombo(time);
		if (result !== 300) comboPerfect = false;
		if (result < 100) comboGood = false;
		let special: Judgement['special'];
		if (object.comboEnd) {
			if (result && comboPerfect) special = 'geki';
			else if (result && comboGood) special = 'katu';
			comboPerfect = true;
			comboGood = true;
		}
		judge.judgements.push({ time, x, y, result, special });
		snapshot(time);
	};

	const held = (frame: Frame | null) => relax || (!!frame && (frame.keys & 3) !== 0);

	/** Whether the cursor follows a slider's ball at a time */
	function follows(index: number, time: number, frame: Frame | null) {
		const object = objects[index];
		const state = judge.states[index];
		if (!frame || !held(frame) || time < object.time) return false;
		const wasTracking = state.tracking.length > 0 && state.tracking.at(-1)!.end === Infinity;
		const ball = sliderBall(object, time);
		return distance(frame, ball) <= radius * (wasTracking ? FOLLOW_AREA : 1);
	}

	function setTracking(index: number, on: boolean, time: number) {
		const tracking = judge.states[index].tracking;
		const current = tracking.at(-1);
		const isOn = !!current && current.end === Infinity;
		if (on && !isOn) tracking.push({ start: time, end: Infinity });
		else if (!on && isOn) current!.end = time;
	}

	/** The head of the object at `next` is judged: move on to the next one */
	function headDone() {
		const object = objects[next];
		if (object.kind !== 'circle') active.push(next);
		next++;
	}

	function hitHead(index: number, time: number, result: Result) {
		const object = objects[index];
		const state = judge.states[index];
		state.head = result;
		state.headAt = time;
		if (result) {
			state.hitTime = time;
			sound({ kind: 'hit', time: object.time, at: Math.max(time, started) });
		}
		if (object.kind === 'circle') {
			finish(index, result, time, object.x, object.y);
		} else if (result) {
			// A slider's head: 30 points and one combo
			score += 30;
			addCombo();
			setTracking(index, true, Math.max(time, object.time));
			snapshot(time);
		} else {
			breakCombo(time);
			judge.judgements.push({ time, x: object.x, y: object.y, result: 0, sliderBreak: true });
			snapshot(time);
		}
		headDone();
	}

	/** The next thing to judge at or before a time, if any */
	function nextCheck(time: number) {
		let best: { at: number; run: () => void } | null = null;
		const consider = (at: number, run: () => void) => {
			if (at <= time && (!best || at < best.at)) best = { at, run };
		};
		// Spinners can't be clicked: they're passed by at their start
		const head = objects[next];
		if (head) {
			if (head.kind === 'spinner') consider(head.time, () => headDone());
			else
				consider(head.time + windows[50], () => {
					hitHead(next, head.time + windows[50], 0);
				});
		}
		for (const index of active) {
			const object = objects[index];
			const state = judge.states[index];
			if (object.kind === 'slider') {
				const points = object.slider!.points;
				const p = state.points.indexOf(null);
				if (p >= 0) {
					const point = points[p];
					consider(point.judgeTime, () => judgePoint(index, p));
				} else consider(object.endTime, () => finishSlider(index));
			} else consider(object.endTime, () => finishSpinner(index));
		}
		return best as { at: number; run: () => void } | null;
	}

	function judgePoint(index: number, p: number) {
		const object = objects[index];
		const state = judge.states[index];
		const point = object.slider!.points[p];
		const hit = follows(index, point.judgeTime, last);
		setTracking(index, hit, point.judgeTime);
		state.points[p] = hit;
		const where = object.slider!.path.at(point.progress);
		if (hit) {
			score += point.kind === 'tick' ? 10 : 30;
			addCombo();
			sound({ kind: 'hit', time: point.time, at: point.time });
		} else if (point.kind !== 'tail') {
			// A missed tick or repeat breaks the combo (a missed end doesn't)
			breakCombo(point.judgeTime);
			judge.judgements.push({
				time: point.judgeTime,
				x: where.x,
				y: where.y,
				result: 0,
				sliderBreak: true
			});
		}
		snapshot(point.judgeTime);
	}

	function finishSlider(index: number) {
		const object = objects[index];
		const state = judge.states[index];
		setTracking(index, false, object.endTime);
		const parts = [state.head !== 0, ...state.points.map(Boolean)];
		const hit = parts.filter(Boolean).length;
		const result: Result =
			hit === parts.length ? 300 : hit * 2 >= parts.length ? 100 : hit > 0 ? 50 : 0;
		active = active.filter((i) => i !== index);
		const end = object.slider!.path.at(object.slider!.slides % 2);
		finish(index, result, object.endTime, end.x, end.y);
	}

	function finishSpinner(index: number) {
		const object = objects[index];
		const state = judge.states[index];
		const spun = (state.spins.at(-1)?.total ?? 0) / (Math.PI * 2);
		const required = object.spinner!.required;
		const progress = required ? spun / required : 1;
		const result: Result = progress >= 1 ? 300 : progress > 0.9 ? 100 : progress > 0.75 ? 50 : 0;
		active = active.filter((i) => i !== index);
		if (result) sound({ kind: 'hit', time: object.endTime, at: object.endTime });
		finish(index, result, object.endTime, 256, 192);
	}

	function update(time: number) {
		if (started === NOT_STARTED) return;
		for (;;) {
			const check = nextCheck(time);
			if (!check) break;
			check.run();
		}
	}

	function spin(frame: Frame) {
		const angle = Math.atan2(frame.y - 192, frame.x - 256);
		const previous = lastAngle;
		lastAngle = angle;
		if (previous === null || !last) return;
		for (const index of active) {
			const object = objects[index];
			if (object.kind !== 'spinner' || frame.time < object.time) continue;
			const state = judge.states[index];
			let delta = angle - previous;
			if (delta > Math.PI) delta -= Math.PI * 2;
			if (delta < -Math.PI) delta += Math.PI * 2;
			const elapsed = Math.max(0, frame.time - last.time);
			const turned =
				held(frame) || mods & MOD.SpunOut ? Math.min(Math.abs(delta), MAX_SPIN * elapsed) : 0;
			const before = state.spins.at(-1)?.total ?? 0;
			const total = before + (mods & MOD.SpunOut ? MAX_SPIN * 0.6 * elapsed : turned);
			state.spins.push({ time: frame.time, total });
			// Each full spin: 100 points, past the needed ones (and two more) a 1000 bonus
			const { required, maxBonus } = object.spinner!;
			const full = Math.floor(total / (Math.PI * 2));
			for (let n = Math.floor(before / (Math.PI * 2)) + 1; n <= full; n++) {
				if (n <= required) score += 100;
				else if (n >= required + 2 && n < required + 2 + maxBonus) {
					score += 1000;
					sound({ kind: 'spinnerbonus', at: frame.time });
				}
			}
			if (full > Math.floor(before / (Math.PI * 2))) snapshot(frame.time);
		}
	}

	function input(frame: Frame) {
		if (started === NOT_STARTED) {
			started = frame.time;
			// Objects before the start aren't played
			skipBefore(frame.time);
		}
		update(frame.time);
		judge.frames.push(frame);
		const before = last?.keys ?? 0;
		const pressed = frame.keys & ~before;
		// Keys for the overlay: K1 and K2 also set M1 and M2
		for (const key of [KEY.K1, KEY.K2])
			if (pressed & key) judge.presses.push({ time: frame.time, key });
		if (pressed & KEY.M1 && !(frame.keys & KEY.K1))
			judge.presses.push({ time: frame.time, key: KEY.M1 });
		if (pressed & KEY.M2 && !(frame.keys & KEY.K2))
			judge.presses.push({ time: frame.time, key: KEY.M2 });

		// A click on the object whose turn it is
		const click = relax || (pressed & 3) !== 0;
		const object = objects[next];
		if (click && object && object.kind !== 'spinner') {
			const offset = frame.time - object.time;
			const inWindow = relax
				? offset >= -windows[300] && offset <= windows[50]
				: Math.abs(offset) <= windows[50];
			if (inWindow && distance(frame, object) <= radius) {
				const away = Math.abs(offset);
				hitHead(
					next,
					frame.time,
					relax ? 300 : away <= windows[300] ? 300 : away <= windows[100] ? 100 : 50
				);
			}
		}

		// Sliders follow, spinners spin
		for (const index of active) {
			const object = objects[index];
			if (object.kind === 'slider' && frame.time >= object.time && frame.time <= object.endTime)
				setTracking(index, follows(index, frame.time, frame), frame.time);
		}
		spin(frame);
		last = frame;
	}

	function skipBefore(time: number) {
		while (next < objects.length && objects[next].time + windows[50] < time) next++;
		// A slider or spinner already going is skipped too
		active = [];
	}

	function reset(time: number) {
		judge.states = objects.map(fresh);
		judge.judgements = [];
		judge.snapshots = [];
		judge.sounds = [];
		judge.frames = [];
		judge.presses = [];
		score = 0;
		combo = 0;
		maxCombo = 0;
		counts[300] = counts[100] = counts[50] = counts[0] = 0;
		next = 0;
		active = [];
		last = null;
		lastAngle = null;
		comboPerfect = comboGood = true;
		started = NOT_STARTED;
		snapshot(-Infinity);
		void time;
	}

	snapshot(-Infinity);
	return judge;
}

// --- Autoplay -----------------------------------------------------------------------

/** How fast autoplay spins: like osu!'s, at the cap */
const AUTO_SPIN = MAX_SPIN * 0.999;

/** Where autoplay's cursor is: on each object at its time, eased in between */
/**
 * Where autoplay's cursor is; before the first object it waits where it was (`rest`, e.g. where
 * the last song's cursor ended) and moves over in the last second
 */
export function autoplayCursor(
	objects: HitObject[],
	time: number,
	rest: { x: number; y: number } = { x: 256, y: 192 }
) {
	const position = (object: HitObject, t: number) => {
		if (object.kind === 'slider') return sliderBall(object, t);
		if (object.kind === 'spinner') {
			const angle = Math.max(0, t - object.time) * AUTO_SPIN;
			return { x: 256 + Math.cos(angle) * 50, y: 192 + Math.sin(angle) * 50 };
		}
		return { x: object.x, y: object.y };
	};
	let index = -1;
	for (let low = 0, high = objects.length - 1; low <= high;) {
		const mid = (low + high) >> 1;
		if (objects[mid].time <= time) {
			index = mid;
			low = mid + 1;
		} else high = mid - 1;
	}
	const current = objects[index];
	if (current && time <= current.endTime) return position(current, time);
	const following = objects[index + 1];
	const from = current ? position(current, current.endTime) : rest;
	if (!following) return from;
	const to = position(following, following.time);
	const start = current ? current.endTime : following.time - 1000;
	const t = Math.max(0, Math.min(1, (time - start) / (following.time - start || 1)));
	// Eased like a hand: quick start, gentle arrival
	const eased = 1 - (1 - t) * (1 - t);
	return { x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased };
}

/** Autoplay's inputs: the cursor on each object at its time, alternating keys */
export function autoplayFrames(beatmap: GameplayBeatmap): Frame[] {
	const { objects } = beatmap;
	if (!objects.length) return [];
	// When keys are held: a short tap for circles, the whole time for sliders and spinners
	const holds: { start: number; end: number; key: number }[] = [];
	let alternate = false;
	objects.forEach((object, i) => {
		const following = objects[i + 1];
		const gap = following ? following.time - object.endTime : Infinity;
		const end =
			object.kind === 'circle'
				? object.time + Math.min(50, gap / 2)
				: object.endTime + Math.min(50, gap / 2);
		holds.push({ start: object.time, end, key: alternate ? KEY.K2 | KEY.M2 : KEY.K1 | KEY.M1 });
		alternate = !alternate;
	});
	// Inputs only when something happens: the cursor in between is autoplayCursor's, so the
	// view draws it from that (much less to judge than an input every frame)
	const times = new Set<number>();
	times.add(objects[0].time - 1500);
	for (const object of objects) {
		times.add(object.time);
		if (object.kind === 'spinner')
			for (let t = object.time; t <= object.endTime; t += 16) times.add(Math.round(t));
		for (const point of object.slider?.points ?? []) {
			// Just before too: points are judged by the last input before them
			times.add(point.judgeTime - 1);
			times.add(point.judgeTime);
			times.add(point.time);
		}
	}
	for (const hold of holds) {
		times.add(hold.end);
	}
	const sorted = [...times].sort((a, b) => a - b);
	let h = 0;
	return sorted.map((time) => {
		while (h < holds.length && holds[h].end <= time) h++;
		let keys = 0;
		for (let i = h; i < holds.length && holds[i].start <= time; i++) {
			if (holds[i].end > time) keys |= holds[i].key;
		}
		const at = autoplayCursor(objects, time);
		return { time, x: at.x, y: at.y, keys };
	});
}

const autoplays = new Map<string, { beatmap: GameplayBeatmap; judge: Judge } | null>();

/**
 * Autoplay's play of a beatmap (.osu content), worked out once and shared by the gameplay
 * view and the hitsounds. Null for maps that aren't osu!standard.
 */
export function autoplayFor(content: string) {
	if (!autoplays.has(content)) {
		const beatmap = parseGameplay(content);
		const play = beatmap ? { beatmap, judge: judgeFrames(beatmap, autoplayFrames(beatmap)) } : null;
		if (autoplays.size >= 3) autoplays.delete(autoplays.keys().next().value!);
		autoplays.set(content, play);
	}
	return autoplays.get(content)!;
}

/** Judges a whole list of inputs (a replay or autoplay) */
export function judgeFrames(beatmap: GameplayBeatmap, frames: Frame[], mods = beatmap.mods) {
	const judge = createJudge(beatmap, mods);
	for (const frame of frames) judge.input(frame);
	judge.update(Infinity);
	return judge;
}

// --- Reading a judged play ------------------------------------------------------------

/** The play's HUD numbers at a time */
export function snapshotAt(judge: Judge, time: number) {
	const i = lastAtOrBefore(judge.snapshots, time);
	return judge.snapshots[Math.max(0, i)];
}

/** The cursor of a play at a time (between two inputs) */
export function cursorAt(frames: Frame[], time: number) {
	const i = lastAtOrBefore(frames, time);
	// Before the first input: there, without keys
	if (i < 0) return frames[0] ? { ...frames[0], time, keys: 0 } : null;
	const a = frames[i];
	const b = frames[i + 1];
	if (!b || b.time === a.time) return a;
	const t = (time - a.time) / (b.time - a.time);
	return { time, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, keys: a.keys };
}

/** How many times each key was pressed by a time */
export function keyCounts(judge: Judge, time: number) {
	const counts = { [KEY.K1]: 0, [KEY.K2]: 0, [KEY.M1]: 0, [KEY.M2]: 0 } as Record<number, number>;
	const end = lastAtOrBefore(judge.presses, time);
	for (let i = 0; i <= end; i++) counts[judge.presses[i].key]++;
	return counts;
}

/** Whether a slider's ball is being followed at a time */
export function trackingAt(state: ObjectState, time: number) {
	return state.tracking.some((t) => t.start <= time && time < t.end);
}

/** How far a spinner was spun by a time (radians) and its RPM */
export function spinAt(state: ObjectState, time: number) {
	const i = lastAtOrBefore(state.spins, time);
	if (i < 0) return { total: 0, rpm: 0 };
	const total = state.spins[i].total;
	const back = lastAtOrBefore(state.spins, time - 500);
	const earlier = back >= 0 ? state.spins[back] : { time: state.spins[0].time, total: 0 };
	const elapsed = Math.max(1, state.spins[i].time - earlier.time);
	return { total, rpm: ((total - earlier.total) / (Math.PI * 2)) * (60000 / elapsed) };
}
