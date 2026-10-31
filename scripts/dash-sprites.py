# Cuts the Dash sprite sheet (8 × 7 cells on a magenta background, made with an image AI)
# into the sprites the Dash renderer draws: the background goes, the glow around the outlines
# stays (as the colour it was before the magenta got into it), and every sprite's box is
# written to src/lib/dash/sprites.ts.
#   python scripts/dash-sprites.py <sheet.png|webp>
# Needs Pillow, numpy and scipy.

import colorsys
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT_IMAGE = ROOT / 'src/lib/dash/sprites.webp'
OUT_MAP = ROOT / 'src/lib/dash/sprites.ts'

# What is in which cell, row by row
NAMES = [
	['icon0', 'icon1', 'icon2', 'icon3', 'icon4', 'icon5', 'icon6', 'icon7'],
	['ship', 'ufo', 'ball', 'wave', 'swing', 'spider', None, None],
	['tile', 'tileTop', 'tileCorner', 'slab', 'chain', 'slopeUp', 'slopeDown', 'tileOutline'],
	['spike', 'spikeSmall', 'spikeDown', 'spikes3', 'saw', 'sawBig', 'sawHalf', 'thorns'],
	['orbYellow', 'orbPink', 'orbRed', 'orbBlue', 'orbGreen', 'orbBlack', 'padYellow', 'padPink'],
	['portalCube', 'portalShip', 'portalBall', 'portalWave', 'portalUfo', 'portalSwing',
	 'portalSpider', 'speed'],
	['fxRing', 'fxDebris', 'fxSparks', 'fxFlame', 'checkpoint', 'play', 'pause', 'bar'],
]
# Sprites made from another one in a new colour (PORTAL_COLORS in render.ts)
RECOLOR = {'portalShip': ('portalWave', '#ff4fd8'), 'portalSpider': ('portalWave', '#b14dff')}
SOURCE_COLOR = {'portalWave': '#3ad7ff'}


def hue(color):
	"""A #rrggbb colour's hue, 0–1"""
	return colorsys.rgb_to_hsv(*[int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)])[0]


