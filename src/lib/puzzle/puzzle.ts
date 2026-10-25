// The puzzle: a beatmap's background to put back together, against the clock, while its song
// plays (muffled until the picture is whole). The fastest times go on leaderboards: each
// puzzle's, the daily puzzle's (the same for everyone) and the overall ones.

import { get } from 'svelte/store';
import { backgroundUrls, formatSongData, mapDataStore } from '../stores/data';
import type { PuzzleBoard, PuzzleScore, PuzzleTopBoard, PuzzleTopEntry } from '../api';
import type { MapSet } from '../types';

export type PuzzleMode = 'jigsaw' | 'slide' | 'spin';
/** EZ is the relaxed puzzle's help only: it isn't one to pick against the clock */
export type PuzzleMod = 'EZ' | 'HD' | 'FL' | 'SP';

export const MODES: { id: PuzzleMode; label: string; icon: string; hint: string }[] = [
	{
		id: 'jigsaw',
		label: 'Jigsaw',
		icon: 'icon-[ri--puzzle-2-line]',
		hint: 'Drag the pieces onto the board where they belong.'
	},
	{
		id: 'slide',
		label: 'Slide',
		icon: 'icon-[mingcute--layout-grid-line]',
		hint: 'Slide the tiles into the gap until the picture is right. Arrow keys work too.'
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

/** Mods only make a puzzle harder: a time with them is on the same leaderboard, to show off */
export const MODS: {
	id: PuzzleMod;
	label: string;
	hint: string;
	modes?: PuzzleMode[];
}[] = [
	{
		id: 'HD',
		label: 'Hidden',
		hint: 'No preview of the picture, no peeking, and the board hides where pieces belong'
	},
	{
		id: 'FL',
		label: 'Flashlight',
		hint: 'You only see around the cursor'
	},
	{
		id: 'SP',
		label: 'Spun',
		hint: 'Pieces come turned: right click or R turns the one you hold',
		modes: ['jigsaw']
	}
];

/** What a look at the whole picture costs (ms on the clock) */
export const PEEK_PENALTY = 3000;

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
export function jigsawOutlines(
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
	const outlines: Outline[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			// Clockwise: top, right, bottom (backwards), left (backwards)
			const edges = [
				across[r][c],
				down[c + 1][r],
				reversed(across[r + 1][c]),
				reversed(down[c][r])
			];
			outlines.push({
				start: edges[0].start,
				segments: edges.flatMap((edge) => edge.segments)
			});
		}
	}
	return outlines;
}

/** The outline of a piece: from its top left corner, clockwise in cubic Bézier segments */
export type Outline = Edge;

/**
 * The outlines of all pieces of a `cols` × `rows` jigsaw as SVG paths (see jigsawOutlines;
 * the same seed cuts the same pieces)
 */
export function jigsawPaths(
	cols: number,
	rows: number,
	width: number,
	height: number,
	random: () => number
) {
	return jigsawOutlines(cols, rows, width, height, random).map(
		({ start, segments }) =>
			`M${round(start[0])} ${round(start[1])}` +
			segments
				.map(
					([a, b, end]) =>
						`C${round(a[0])} ${round(a[1])} ${round(b[0])} ${round(b[1])} ${round(end[0])} ${round(end[1])}`
				)
				.join('') +
			'Z'
	);
}

// --- Moves ------------------------------------------------------------------------------------

/** A jigsaw piece as kept to go on later: where it lies, and the pieces it's joined to */
export interface SavedPiece {
	x: number;
	y: number;
	placed: boolean;
	z: number;
	g: number;
}

/** What a puzzle tells the page about a move */
export interface PuzzleAction {
	/** A piece went to where it belongs */
	home?: boolean;
	/** A piece dropped where it doesn't belong, or a right tile turned wrong */
	wrong?: boolean;
	/** Where on the screen */
	x: number;
	y: number;
}

/** The same puzzle for everyone: a song's picture cut the same way in a mode and difficulty */
export const puzzleSeed = (setId: number | string, mode: PuzzleMode, difficulty: number) =>
	hashString(`stosufy-puzzle:${setId}:${mode}:${difficulty}`);

// --- Songs to puzzle --------------------------------------------------------------------------

/** The downloaded songs to puzzle: the anime ones if there are any (they look the best) */
export function puzzleSongs(animeOnly = true) {
	const library = formatSongData(get(mapDataStore));
	const anime = library.filter((song) => song.genre === 'Anime');
	return animeOnly && anime.length ? anime : library;
}

/** The day of the daily puzzle: in UTC, so it's the same day everywhere */
export function today(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

/** The daily puzzle: a song, a mode and a difficulty, the same for everyone all day */
export interface DailyPuzzle {
	day: string;
	song: MapSet | null;
	mode: PuzzleMode;
	difficulty: number;
	seed: number;
	/** Picked by the server (the same for everyone, and ranked) or, offline, from the library */
	online: boolean;
	/** When the next one comes (ms) */
	nextAt: number;
	/** How many solved it, and the user's first solve, its place and the streak (online) */
	players?: number;
	mine?: PuzzleScore | null;
	streak?: number;
	longest?: number;
}

/** Without the server: a song of the library, the same all day (but not ranked) */
export function localDailyPuzzle(date = new Date()): DailyPuzzle {
	const day = today(date);
	const seed = hashString(`stosufy-puzzle-${day}`);
	const songs = puzzleSongs();
	const dayNumber = Math.floor(date.getTime() / 86400000);
	const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
	return {
		day,
		song: songs.length ? songs[seed % songs.length] : null,
		mode: MODES[dayNumber % MODES.length].id,
		// Harder at the weekend, when there's time
		difficulty: weekend ? 2 : 1,
		seed,
		online: false,
		nextAt: (dayNumber + 1) * 86400000
	};
}

// --- Records: the best time of each song, mode and difficulty, and the daily streak ------------

export interface PuzzleRecord {
	setId: number | string;
	mapId?: number | string | null;
	title: string;
	artist: string;
	mode: PuzzleMode;
	difficulty: number;
	mods: PuzzleMod[];
	/** How long it took (ms), with the seconds peeking cost */
	time: number;
	moves: number;
	/** Pieces dropped where they don't belong (or right tiles turned wrong) */
	mistakes?: number;
	peeks?: number;
	at: number;
	/** The day, if it was the daily puzzle */
	daily?: string | null;
	/** How it was cut, to show it again in 3D */
	seed?: number;
	cols?: number;
	rows?: number;
	aspect?: number;
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

/** Keeps a solved puzzle if it's the fastest of its kind; returns the one it beat (if any) */
export function saveRecord(record: PuzzleRecord) {
	const records = loadRecords();
	const key = recordKey(record);
	const best = records[key] ?? null;
	const isBest = !best || record.time < best.time;
	if (isBest) {
		records[key] = record;
		write(RECORDS_KEY, records);
	}
	return { best, isBest };
}

export interface DailyState {
	/** The last day solved, and how many days in a row up to it */
	day: string | null;
	streak: number;
	longest: number;
	/** The first time on the day's puzzle (ms) */
	time?: number;
}

export function loadDaily(): DailyState {
	const daily = read<DailyState>(DAILY_KEY, { day: null, streak: 0, longest: 0 });
	// A day was missed: the streak is over
	const yesterday = today(new Date(Date.now() - 86400000));
	if (daily.day && daily.day !== today() && daily.day !== yesterday) daily.streak = 0;
	return daily;
}

/** Keeps the day's puzzle as solved (the first time counts, like on the leaderboard) */
export function solveDaily(time: number, day = today()): DailyState {
	const daily = loadDaily();
	const next =
		daily.day === day
			? { ...daily, time: daily.time ?? time }
			: {
					day,
					streak: daily.streak + 1,
					longest: Math.max(daily.longest, daily.streak + 1),
					time
				};
	write(DAILY_KEY, next);
	return next;
}

/** A time as 1:05, or to the tenth (1:05.3) for the leaderboards */
export function formatTime(ms: number, precise = false) {
	const seconds = Math.floor(ms / 1000);
	const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	return precise ? `${text}.${Math.floor((ms % 1000) / 100)}` : text;
}

// --- Pictures ------------------------------------------------------------------------------------

/** The first of a picture's addresses that loads, and its shape (width / height) */
export async function loadImage(urls: string[]) {
	for (const url of urls) {
		const image = new Image();
		image.src = url;
		try {
			await image.decode();
			if (image.naturalWidth && image.naturalHeight)
				return { url, aspect: image.naturalWidth / image.naturalHeight };
		} catch {
			// Missing: the next one
		}
	}
	return null;
}

/** A beatmap's background to puzzle: the first that loads */
export async function loadBackground(setId: number | string, mapId?: number | string | null) {
	return loadImage(await backgroundUrls(setId, mapId ?? undefined));
}

/**
 * The daily puzzle's picture: the one on the osu! servers, so it's cut the same for everyone
 * (a downloaded copy can be another size); the downloaded one if those don't load
 */
export async function loadDailyBackground(setId: number | string, mapId?: number | string | null) {
	const base = `https://assets.ppy.sh/beatmaps/${setId}/covers`;
	return (
		(await loadImage([`${base}/raw.jpg`, `${base}/fullsize.jpg`])) ?? loadBackground(setId, mapId)
	);
}

/** A picture of the user's own, made small enough to keep (a JPEG data URL) */
export async function ownPicture(file: Blob, maxSize = 2000, quality = 0.88) {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return { url: canvas.toDataURL('image/jpeg', quality), aspect: canvas.width / canvas.height };
}

// --- The relaxed puzzle: a jigsaw like on a table, kept to go on later ---------------------------

/** How many pieces a relaxed puzzle can have (about; the picture's shape decides) */
export const PIECE_COUNTS: Record<PuzzleMode, number[]> = {
	jigsaw: [24, 48, 100, 150, 200, 300],
	slide: [6, 12, 20, 30, 48, 70],
	spin: [24, 48, 100, 150, 200, 300]
};

/** A picture to puzzle: a beatmap's background, or one of the user's own (`image`) */
export interface PuzzlePicture {
	setId?: number | string | null;
	mapId?: number | string | null;
	title: string;
	artist?: string;
	/** The user's own picture (a data URL) */
	image?: string | null;
}

export interface RelaxedSave {
	/** Several can wait at once: each its own */
	id: string;
	/** Older saves were all jigsaws */
	mode?: PuzzleMode;
	picture: PuzzlePicture;
	cols: number;
	rows: number;
	seed: number;
	/** Help on the board (the picture faintly, numbers, arrows), and the outlines */
	ghost: boolean;
	outlines: boolean;
	/** The jigsaw's pieces */
	pieces?: SavedPiece[];
	/** The sliding puzzle's tiles (their cells) or the spinning one's (their turns) */
	tiles?: number[];
	/** How far along it is (0–1) */
	progress?: number;
	/** Time spent on it so far (ms) */
	time: number;
	at: number;
}

export interface RelaxedRecord {
	picture: PuzzlePicture;
	mode?: PuzzleMode;
	pieces: number;
	time: number;
	at: number;
	/** How it was cut, to show it again in 3D */
	seed?: number;
	cols?: number;
	rows?: number;
	aspect?: number;
}

const RELAXED_SAVES_KEY = 'puzzleRelaxedSaves';
/** Where the one unfinished puzzle was kept before there could be several */
const OLD_SAVE_KEY = 'puzzleRelaxedSave';
const RELAXED_DONE_KEY = 'puzzleRelaxedDone';
/** How many unfinished puzzles are kept (the oldest goes) */
const MAX_SAVES = 12;

export const newSaveId = () => Math.random().toString(36).slice(2, 10);

/** The unfinished relaxed puzzles, the last played first */
export function loadRelaxedSaves(): RelaxedSave[] {
	const saves = read<RelaxedSave[]>(RELAXED_SAVES_KEY, []);
	const old = read<RelaxedSave | null>(OLD_SAVE_KEY, null);
	if (old) {
		saves.push({ ...old, id: old.id ?? newSaveId(), mode: 'jigsaw' });
		write(RELAXED_SAVES_KEY, saves);
		try {
			localStorage.removeItem(OLD_SAVE_KEY);
		} catch {
			// (it's moved anyway)
		}
	}
	return saves.sort((a, b) => b.at - a.at);
}

/** Keeps an unfinished puzzle; false if there was no room for it (a big picture of your own) */
export function keepRelaxed(save: RelaxedSave) {
	const others = loadRelaxedSaves().filter((other) => other.id !== save.id);
	const saves = [save, ...others].slice(0, MAX_SAVES);
	// Out of room: the oldest others make way
	while (saves.length) {
		try {
			localStorage.setItem(RELAXED_SAVES_KEY, JSON.stringify(saves));
			return true;
		} catch {
			if (saves.length === 1) return false;
			saves.pop();
		}
	}
	return false;
}

export function dropRelaxed(id: string) {
	write(
		RELAXED_SAVES_KEY,
		loadRelaxedSaves().filter((save) => save.id !== id)
	);
}

export const loadRelaxedDone = () => read<RelaxedRecord[]>(RELAXED_DONE_KEY, []);

/** Keeps a finished relaxed puzzle for the gallery (own pictures as a small copy) */
export async function finishRelaxed(record: RelaxedRecord) {
	let picture = record.picture;
	if (picture.image) {
		const small = await fetch(picture.image)
			.then((response) => response.blob())
			.then((blob) => ownPicture(blob, 360, 0.75))
			.catch(() => null);
		picture = { ...picture, image: small?.url ?? null };
	}
	write(RELAXED_DONE_KEY, [{ ...record, picture }, ...loadRelaxedDone()].slice(0, 60));
}

// --- Leaderboards: the server's places as the leaderboard shows them ---------------------------

const shortDate = (at: number) => new Date(at).toLocaleDateString();

/** A board of times: the time to the tenth, the moves and when */
export function timeBoard(board: PuzzleBoard | null) {
	if (!board) return null;
	const place = (score: PuzzleScore) => ({
		...score,
		value: formatTime(score.time, true),
		detail: `${score.moves} moves · ${shortDate(score.at)}`
	});
	return { ...board, entries: board.entries.map(place), mine: board.mine && place(board.mine) };
}

/** The overall leaderboards: what each ranks by */
export const TOP_BOARDS: {
	id: PuzzleTopBoard;
	label: string;
	icon: string;
	hint: string;
	value: (value: number) => string;
	detail: (count: number) => string;
}[] = [
	{
		id: 'daily',
		label: 'Daily points',
		icon: 'icon-[mingcute--calendar-day-line]',
		hint: 'Every daily puzzle: 100 points for the fastest, less the slower (half as fast, 50)',
		value: (value) => `${value.toLocaleString()} pts`,
		detail: (count) => `${count} daily ${count === 1 ? 'puzzle' : 'puzzles'}`
	},
	{
		id: 'records',
		label: 'Records',
		icon: 'icon-[mingcute--trophy-line]',
		hint: 'Puzzles with your time the fastest of all',
		value: (value) => `${value} ${value === 1 ? 'record' : 'records'}`,
		detail: (count) => `${count} ${count === 1 ? 'puzzle' : 'puzzles'} solved`
	},
	{
		id: 'solved',
		label: 'Most solved',
		icon: 'icon-[ri--puzzle-2-line]',
		hint: 'Different puzzles solved (a song in a mode and a difficulty)',
		value: (value) => `${value} ${value === 1 ? 'puzzle' : 'puzzles'}`,
		detail: (count) => `${count.toLocaleString()} pieces`
	},
	{
		id: 'streak',
		label: 'Streaks',
		icon: 'icon-[mingcute--fire-line]',
		hint: 'The most daily puzzles in a row',
		value: (value) => `${value} ${value === 1 ? 'day' : 'days'}`,
		detail: (count) => `${count} daily ${count === 1 ? 'puzzle' : 'puzzles'} in all`
	}
];

/** An overall board as the leaderboard shows it */
export function topBoard(
	board: { entries: PuzzleTopEntry[]; mine: PuzzleTopEntry | null; players: number } | null,
	id: PuzzleTopBoard
) {
	if (!board) return null;
	const kind = TOP_BOARDS.find((top) => top.id === id)!;
	const place = (entry: PuzzleTopEntry) => ({
		...entry,
		value: kind.value(entry.value),
		detail: kind.detail(entry.count)
	});
	return { ...board, entries: board.entries.map(place), mine: board.mine && place(board.mine) };
}
