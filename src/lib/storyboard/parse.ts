// Parses osu! storyboards: the [Events] of the .osb file and of a difficulty's .osu file

export type Layer = 'Background' | 'Fail' | 'Pass' | 'Foreground' | 'Overlay';
export type CommandType = 'F' | 'M' | 'MX' | 'MY' | 'S' | 'V' | 'R' | 'C' | 'P';

export interface Command {
	easing: number;
	start: number;
	end: number;
	from: number[];
	to: number[];
}

export interface StoryboardSprite {
	layer: Layer;
	/** Fraction of the image size where its position is (0,0 = top left) */
	origin: [number, number];
	/** Image path relative to the beatmap folder */
	path: string;
	x: number;
	y: number;
	/** Animations: frame count, ms per frame, whether they repeat */
	animation: { frames: number; delay: number; loop: boolean } | null;
	commands: Partial<Record<CommandType, Command[]>>;
	/** Flip and additive blending ("P" commands) */
	parameters: { type: 'H' | 'V' | 'A'; start: number; end: number }[];
	start: number;
	end: number;
}

export interface Storyboard {
	sprites: StoryboardSprite[];
	/** Every image the storyboard uses, to load them up front */
	images: string[];
	widescreen: boolean;
}

const LAYERS: Layer[] = ['Background', 'Fail', 'Pass', 'Foreground', 'Overlay'];
const ORIGINS: Record<string, [number, number]> = {
	TopLeft: [0, 0],
	Centre: [0.5, 0.5],
	CentreLeft: [0, 0.5],
	TopRight: [1, 0],
	BottomCentre: [0.5, 1],
	TopCentre: [0.5, 0],
	Custom: [0, 0],
	CentreRight: [1, 0.5],
	BottomLeft: [0, 1],
	BottomRight: [1, 1]
};
const ORIGIN_NAMES = Object.keys(ORIGINS);
const VALUE_COUNT: Record<string, number> = { F: 1, S: 1, R: 1, MX: 1, MY: 1, M: 2, V: 2, C: 3 };
/** Loops are expanded into plain commands; this keeps a runaway loop from freezing the app */
const MAX_COMMANDS_PER_SPRITE = 50_000;

function section(content: string, name: string) {
	// Many .osb files (e.g. from storybrew) start with a byte order mark, which would hide a
	// [Events] header on the first line
	content = content.replace(/^\uFEFF/, '');
	const match = content.split(new RegExp(`^\\[${name}\\]\\s*$`, 'm'))[1];
	return match ? match.split(/^\[[A-Za-z]+\]\s*$/m)[0] : '';
}

/** $name=value lines of the [Variables] section, longest name first */
function variables(content: string) {
	return section(content, 'Variables')
		.split(/\r?\n/)
		.map((line) => line.trim().match(/^(\$[^=]+)=(.*)$/))
		.filter(Boolean)
		.map((match) => [match[1], match[2]] as [string, string])
		.sort((a, b) => b[0].length - a[0].length);
}

function parseCommand(fields: string[]): [string, Command | null] {
	const type = fields[0];
	const easing = Number(fields[1]) || 0;
	const start = Number(fields[2]);
	const end = fields[3] === '' || fields[3] === undefined ? start : Number(fields[3]);
	if (type === 'P') return [type, { easing, start, end, from: [fields[4]?.charCodeAt(0)], to: [] }];
	const count = VALUE_COUNT[type];
	if (!count || !Number.isFinite(start)) return [type, null];
	const values = fields.slice(4).map(Number);
	if (values.length < count || values.some((value) => !Number.isFinite(value))) return [type, null];
	const from = values.slice(0, count);
	const to = values.length >= 2 * count ? values.slice(count, 2 * count) : from;
	return [type, { easing, start, end, from, to }];
}

/** Commands with more values than start and end are a chain of equally long steps */
function expandChain(fields: string[]): string[][] {
	const count = VALUE_COUNT[fields[0]];
	const values = fields.slice(4);
	if (!count || values.length <= 2 * count) return [fields];
	const start = Number(fields[2]);
	const end = fields[3] === '' ? start : Number(fields[3]);
	const duration = end - start;
	const steps: string[][] = [];
	for (let i = 0; (i + 2) * count <= values.length; i++) {
		steps.push([
			fields[0],
			fields[1],
			String(start + i * duration),
			String(end + i * duration),
			...values.slice(i * count, (i + 2) * count)
		]);
	}
	return steps;
}

