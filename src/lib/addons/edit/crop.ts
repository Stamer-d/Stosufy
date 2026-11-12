// The part of a picture (or a video's picture) kept: its shapes, and the biggest one of a
// shape in the middle.

export interface Crop {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** [id, label, width / height (0: any)] */
export const SHAPES: [string, string, number][] = [
	['free', 'Free', 0],
	['1:1', 'Square', 1],
	['4:3', '4:3', 4 / 3],
	['16:9', '16:9', 16 / 9],
	['9:16', '9:16', 9 / 16]
];

export const ratioOf = (shape: string) => SHAPES.find(([id]) => id === shape)?.[2] ?? 0;

/** The biggest part of this shape (width / height) of a `width` × `height` picture, in the middle */
export function biggest(ratio: number, width: number, height: number): Crop {
	if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
	let w = 1;
	let h = (width * w) / (height * ratio);
	if (h > 1) {
		h = 1;
		w = (height * h * ratio) / width;
	}
	return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
