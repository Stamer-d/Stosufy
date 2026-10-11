// The path of a slider: the curve types of osu! (linear, bezier, perfect circle, catmull)
// as a polyline, cut to the slider's length (like osu!, which also extends it if shorter).

export type Point = { x: number; y: number };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function bezier(points: Point[]): Point[] {
	// Enough steps for a smooth curve, by the length of its control polygon
	let length = 0;
	for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
	const steps = Math.max(2, Math.min(200, Math.ceil(length / 4)));
	const out: Point[] = [];
	for (let s = 0; s <= steps; s++) {
		const t = s / steps;
		let row = points.map((p) => ({ ...p }));
		while (row.length > 1) {
			row = row.slice(1).map((p, i) => ({
				x: row[i].x + (p.x - row[i].x) * t,
				y: row[i].y + (p.y - row[i].y) * t
			}));
		}
		out.push(row[0]);
	}
	return out;
}

function perfectCircle([a, b, c]: Point[]): Point[] | null {
	const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
	if (Math.abs(d) < 1e-6) return null; // in a line
	const sq = (p: Point) => p.x * p.x + p.y * p.y;
	const center = {
		x: (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d,
		y: (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d
	};
	const radius = dist(a, center);
	const angle = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x);
	const start = angle(a);
	let end = angle(c);
	// The direction that passes through b
	const clockwise = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0;
	if (clockwise) {
		while (end > start) end -= 2 * Math.PI;
	} else {
		while (end < start) end += 2 * Math.PI;
	}
	const steps = Math.max(2, Math.ceil((Math.abs(end - start) * radius) / 4));
	const out: Point[] = [];
	for (let s = 0; s <= steps; s++) {
		const t = start + ((end - start) * s) / steps;
		out.push({ x: center.x + radius * Math.cos(t), y: center.y + radius * Math.sin(t) });
	}
	return out;
}

function catmull(points: Point[]): Point[] {
	const out: Point[] = [];
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i - 1] ?? points[i];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[i + 2] ?? p2;
		for (let s = 0; s < 50; s++) {
			const t = s / 50;
			const t2 = t * t;
			const t3 = t2 * t;
			const at = (k: 'x' | 'y') =>
				0.5 *
				(2 * p1[k] +
					(-p0[k] + p2[k]) * t +
					(2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
					(-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
			out.push({ x: at('x'), y: at('y') });
		}
	}
	out.push(points[points.length - 1]);
	return out;
}

export class SliderPath {
	points: Point[];
	/** Distance from the start to each point */
	private lengths: number[];
	length: number;

	constructor(type: string, controls: Point[], length: number) {
		let points: Point[];
		if (type === 'P' && controls.length === 3) points = perfectCircle(controls) ?? bezier(controls);
		else if (type === 'C') points = catmull(controls);
		else if (type === 'L') points = controls;
		else {
			// Bezier, split into segments at repeated (red) points
			points = [];
			let segment: Point[] = [controls[0]];
			for (let i = 1; i < controls.length; i++) {
				const p = controls[i];
				const prev = controls[i - 1];
				if (p.x === prev.x && p.y === prev.y) {
					if (segment.length > 1) points.push(...bezier(segment));
					segment = [p];
				} else segment.push(p);
			}
			if (segment.length > 1) points.push(...bezier(segment));
			if (!points.length) points = controls;
		}

		// Cut to (or extend to) the slider's length
		const cut: Point[] = [points[0]];
		const lengths = [0];
		let total = 0;
		for (let i = 1; i < points.length && (length <= 0 || total < length); i++) {
			const d = dist(points[i - 1], points[i]);
			if (d === 0) continue;
			if (length > 0 && total + d > length) {
				const t = (length - total) / d;
				cut.push({
					x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
					y: points[i - 1].y + (points[i].y - points[i - 1].y) * t
				});
				total = length;
				lengths.push(total);
				break;
			}
			total += d;
			cut.push(points[i]);
			lengths.push(total);
		}
		if (length > 0 && total < length && cut.length > 1) {
			const a = cut[cut.length - 2];
			const b = cut[cut.length - 1];
			const d = dist(a, b) || 1;
			const extra = length - total;
			cut.push({ x: b.x + ((b.x - a.x) / d) * extra, y: b.y + ((b.y - a.y) / d) * extra });
			lengths.push(length);
			total = length;
		}
		this.points = cut;
		this.lengths = lengths;
		this.length = total;
	}

	/** The point at a part of the path (0: start, 1: end) */
	at(progress: number): Point {
		const target = Math.max(0, Math.min(1, progress)) * this.length;
		let low = 0;
		let high = this.lengths.length - 1;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (this.lengths[mid] < target) low = mid + 1;
			else high = mid;
		}
		if (low === 0) return this.points[0];
		const a = this.points[low - 1];
		const b = this.points[low];
		const span = this.lengths[low] - this.lengths[low - 1] || 1;
		const t = (target - this.lengths[low - 1]) / span;
		return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
	}

	/** The direction (radians) at a part of the path */
	angleAt(progress: number) {
		const a = this.at(Math.max(0, progress - 0.01));
		const b = this.at(Math.min(1, progress + 0.01));
		return Math.atan2(b.y - a.y, b.x - a.x);
	}
}