function newSprite(fields: string[]): StoryboardSprite | null {
	const [kind, layerName, originName, rawPath, x, y, frames, delay, loopType] = fields;
	const layer = LAYERS.includes(layerName as Layer)
		? (layerName as Layer)
		: (LAYERS[Number(layerName)] ?? null);
	if (!layer) return null;
	const origin = ORIGINS[originName] ?? ORIGINS[ORIGIN_NAMES[Number(originName)]] ?? ORIGINS.Centre;
	const path = rawPath.replace(/^"|"$/g, '').replace(/\\/g, '/');
	return {
		layer,
		origin,
		path,
		x: Number(x) || 0,
		y: Number(y) || 0,
		animation:
			kind === 'Animation'
				? {
						frames: Math.max(1, Number(frames) || 1),
						delay: Math.max(1, Number(delay) || 1),
						loop: loopType !== 'LoopOnce'
					}
				: null,
		commands: {},
		parameters: [],
		start: Infinity,
		end: -Infinity
	};
}

/** The file of an animation frame: "sb/fire.png" frame 3 is "sb/fire3.png" */
export function framePath(path: string, frame: number) {
	const dot = path.lastIndexOf('.');
	return dot === -1 ? `${path}${frame}` : `${path.slice(0, dot)}${frame}${path.slice(dot)}`;
}

/** Parses the storyboard of the .osb file and the .osu file (either may be empty) */
export function parseStoryboard(osb: string, osu: string): Storyboard {
	const sprites: StoryboardSprite[] = [];
	// .osb sprites come first, so the difficulty's own ones are drawn on top
	for (const content of [osb, osu]) {
		if (!content) continue;
		const vars = variables(content);
		let sprite: StoryboardSprite | null = null;
		let loop: { start: number; count: number; commands: string[][] } | null = null;
		let inTrigger = false;
		let commandCount = 0;

		const add = (fields: string[], offset = 0) => {
			if (!sprite || commandCount > MAX_COMMANDS_PER_SPRITE) return;
			for (const step of expandChain(fields)) {
				const [type, command] = parseCommand(step);
				if (!command) continue;
				command.start += offset;
				command.end += offset;
				commandCount++;
				sprite.start = Math.min(sprite.start, command.start);
				sprite.end = Math.max(sprite.end, command.end);
				if (type === 'P') {
					const kind = String.fromCharCode(command.from[0]) as 'H' | 'V' | 'A';
					sprite.parameters.push({ type: kind, start: command.start, end: command.end });
				} else {
					(sprite.commands[type as CommandType] ??= []).push(command);
				}
			}
		};
		const closeLoop = () => {
			if (!loop) return;
			const length = Math.max(0, ...loop.commands.map((fields) => Number(fields[3] || fields[2])));
			for (let i = 0; i < loop.count; i++) {
				for (const fields of loop.commands) add(fields, loop.start + i * length);
			}
			loop = null;
		};
		const finish = () => {
			closeLoop();
			if (sprite && sprite.end >= sprite.start) {
				for (const list of Object.values(sprite.commands)) list.sort((a, b) => a.start - b.start);
				sprites.push(sprite);
			}
			sprite = null;
		};

		for (let line of section(content, 'Events').split(/\r?\n/)) {
			if (!line.trim() || line.startsWith('//')) continue;
			for (const [name, value] of vars) line = line.split(name).join(value);
			const depth = line.match(/^[ _]*/)[0].length;
			const fields = line.slice(depth).split(',');
			if (depth === 0) {
				finish();
				if (fields[0] === 'Sprite' || fields[0] === 'Animation') sprite = newSprite(fields);
				commandCount = 0;
			} else if (depth === 1) {
				closeLoop();
				inTrigger = fields[0] === 'T';
				if (fields[0] === 'L') {
					loop = {
						start: Number(fields[1]) || 0,
						count: Math.max(1, Number(fields[2]) || 1),
						commands: []
					};
				} else if (!inTrigger) add(fields);
			} else if (loop) {
				loop.commands.push(fields);
			}
		}
		finish();
	}

	const images = new Set<string>();
	for (const sprite of sprites) {
		if (!sprite.animation) images.add(sprite.path);
		else for (let i = 0; i < sprite.animation.frames; i++) images.add(framePath(sprite.path, i));
	}
	return { sprites, images: [...images], widescreen: /^WidescreenStoryboard\s*:\s*1/m.test(osu) };
}

/** Whether a .osb or .osu file has storyboard sprites at all */
export function hasStoryboard(content: string) {
	return /^(Sprite|Animation),/m.test(section(content, 'Events'));
}
