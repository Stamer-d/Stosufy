// Making a Dash level for a beatmap: in a worker (the page goes on meanwhile), and moving it
// from there as plain data.

import { parseChart } from './chart';
import { generateLevel, type Difficulty, type Level } from './generate';
import { World } from './physics';

export type LevelData = Omit<Level, 'world'> & {
	world: Pick<World, 'sections' | 'segments'> & {
		solids: World['solids']['items'];
		hazards: World['hazards']['items'];
		orbs: World['orbs']['items'];
		pads: World['pads']['items'];
		walls: World['walls']['items'];
	};
};

export function levelData(level: Level): LevelData {
	const w = level.world;
	return {
		...level,
		world: {
			sections: w.sections,
			segments: w.segments,
			solids: w.solids.items,
			hazards: w.hazards.items,
			orbs: w.orbs.items,
			pads: w.pads.items,
			walls: w.walls.items
		}
	};
}

export function levelFromData(data: LevelData): Level {
	const world = new World();
	world.sections = data.world.sections;
	world.segments = data.world.segments;
	for (const s of data.world.solids) world.solids.add(s);
	for (const h of data.world.hazards) world.hazards.add(h);
	for (const o of data.world.orbs) world.orbs.add(o);
	for (const p of data.world.pads) world.pads.add(p);
	for (const w of data.world.walls) world.walls.add(w);
	world.solids.touch();
	world.hazards.touch();
	return { ...data, world };
}

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<
	number,
	{ resolve: (level: Level) => void; reject: (error: Error) => void }
>();

function getWorker() {
	if (worker) return worker;
	try {
		worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (event) => {
			const { id, level, error } = event.data;
			const request = waiting.get(id);
			waiting.delete(id);
			if (!request) return;
			if (error) request.reject(new Error(error));
			else request.resolve(levelFromData(level));
		};
		worker.onerror = () => {
			for (const request of waiting.values()) request.reject(new Error('worker'));
			waiting.clear();
			worker = null;
		};
	} catch {
		worker = null;
	}
	return worker;
}

const cache = new Map<string, Promise<Level>>();

/** The level of a beatmap (the same one again for the same beatmap and difficulty) */
export function makeLevel(
	content: string,
	options: { difficulty: Difficulty; seed: string; duration: number }
): Promise<Level> {
	const key = `${options.seed}:${options.difficulty}:${Math.round(options.duration / 1000)}:${content.length}`;
	if (!cache.has(key)) {
		const made = new Promise<Level>((resolve, reject) => {
			const w = getWorker();
			const here = () => {
				try {
					const chart = parseChart(content);
					if (!chart) throw new Error('This beatmap has no notes');
					resolve(generateLevel(chart, options));
				} catch (error) {
					reject(error);
				}
			};
			if (!w) return void setTimeout(here, 0);
			const id = nextId++;
			waiting.set(id, {
				resolve,
				reject: (error) => (error.message === 'worker' ? here() : reject(error))
			});
			w.postMessage({ id, content, ...options });
		});
		made.catch(() => cache.delete(key));
		cache.set(key, made);
		if (cache.size > 6) cache.delete(cache.keys().next().value!);
	}
	return cache.get(key)!;
}
