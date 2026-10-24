// The puzzle: a beatmap's background to put back together while its song plays. Moves are
// judged against the beat like hits in osu! (300, 100, 50, miss), with combo, score,
// accuracy and a grade; the music stays muffled until the picture is whole.

import { get } from 'svelte/store';
import { beatNow } from '../stores/beat';
import { formatSongData, mapDataStore } from '../stores/data';
import type { MapSet } from '../types';

export type PuzzleMode = 'jigsaw' | 'slide' | 'spin';
export type Judgement = 300 | 100 | 50 | 0;
export type PuzzleMod = 'EZ' | 'HD' | 'FL' | 'SP';

export const MODES: { id: PuzzleMode; label: string; icon: string; hint: string }[] = [
	{
		id: 'jigsaw',
		label: 'Jigsaw',
		icon: 'icon-[ri--puzzle-2-line]',
		hint: 'Drag the pieces onto the board. Drop them on the beat.'
	},
	{
		id: 'slide',
		label: 'Slide',
		icon: 'icon-[mingcute--layout-grid-line]',
		hint: 'Slide the tiles into the gap, one move per beat. Arrow keys work too.'
	},
	{
		id: 'spin',
		label: 'Spin',
		icon: 'icon-[mingcute--clockwise-line]',
		hint: 'Turn every tile the right way up: left click turns right, right click left.'
	}
];

/** The difficulties, named like osu!'s: how many pieces each mode cuts the picture into */
export const DIFFICULTIES = [
	{ label: 'Easy', color: '#88b300', pieces: { jigsaw: 12, slide: 6, spin: 12 } },
	{ label: 'Normal', color: '#66ccff', pieces: { jigsaw: 24, slide: 12, spin: 24 } },
	{ label: 'Hard', color: '#ffcc22', pieces: { jigsaw: 40, slide: 20, spin: 40 } },
	{ label: 'Insane', color: '#ff66aa', pieces: { jigsaw: 70, slide: 30, spin: 60 } },
	{ label: 'Expert', color: '#aa88ff', pieces: { jigsaw: 117, slide: 48, spin: 96 } }
] as const;

export const MODS: {
	id: PuzzleMod;
	label: string;
	hint: string;
	multiplier: number;
	modes?: PuzzleMode[];
}[] = [
	{
		id: 'EZ',
		label: 'Easy',
		hint: 'The picture shows faintly on the board, and pieces snap from further away',
		multiplier: 0.5
	},
	{
		id: 'HD',
		label: 'Hidden',
		hint: 'No preview of the picture, and the board hides where pieces belong',
		multiplier: 1.06
	},
	{
		id: 'FL',
		label: 'Flashlight',
		hint: 'You only see around the cursor, and less the higher your combo',
		multiplier: 1.12
	},
	{
		id: 'SP',
		label: 'Spun',
		hint: 'Pieces come turned: right click or R turns the one you hold',
		multiplier: 1.08,
		modes: ['jigsaw']
	}
];

/** Columns and rows for about `pieces` pieces of a picture this wide, each about square */
export function gridFor(pieces: number, aspect: number) {
	const cols = Math.max(2, Math.round(Math.sqrt(pieces * aspect)));
	const rows = Math.max(2, Math.round(cols / aspect));
	return { cols, rows };
}

/** How many pieces a difficulty has for a mode, for a usual (16:9) background */
export function pieceCount(difficulty: number, mode: PuzzleMode) {
	const { cols, rows } = gridFor(DIFFICULTIES[difficulty].pieces[mode], 16 / 9);
	return cols * rows;
}

/**
 * Where a picture lies to cover a board of square tiles `cols` × `rows` (in tiles): its
 * size and its top left corner, centred like CSS's object-fit: cover
 */
export function coverBox(aspect: number, cols: number, rows: number) {
	const width = Math.max(cols, rows * aspect);
	const height = width / aspect;
	return { width, height, x: (cols - width) / 2, y: (rows - height) / 2 };
}

