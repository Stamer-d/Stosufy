// Parsing of the .osu files inside a beatmap set (.osz)

function eventsSection(osuFileContent: string) {
	return osuFileContent.split(/^\[Events\]\s*$/m)[1]?.split(/^\[/m)[0];
}

/** The video of a beatmap and its start in ms: the `Video,offset,"file"` line in [Events] */
export function findVideo(osuFileContent: string): { file: string; offset: number } | null {
	const events = eventsSection(osuFileContent);
	const match = events?.match(/^(?:Video|1)\s*,\s*(-?\d+)\s*,\s*"?([^",\r\n]+)"?/m);
	return match ? { file: match[2].trim().replace(/\\/g, '/'), offset: Number(match[1]) } : null;
}

/** The background image of a beatmap: the `0,0,"file"` line in the [Events] section */
export function findBackground(osuFileContent: string): string | null {
	const events = eventsSection(osuFileContent);
	const match = events?.match(/^0\s*,\s*0\s*,\s*"?([^",\r\n]+)"?/m);
	return match ? match[1].trim().replace(/\\/g, '/') : null;
}

/** An uninherited ("red") timing point: where a BPM section starts */
export interface TimingPoint {
	/** Start in ms */
	time: number;
	/** Length of one beat in ms */
	beatLength: number;
	/** Beats per bar */
	meter: number;
}

export interface OsuFileInfo {
	audioFile: string | null;
	title: string;
	artist: string;
	creator: string;
	version: string;
	tags: string;
	beatmapId: number | null;
	setId: number | null;
	mode: string;
	background: string | null;
	video: { file: string; offset: number } | null;
	timingPoints: TimingPoint[];
}

const MODES = ['osu', 'taiko', 'fruits', 'mania'];

/** Reads the parts of a .osu file Stosufy needs */
export function parseOsuFile(content: string): OsuFileInfo {
	const value = (key: string) =>
		content.match(new RegExp(`^${key}\\s*:\\s*(.*?)\\s*$`, 'm'))?.[1] ?? '';
	const number = (key: string) => {
		const parsed = parseInt(value(key), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	};
	return {
		audioFile: value('AudioFilename') || null,
		title: value('Title'),
		artist: value('Artist'),
		creator: value('Creator'),
		version: value('Version'),
		tags: value('Tags'),
		beatmapId: number('BeatmapID'),
		setId: number('BeatmapSetID'),
		mode: MODES[parseInt(value('Mode'), 10)] ?? 'osu',
		background: findBackground(content),
		video: findVideo(content),
		timingPoints: parseTimingPoints(content)
	};
}

/** The uninherited timing points, in order */
export function parseTimingPoints(content: string): TimingPoint[] {
	const section = content.split(/^\[TimingPoints\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
	const points: TimingPoint[] = [];
	for (const line of section.split(/\r?\n/)) {
		const fields = line.split(',');
		if (fields.length < 2) continue;
		const time = Number(fields[0]);
		const beatLength = Number(fields[1]);
		// Old files have no "uninherited" field; there a positive beat length marks a red line
		const uninherited = fields.length > 6 ? fields[6].trim() === '1' : beatLength > 0;
		if (!uninherited || !(beatLength > 0) || !Number.isFinite(time)) continue;
		points.push({ time, beatLength, meter: Number(fields[2]) || 4 });
	}
	return points.sort((a, b) => a.time - b.time);
}

/** BPM of the longest timing section, like osu! shows it */
export function mainBpm(points: TimingPoint[], length: number) {
	let best = null;
	let bestDuration = -1;
	points.forEach((point, i) => {
		const end = points[i + 1]?.time ?? Math.max(length, point.time);
		if (end - point.time > bestDuration) {
			bestDuration = end - point.time;
			best = point;
		}
	});
	return best ? Math.round((60000 / best.beatLength) * 100) / 100 : 0;
}