def hue_rotation(angle):
	"""The matrix that turns colours' hue by an angle (as CSS hue-rotate does)"""
	c, s = np.cos(angle), np.sin(angle)
	return np.array([
		[0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
		[0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283],
		[0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
	])


def grid_lines(line, axis, count, size):
	"""The sheet's thin dark grid lines along an axis: where most of a row (column) is one"""
	hits = line.sum(axis=axis)
	found = [i for i in range(size) if hits[i] > line.shape[axis] * 0.25]
	groups = []
	for i in found:
		if groups and i - groups[-1][-1] <= 2:
			groups[-1].append(i)
		else:
			groups.append([i])
	centers = [round(sum(g) / len(g)) for g in groups]
	# The sheet's edges count as lines too
	if not centers or centers[0] > size * 0.05:
		centers = [0] + centers
	if centers[-1] < size * 0.95:
		centers = centers + [size - 1]
	if len(centers) != count + 1:
		sys.exit(f'Expected {count} cells along an axis, found lines at {centers}')
	return centers


def key(cell, bg):
	"""Alpha and colour of a cell without its background"""
	diff = cell - bg
	# Far from the magenta, mostly by green (pinks are close in red and blue)
	distance = np.sqrt(1.5 * diff[..., 1] ** 2 + 0.5 * diff[..., 0] ** 2 + 0.5 * diff[..., 2] ** 2)
	background = distance < 16
	luma = cell @ np.array([0.3, 0.59, 0.11])
	# Outside the outlines: reached from the cell's edge without crossing anything dark (small
	# gaps in an outline closed first, then the few pixels next to it given back)
	dark = luma <= 70
	labels, _ = ndimage.label(~ndimage.binary_dilation(dark, iterations=2))
	edge = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
	outside = ndimage.binary_dilation(np.isin(labels, edge[edge > 0]), iterations=3) & ~dark
	# Outside and along holes, the smallest alpha that explains the pixel as some colour over
	# the magenta (the glow keeps its own colour); inside, all that isn't background is solid
	blend = outside | ndimage.binary_dilation(background, iterations=2)
	up = np.where(diff > 0, diff / np.maximum(255 - bg, 60), -diff / np.maximum(bg, 60))
	alpha = np.clip(up.max(axis=-1), 0, 1)
	alpha = np.where(blend, alpha, 1.0)
	alpha[background] = 0
	safe = np.maximum(alpha, 1e-3)[..., None]
	color = np.clip((cell - (1 - alpha[..., None]) * bg) / safe, 0, 255)
	color = np.where(blend[..., None], color, cell)
	return alpha, color


def main():
	if len(sys.argv) < 2:
		sys.exit(__doc__ or 'usage: python scripts/dash-sprites.py <sheet>')
	sheet = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)
	height, width, _ = sheet.shape
	# The grid lines are a darker magenta
	line = (np.abs(sheet[..., 0] - 190) < 30) & (sheet[..., 1] < 15) & (np.abs(sheet[..., 2] - 212) < 25)
	xs = grid_lines(line, 0, len(NAMES[0]), width)
	ys = grid_lines(line, 1, len(NAMES), height)
	out = np.zeros((height, width, 4), dtype=np.uint8)
	boxes = {}
	for r, row in enumerate(NAMES):
		for c, name in enumerate(row):
			if not name:
				continue
			x0, x1 = xs[c] + 4, xs[c + 1] - 3
			y0, y1 = ys[r] + 4, ys[r + 1] - 3
			cell = sheet[y0:y1, x0:x1]
			border = np.concatenate([cell[0], cell[-1], cell[:, 0], cell[:, -1]])
			bg = np.median(border, axis=0)
			alpha, color = key(cell, bg)
			seen = np.argwhere(alpha > 0.06)
			if not len(seen):
				continue
			(top, left), (bottom, right) = seen.min(0), seen.max(0) + 1
			out[y0:y1, x0:x1, :3] = color.round().astype(np.uint8)
			out[y0:y1, x0:x1, 3] = (alpha * 255).round().astype(np.uint8)
			boxes[name] = (x0 + int(left), y0 + int(top), int(right - left), int(bottom - top))
	# Magenta on magenta can't be told apart: those portals are the cyan one in their colour
	cell_of = {name: (r, c) for r, row in enumerate(NAMES) for c, name in enumerate(row) if name}
	for name, (source, target) in RECOLOR.items():
		if source not in boxes:
			continue
		x, y, w, h = boxes[source]
		sr, sc = cell_of[source]
		tr, tc = cell_of[name]
		tx, ty = x - xs[sc] + xs[tc], y - ys[sr] + ys[tr]
		turn = np.radians((hue(target) - hue(SOURCE_COLOR[source])) * 360)
		rgb = out[y : y + h, x : x + w, :3].astype(float) @ hue_rotation(turn).T
		out[ys[tr] : ys[tr + 1], xs[tc] : xs[tc + 1]] = 0
		out[ty : ty + h, tx : tx + w, :3] = np.clip(rgb, 0, 255).round().astype(np.uint8)
		out[ty : ty + h, tx : tx + w, 3] = out[y : y + h, x : x + w, 3]
		boxes[name] = (tx, ty, w, h)
	# Only the sprites' boxes keep anything (the rest is cleared)
	keep = np.zeros((height, width), dtype=bool)
	for x, y, w, h in boxes.values():
		keep[y : y + h, x : x + w] = True
	out[~keep] = 0
	Image.fromarray(out).save(OUT_IMAGE, quality=92, alpha_quality=100, method=6)
	lines = [
		'// Made by scripts/dash-sprites.py from the sprite sheet: where each sprite is in',
		'// sprites.webp (x, y, width, height). Not to be edited by hand.',
		'',
		'export const SPRITES = {',
		*[f'\t{name}: [{x}, {y}, {w}, {h}],' for name, (x, y, w, h) in boxes.items()],
		'} as const satisfies Record<string, readonly [number, number, number, number]>;',
		'',
		'export type SpriteName = keyof typeof SPRITES;',
		'',
		'/** How big sprites.webp is */',
		f'export const ATLAS = [{width}, {height}] as const;',
		'',
	]
	OUT_MAP.write_text('\n'.join(lines), encoding='utf-8')
	print(f'{len(boxes)} sprites -> {OUT_IMAGE.relative_to(ROOT)}, {OUT_MAP.relative_to(ROOT)}')


if __name__ == '__main__':
	main()