/** The style that shows tile (c, r) of a picture covering the board (on an img in the tile) */
export function tileImageStyle(box: ReturnType<typeof coverBox>, c: number, r: number) {
	return `left: ${(box.x - c) * 100}%; top: ${(box.y - r) * 100}%; width: ${box.width * 100}%; height: ${box.height * 100}%`;
}

// --- Randomness: seeded, so the daily puzzle is the same all day -----------------------------

export function seededRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function hashString(text: string) {
	let hash = 2166136261;
	for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return hash >>> 0;
}

// --- Jigsaw pieces ----------------------------------------------------------------------------

type Point = [number, number];
/** A cubic Bézier path from its start: each segment is two control points and its end */
type Edge = { start: Point; segments: [Point, Point, Point][] };

/** The knob of an edge from (0,0) to (1,0), sticking out towards +y (in edge lengths) */
const KNOB: [Point, Point, Point][] = [
	[
		[0.34, 0],
		[0.44, 0.01],
		[0.42, 0.07]
	],
	[
		[0.4, 0.13],
		[0.31, 0.24],
		[0.5, 0.25]
	],
	[
		[0.69, 0.24],
		[0.6, 0.13],
		[0.58, 0.07]
	],
	[
		[0.56, 0.01],
		[0.66, 0],
		[1, 0]
	]
];

/**
 * An edge between two pieces from `from` to `to`, its knob towards the left of the way
 * (`side` 1) or the right (-1); each knob a little different, like a real puzzle's
 */
function knobEdge(from: Point, to: Point, side: number, size: number, random: () => number): Edge {
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const length = Math.hypot(dx, dy);
	// Across the edge, scaled to the piece's size rather than this edge's length
	const nx = (dy / length) * size * side;
	const ny = (-dx / length) * size * side;
	const shift = (random() - 0.5) * 0.08;
	const height = 0.9 + random() * 0.2;
	const at = ([u, v]: Point): Point => {
		const along = u === 0 || u === 1 ? u : u + shift;
		return [from[0] + dx * along + nx * v * height, from[1] + dy * along + ny * v * height];
	};
	return { start: from, segments: KNOB.map((segment) => segment.map(at) as [Point, Point, Point]) };
}

function straightEdge(from: Point, to: Point): Edge {
	return { start: from, segments: [[from, to, to]] };
}

