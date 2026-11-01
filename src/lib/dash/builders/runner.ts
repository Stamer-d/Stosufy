// Grounded modes: plan connected takeoff/landing terrain first, then put the
// obstacle in the flight corridor. There is no independently chosen upper lane.
import { Attempt, half, type Context } from '../build';
import { composePhrases, musicalRest } from '../composition';
import { hitAt } from '../audio';
import {
	cubeAt,
	hitbox,
	simulate,
	STEP,
	type InputEvent,
	type PlayerState,
	type Section,
	type Solid
} from '../physics';

type Point = { x: number; y: number; time: number };

export function buildRunner(ctx: Context, sec: Section, clicks: number[], entry: PlayerState) {
	const { world, plan, preset } = ctx;
	const box = hitbox(sec.mode, sec.mini);
	const notes = new Map(ctx.chart.notes.map((n) => [n.time, n]));
	const times = clicks.filter(
		(t) => t > sec.start + 650 && t < sec.end - 850 && !musicalRest(ctx.chart, t)
	);
	const phrases = composePhrases(ctx.chart, times);
	let state = entry;
	let platform: Solid | null =
		world.solids
			.near(entry.x - box.w, entry.x + box.w)
			.find((s) => Math.abs(s.y1 - (entry.y - box.h)) < 0.02) ?? null;
	let previous: { from: PlayerState; variants: InputEvent[][] } | null = null;
	const tolerance = preset.tolerance;
	const speed = sec.speed;
	const exitX = world.xAt(sec.end - 700);

	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		state = simulate(world, state, time - tolerance - STEP * 3, plan);
		if (state.dead) break;
		const at = simulate(world, state, time, plan);
		if (!at.grounded || at.gravity !== 1) continue;
		const height = half(at.y - box.h);
		const phrase = phrases.find((p) => time >= p.start && time < p.end)!;
		const phraseTimes = times.filter((t) => t >= phrase.start && t < phrase.end);
		const position = phraseTimes.indexOf(time);
		const phase = position / Math.max(1, phraseTimes.length - 1);
		const ceiling = Math.min(preset.height, sec.mini ? 2 : 3);
		// A complete rise/return contour, with a flat introductory phrase and clear exit.
		const target =
			ctx.simplify || preset.level === 0 || time < sec.start + 1800 || time > sec.end - 2500
				? 0
				: Math.round(Math.sin(phase * Math.PI) * ceiling);
		const desired = Math.max(0, Math.min(height + 1, Math.max(height - 1, target)));
		const beat = ctx.chart.timing.reduce(
			(a, p) => (p.time <= time ? p : a),
			ctx.chart.timing[0]
		).beatLength;
		const hold =
			sec.mode === 'robot'
				? Math.min(
						285,
						Math.max(
							desired > height ? 240 : 100,
							Math.min(notes.get(time)?.end ?? time, time + beat * 0.5) - time || beat * 0.3
						)
					)
				: 90;
		const second = times[i + 1];
		const pair =
			!ctx.simplify &&
			preset.chain > 0 &&
			second !== undefined &&
			second - time >= 180 &&
			second - time < 310;
		const sustain = (notes.get(time)?.end ?? time) - time;
		const room = (times[i + 1] ?? sec.end) - time;
		const accent = ctx.chart.sound?.hits
			? hitAt(ctx.chart.sound, time)
			: (notes.get(time)?.sound ?? 0) & 4
				? 1
				: 0;
		const groundRing =
			!ctx.simplify &&
			preset.level >= 1 &&
			position === phraseTimes.length - 1 &&
			accent > 0.7 &&
			room > 550;
		const launches = [
			...(groundRing
				? [
						{
							orb: false,
							pad: false,
							dash: false,
							ring: room > 1000 && preset.level >= 2 ? ('red' as const) : ('yellow' as const)
						}
					]
				: []),
			...(pair ? [{ orb: true, pad: false, dash: false }] : []),
			...(!ctx.simplify && preset.level >= 1 && sustain >= 250 && room > 850
				? [
						{ orb: false, pad: sustain < beat * 0.75, dash: sustain >= beat * 0.75 },
						{ orb: false, pad: sustain >= beat * 0.75, dash: sustain < beat * 0.75 }
					]
				: []),
			{ orb: false, pad: false, dash: false }
		];
		let committed = false;
		for (const launch of launches) {
			const useOrb = launch.orb;
			const ring = 'ring' in launch ? launch.ring : undefined;
			if (committed) break;
			const next = times[i + (useOrb ? 2 : 1)] ?? sec.end;
			const until = Math.min(sec.end, time + Math.max(1100, next - time + 120));
			const nominal: InputEvent[] = launch.pad
				? []
				: [
						{ time, down: true },
						{ time: time + (launch.dash ? Math.min(700, sustain) : hold), down: false }
					];
			if (useOrb) nominal.push({ time: second!, down: true }, { time: second! + 90, down: false });
			const variants = [-tolerance, 0, tolerance].flatMap((shift) =>
				(sec.mode === 'robot' ? [-20, 20] : [0]).map((release) =>
					nominal.map((e, k) => ({
						time: e.time + shift + (k === 1 ? release : 0),
						down: e.down
					}))
				)
			);
			const layouts = ctx.simplify ? [height] : [...new Set([desired, height, 0])];
			for (const landing of layouts) {
				const a = new Attempt(world, exitX);
				const old = platform;
				const edge = half(at.x + speed * (tolerance / 1000 + 0.075));
				if (old) {
					const end = old.x1;
					a.change(
						() => (old.x1 = Math.max(old.x0 + 0.5, edge)),
						() => (old.x1 = end)
					);
				}
				if (ring) a.orb(ring, world.xAt(time), height + box.h);
				if (launch.pad) a.pad('yellow', at.x + box.w + 0.42, height);
				if (launch.dash) a.orb('dash', world.xAt(time), height + box.h, 1);
				if (useOrb) {
					const airborne = simulate(world, state, second!, nominal.slice(0, 2));
					if (airborne.dead || airborne.grounded) {
						a.revert();
						continue;
					}
					a.orb('yellow', world.xAt(second!), airborne.y);
				}
				const trace: Point[] = [];
				simulate(world, state, Math.min(sec.end, time + 1300), nominal, { trace });
				const fall = trace.find(
					(p, k) =>
						k > 0 &&
						p.time > time + (useOrb ? second! - time + 70 : 70) &&
						p.y < trace[k - 1].y &&
						p.y - box.h <= landing + 0.08 &&
						trace[k - 1].y - box.h >= landing - 0.08
				);
				let nextPlatform: Solid | null = null;
				if (!fall) {
					a.revert();
					continue;
				}
				const resume = half(fall.x - box.w - speed * 0.035);
				const terrain = landing > 0 || height > 0 || useOrb || launch.pad || launch.dash;
				if (terrain) {
					if (
						resume - edge < 1.5 ||
						resume + 2 > world.xAt(next) - (speed * tolerance) / 1000 ||
						resume + 2 > exitX
					) {
						a.revert();
						continue;
					}
					if (landing > 0)
						nextPlatform = a.solid({ x0: resume, x1: exitX, y0: sec.floor, y1: landing, style: 0 });
					const end = Math.floor(resume - 0.55);
					const from = Math.ceil(edge) + 0.5;
					const bass = ctx.chart.sound?.kicks?.[Math.floor(time / ctx.chart.sound.hop)] ?? 0;
					if (!ctx.simplify && preset.level >= 2 && bass > 0.65 && end - from >= 4) {
						a.spike(from, sec.floor, 1, 'small');
						a.saw(half((from + end) / 2), sec.floor + 0.1, 0.8);
						a.spike(end - 0.5, sec.floor, 1, 'small');
					} else for (let x = from; x < end; x++) a.spike(x, sec.floor, 1, 'small');
				} else {
					// A low block and a spike group answer each other on the same grounded route.
					const apex = trace.reduce((best, p) => (p.y > best.y ? p : best), trace[0]);
					const center = half(apex.x);
					const strength = ctx.chart.sound?.hits
						? hitAt(ctx.chart.sound, time)
						: (notes.get(time)?.sound ?? 0);
					const count = ctx.simplify
						? 1
						: Math.min(preset.spikes, strength > 0.7 && preset.level > 0 ? 3 : 2);
					if (position % 2 === 0 && !ctx.simplify && sec.mode !== 'robot') {
						a.solid({
							x0: Math.floor(center) - 0.5,
							x1: Math.floor(center) + 1,
							y0: 0,
							y1: 1,
							style: 0
						});
					} else
						for (let k = 0; k < count; k++)
							a.spike(
								center + k - (count - 1) / 2,
								sec.floor,
								1,
								sec.mode === 'robot' ? 'small' : 'spike'
							);
				}
				const allPass =
					a.legal() &&
					variants.every((v) => !simulate(world, state, until, v).dead) &&
					(!previous ||
						previous.variants.every(
							(v) =>
								!simulate(
									world,
									previous!.from,
									until,
									[...v, ...nominal].sort((a, b) => a.time - b.time)
								).dead
						));
				const required = launch.pad
					? true
					: !simulate(world, state, until, []).dead
						? false
						: !useOrb || simulate(world, state, until, nominal.slice(0, 2)).dead;
				if (!allPass || !required) {
					a.revert();
					continue;
				}
				platform = nextPlatform;
				plan.push(...nominal);
				plan.sort((a, b) => a.time - b.time);
				previous = { from: state, variants };
				committed = true;
				if (useOrb) i++;
				break;
			}
		}
	}
	// The last support ends early enough to settle onto the next mode's floor.
	if (platform) {
		platform.x1 = Math.min(platform.x1, exitX);
		world.solids.touch();
	}
	return simulate(world, entry, sec.end, plan);
}
