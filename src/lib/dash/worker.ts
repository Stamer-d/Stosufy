// Makes a Dash level away from the page (a long map takes a moment)

import { parseChart } from './chart';
import { generateLevel, type Difficulty } from './generate';
import { levelData } from './level';
import type { SongSound } from './audio';

self.onmessage = (event: MessageEvent) => {
	const { id, content, difficulty, seed, duration, sound } = event.data as {
		id: number;
		content: string;
		difficulty: Difficulty;
		seed: string;
		duration: number;
		sound?: SongSound | null;
	};
	try {
		const chart = parseChart(content);
		if (!chart) throw new Error('This beatmap has no notes');
		chart.sound = sound;
		const level = generateLevel(chart, { difficulty, seed, duration });
		self.postMessage({ id, level: levelData(level) });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