function reversed(edge: Edge): Edge {
	const points = [edge.start, ...edge.segments.map((segment) => segment[2])];
	const segments = edge.segments
		.map((segment, i): [Point, Point, Point] => [segment[1], segment[0], points[i]])
		.reverse();
	return { start: points.at(-1)!, segments };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The outlines of all pieces of a `cols` × `rows` jigsaw over a picture `width` × `height`
 * (in the picture's units), row by row. Neighbours share their edges, so they fit.
 */
export function jigsawPaths(
	cols: number,
	rows: number,
	width: number,
	height: number,
	random: () => number
) {
	const w = width / cols;
	const h = height / rows;
	const size = Math.min(w, h);
	const corner = (c: number, r: number): Point => [c * w, r * h];
	// Left to right along each row line, top to bottom along each column line; the knob
	// goes to either side at random
	const flip = () => (random() < 0.5 ? 1 : -1);
	const across: Edge[][] = [];
	for (let r = 0; r <= rows; r++) {
		across.push([]);
		for (let c = 0; c < cols; c++) {
			const from = corner(c, r);
			const to = corner(c + 1, r);
			across[r].push(
				r === 0 || r === rows ? straightEdge(from, to) : knobEdge(from, to, flip(), size, random)
			);
		}
	}
	const down: Edge[][] = [];
	for (let c = 0; c <= cols; c++) {
		down.push([]);
		for (let r = 0; r < rows; r++) {
			const from = corner(c, r);
			const to = corner(c, r + 1);
			down[c].push(
				c === 0 || c === cols ? straightEdge(from, to) : knobEdge(from, to, flip(), size, random)
			);
		}
	}
	const paths: string[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			// Clockwise: top, right, bottom (backwards), left (backwards)
			const edges = [
				across[r][c],
				down[c + 1][r],
				reversed(across[r + 1][c]),
				reversed(down[c][r])
			];
			let d = `M${round(edges[0].start[0])} ${round(edges[0].start[1])}`;
			for (const edge of edges)
				for (const [a, b, end] of edge.segments)
					d += `C${round(a[0])} ${round(a[1])} ${round(b[0])} ${round(b[1])} ${round(end[0])} ${round(end[1])}`;
			paths.push(d + 'Z');
		}
	}
	return paths;
}

// --- Judging on the beat ------------------------------------------------------------------------

/**
 * A move judged against the beat of the song as it's heard: right on it is a 300. Without a
 * beat to go by (the music is paused, or its timing isn't known) every move is a 100.
 * `missOffBeat`: too far from any beat is a miss (else still a 50).
 */
export function judgeBeat(missOffBeat: boolean): {
	judgement: Judgement;
	offset: number | null;
	kiai: boolean;
} {
	const beat = beatNow();
	if (!beat) return { judgement: 100, offset: null, kiai: false };
	const off = Math.abs(beat.offset) / beat.beatLength;
	const judgement: Judgement =
		off <= 0.12 ? 300 : off <= 0.24 ? 100 : off <= 0.36 || !missOffBeat ? 50 : 0;
	return { judgement, offset: beat.offset, kiai: beat.kiai };
}

/** What a puzzle tells the page about a move */
export interface PuzzleAction {
	judgement: Judgement;
	/** Kiai time: the hit counts double */
	kiai?: boolean;
	/** A piece went to where it belongs */
	home?: boolean;
	/** Where on the screen, for the judgement to show */
	x: number;
	y: number;
}

export interface Score {
	score: number;
	combo: number;
	maxCombo: number;
	counts: Record<Judgement, number>;
}

export const newScore = (): Score => ({
	score: 0,
	combo: 0,
	maxCombo: 0,
	counts: { 300: 0, 100: 0, 50: 0, 0: 0 }
});

/** The score after a judgement: like osu!, each hit is worth more the higher the combo */
export function addJudgement(
	score: Score,
	judgement: Judgement,
	difficulty: number,
	multiplier: number,
	kiai = false
): Score {
	const combo = judgement ? score.combo + 1 : 0;
	const value =
		judgement + (judgement * Math.max(0, combo - 1) * (difficulty + 2) * multiplier) / 25;
	return {
		score: score.score + Math.round(value * multiplier * (kiai ? 2 : 1)),
		combo,
		maxCombo: Math.max(score.maxCombo, combo),
		counts: { ...score.counts, [judgement]: score.counts[judgement] + 1 }
	};
}

export function accuracy({ counts }: Score) {
	const total = counts[300] + counts[100] + counts[50] + counts[0];
	if (!total) return 1;
	return (counts[300] * 300 + counts[100] * 100 + counts[50] * 50) / (total * 300);
}

/** osu!'s grade from the counts; with Hidden or Flashlight the silver ones */
export function gradeOf({ counts }: Score, mods: PuzzleMod[]) {
	const total = counts[300] + counts[100] + counts[50] + counts[0];
	const silver = mods.includes('HD') || mods.includes('FL');
	if (!total || counts[300] === total) return silver ? 'SSH' : 'SS';
	const p300 = counts[300] / total;
	const p50 = counts[50] / total;
	if (p300 > 0.9 && p50 < 0.01 && !counts[0]) return silver ? 'SH' : 'S';
	if ((p300 > 0.8 && !counts[0]) || p300 > 0.9) return 'A';
	if ((p300 > 0.7 && !counts[0]) || p300 > 0.8) return 'B';
	if (p300 > 0.6) return 'C';
	return 'D';
}

/** The colours of the grades, like osu!'s */
export const GRADE_COLORS: Record<string, string> = {
	SSH: '#e0e8f0',
	SS: '#ffd84d',
	SH: '#c8d4e0',
	S: '#ffcc22',
	A: '#88da20',
	B: '#4fc3f7',
	C: '#d070ff',
	D: '#ff5a5a'
};

export const JUDGEMENT_COLORS: Record<Judgement, string> = {
	300: '#66ccff',
	100: '#88da20',
	50: '#ffcc22',
	0: '#ff5a5a'
};

export function scoreMultiplier(mods: PuzzleMod[]) {
	return MODS.filter((mod) => mods.includes(mod.id)).reduce((m, mod) => m * mod.multiplier, 1);
}

// --- Songs to puzzle --------------------------------------------------------------------------

/** The downloaded songs to puzzle: the anime ones if there are any (they look the best) */
export function puzzleSongs(animeOnly = true) {
	const library = formatSongData(get(mapDataStore));
	const anime = library.filter((song) => song.genre === 'Anime');
	return animeOnly && anime.length ? anime : library;
}

export function today(date = new Date()) {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's puzzle: a song of the library, a mode and a difficulty, the same all day */
export function dailyPuzzle(date = new Date()): {
	day: string;
	song: MapSet | null;
	mode: PuzzleMode;
	difficulty: number;
	seed: number;
} {
	const day = today(date);
	const seed = hashString(`stosufy-puzzle-${day}`);
	const songs = puzzleSongs();
	const dayNumber = Math.floor(date.getTime() / 86400000);
	const weekend = date.getDay() === 0 || date.getDay() === 6;
	return {
		day,
		song: songs.length ? songs[seed % songs.length] : null,
		mode: MODES[dayNumber % MODES.length].id,
		// Harder at the weekend, when there's time
		difficulty: weekend ? 2 : 1,
		seed
	};
}

// --- Records: the best of each song, mode and difficulty, and the daily streak ---------------------

export interface PuzzleRecord {
	setId: number | string;
	mapId?: number | string | null;
	title: string;
	artist: string;
	mode: PuzzleMode;
	difficulty: number;
	mods: PuzzleMod[];
	score: number;
	accuracy: number;
	maxCombo: number;
	grade: string;
	/** How long it took (ms) */
	time: number;
	moves: number;
	at: number;
	/** The day, if it was the daily puzzle */
	daily?: string | null;
}

const RECORDS_KEY = 'puzzleRecords';
const DAILY_KEY = 'puzzleDaily';

function read<T>(key: string, fallback: T): T {
	try {
		const saved = localStorage.getItem(key);
		return saved ? (JSON.parse(saved) as T) : fallback;
	} catch {
		return fallback;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// (not remembered)
	}
}

export function loadRecords(): Record<string, PuzzleRecord> {
	return read(RECORDS_KEY, {});
}

const recordKey = (record: Pick<PuzzleRecord, 'setId' | 'mode' | 'difficulty'>) =>
	`${record.setId}:${record.mode}:${record.difficulty}`;

/** Keeps a solved puzzle if it's the best of its kind; returns the one it beat (if any) */
export function saveRecord(record: PuzzleRecord) {
	const records = loadRecords();
	const key = recordKey(record);
	const best = records[key] ?? null;
	if (!best || record.score > best.score) {
		records[key] = record;
		write(RECORDS_KEY, records);
	}
	return { best, isBest: !best || record.score > best.score };
}

export interface DailyState {
	/** The last day solved, and how many days in a row up to it */
	day: string | null;
	streak: number;
	longest: number;
	/** The best grade of the day's puzzle */
	grade?: string;
}

export function loadDaily(): DailyState {
	const daily = read<DailyState>(DAILY_KEY, { day: null, streak: 0, longest: 0 });
	// A day was missed: the streak is over
	const yesterday = today(new Date(Date.now() - 86400000));
	if (daily.day && daily.day !== today() && daily.day !== yesterday) daily.streak = 0;
	return daily;
}

const GRADE_ORDER = ['D', 'C', 'B', 'A', 'S', 'SH', 'SS', 'SSH'];

export function solveDaily(grade: string): DailyState {
	const daily = loadDaily();
	const better = (a: string | undefined, b: string) =>
		a && GRADE_ORDER.indexOf(a) >= GRADE_ORDER.indexOf(b) ? a : b;
	const next =
		daily.day === today()
			? { ...daily, grade: better(daily.grade, grade) }
			: {
					day: today(),
					streak: daily.streak + 1,
					longest: Math.max(daily.longest, daily.streak + 1),
					grade
				};
	write(DAILY_KEY, next);
	return next;
}

export function formatTime(ms: number) {
	const seconds = Math.floor(ms / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
