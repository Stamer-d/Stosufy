# Cuts the Dash sprite sheets (made with an image AI, on a magenta background) into the sprites
# the Dash renderer draws: the background goes, the glow around the outlines stays (as the colour
# it was before the magenta got into it), the portals keep only their ring (no specks around
# them: the game draws its own particles), and every sprite is packed into one atlas,
# src/lib/addons/dash/sprites.webp, with its box written to src/lib/addons/dash/sprites.ts.
#   python scripts/dash-sprites.py
# Needs Pillow, numpy and scipy.

import colorsys
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT_IMAGE = ROOT / 'src/lib/addons/dash/sprites.webp'
OUT_MAP = ROOT / 'src/lib/addons/dash/sprites.ts'

# The first sheet (8 × 7 cells with thin grid lines): what is in which cell, row by row (None:
# not used, its portals have specks baked in: the portal sheet has them clean)
FIRST = [
	['icon0', 'icon1', 'icon2', 'icon3', 'icon4', 'icon5', 'icon6', 'icon7'],
	['ship', 'ufo', 'ball', 'wave', 'swing', 'spider', None, None],
	[None] * 8,
	['spike', 'spikeSmall', None, None, 'saw', 'sawBig', None, None],
	['orbYellow', 'orbPink', 'orbRed', 'orbBlue', 'orbGreen', 'orbBlack', 'padYellow', 'padPink'],
	[None] * 8,
	[None, None, None, None, 'checkpoint', None, None, None],
]
# The objects (8 × 6, no grid lines)
OBJECTS = [
	[None, None, None, None, None, 'speed0', 'speed1', 'speed2'],
	['speed3', 'speed4', 'padRed', 'padBlue', 'orbDash', 'orbSpider', 'robot', 'fxShock'],
	['spikeCrystal', 'spikeCrystalSmall', 'spikeThorn', 'spikeThornSmall',
	 'spikeSteel', 'spikeSteelSmall', 'spikeFlame', 'spikeFlameSmall'],
	['sawRed', 'sawStar', 'sawMace', 'sawGear', 'sawEye', 'sawCrystal', 'sawEnergy', 'sawHook'],
	['decoChain', 'decoCog', 'decoCogSmall', 'decoCrystals', 'decoLamp', 'decoSpeaker',
	 'decoNote', 'decoSign'],
	['decoGrass', 'decoVines', 'decoMushroom', 'decoPipe', 'decoAntenna', 'decoCubes',
	 'decoSparkle', 'decoCloud'],
]
# The block styles (8 × 6, grey: the game tints them): a style a row
STYLES = ['tech', 'brick', 'ice', 'metal', 'grid', 'carved']
TILES = [
	[f'{s}{part}' for part in ['Block', 'Top', 'Bottom', 'Corner', 'Slab', 'Pillar', 'Spike', 'Deco']]
	for s in STYLES
]
# The portals and the bodies of the spider and the robot (6 × 2)
PORTALS = [
	['portalCube', 'portalBall', 'portalWave', 'portalUfo', 'portalSwing', 'portalRobot'],
	['portalGravityDown', 'portalGravityUp', 'portalMini', 'portalBig', 'spiderBody', 'robotBody'],
]
# (each: its file, what's in it, whether it has grid lines, whether its sprites glow)
SHEETS = [
	('scripts/dash-sprite-sheet.webp', FIRST, True, True),
	('scripts/dash-sprite-sheet-objects.webp', OBJECTS, False, True),
	('scripts/dash-sprite-sheet-tiles.webp', TILES, False, False),
	('scripts/dash-sprite-sheet-portals.webp', PORTALS, False, True),
]
# The largest a sprite is kept (pixels): about what a block is on a big screen
LARGEST = 168
# The atlas's width, and the room between two sprites in it
ATLAS_WIDTH = 1024
GAP = 3

# Sprites made from another one in a new colour (PORTAL_COLORS in render.ts): pink and purple
# can't be told apart from the magenta background
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


def key(cell, bg, glow=True):
	"""Alpha and colour of a cell without its background (without a glow: only the background's
	own pixels and their neighbours are blended, all else is solid)"""
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
	blend = ndimage.binary_dilation(background, iterations=2)
	if glow:
		blend |= outside
	up = np.where(diff > 0, diff / np.maximum(255 - bg, 60), -diff / np.maximum(bg, 60))
	alpha = np.clip(up.max(axis=-1), 0, 1)
	alpha = np.where(blend, alpha, 1.0)
	alpha[background] = 0
	safe = np.maximum(alpha, 1e-3)[..., None]
	color = np.clip((cell - (1 - alpha[..., None]) * bg) / safe, 0, 255)
	color = np.where(blend[..., None], color, cell)
	return alpha, color


def cut(path, names, lines, glow):
	"""The sprites of a sheet: name -> RGBA (floats, 0–255), each cut to what's seen of it"""
	sheet = np.asarray(Image.open(ROOT / path).convert('RGB')).astype(float)
	height, width, _ = sheet.shape
	if lines:
		# The grid lines are a darker magenta
		line = (np.abs(sheet[..., 0] - 190) < 30) & (sheet[..., 1] < 15) & (np.abs(sheet[..., 2] - 212) < 25)
		xs = grid_lines(line, 0, len(names[0]), width)
		ys = grid_lines(line, 1, len(names), height)
		inset = (4, 3)
	else:
		xs = [round(width * k / len(names[0])) for k in range(len(names[0]) + 1)]
		ys = [round(height * k / len(names)) for k in range(len(names) + 1)]
		inset = (2, 2)
	# The background: the sheet's magenta (not a cell's border, which a big tile nearly fills)
	magenta = (sheet[..., 0] > 180) & (sheet[..., 1] < 90) & (sheet[..., 2] > 180)
	bg = np.median(sheet[magenta], axis=0)
	out = {}
	for r, row in enumerate(names):
		for c, name in enumerate(row):
			if not name:
				continue
			x0, x1 = xs[c] + inset[0], xs[c + 1] - inset[1]
			y0, y1 = ys[r] + inset[0], ys[r + 1] - inset[1]
			cell = sheet[y0:y1, x0:x1]
			alpha, color = key(cell, bg, glow)
			if name.startswith('portal'):
				# Only the ring and what touches it (specks around it go)
				labels, count = ndimage.label(ndimage.binary_dilation(alpha > 0.25, iterations=2))
				if count > 1:
					sizes = ndimage.sum(np.ones_like(alpha), labels, range(1, count + 1))
					alpha = np.where(labels == 1 + int(np.argmax(sizes)), alpha, 0)
			# What reaches in from a neighbouring cell (an edge of the sprite next to it) goes:
			# small pieces touching the cell's border
			# (and specks: tiny pieces, and the faint haze away from every real piece)
			labels, count = ndimage.label(ndimage.binary_dilation(alpha > 0.25, iterations=1))
			if count:
				sizes = ndimage.sum(np.ones_like(alpha), labels, range(1, count + 1))
				border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
				kept = [
					k for k in range(1, count + 1)
					if sizes[k - 1] >= sizes.max() * (0.3 if k in border else 0.02)
				]
				near = ndimage.binary_dilation(np.isin(labels, kept), iterations=4)
				alpha = np.where(near, alpha, 0)
			seen = np.argwhere(alpha > 0.06)
			if not len(seen):
				print(f'{path}: nothing in the cell of {name}', file=sys.stderr)
				continue
			(top, left), (bottom, right) = seen.min(0), seen.max(0) + 1
			rgba = np.dstack([color, alpha[..., None] * 255])[top:bottom, left:right]
			out[name] = rgba
	return out


def recolor(rgba, source, target):
	"""A sprite with its hue turned from one colour to another"""
	turn = np.radians((hue(target) - hue(source)) * 360)
	rgb = np.clip(rgba[..., :3] @ hue_rotation(turn).T, 0, 255)
	return np.dstack([rgb, rgba[..., 3:]])


def shrink(rgba):
	"""At most LARGEST pixels each way (with its alpha premultiplied, so no dark fringes)"""
	h, w = rgba.shape[:2]
	f = LARGEST / max(h, w)
	image = Image.fromarray(rgba.round().astype(np.uint8), 'RGBA')
	if f >= 1:
		return image
	size = (max(1, round(w * f)), max(1, round(h * f)))
	return image.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def main():
	sprites = {}
	for path, names, lines, glow in SHEETS:
		sprites.update(cut(path, names, lines, glow))
	for name, (source, target) in RECOLOR.items():
		if source in sprites:
			sprites[name] = recolor(sprites[source], SOURCE_COLOR[source], target)
	images = {name: shrink(rgba) for name, rgba in sprites.items()}
	# Packed in shelves, the tallest first
	order = sorted(images, key=lambda n: -images[n].size[1])
	boxes = {}
	x = y = shelf = 0
	for name in order:
		w, h = images[name].size
		if x + w + GAP > ATLAS_WIDTH:
			x, y, shelf = 0, y + shelf + GAP, 0
		boxes[name] = (x + GAP, y + GAP, w, h)
		x += w + GAP
		shelf = max(shelf, h)
	height = y + shelf + GAP * 2
	atlas = Image.new('RGBA', (ATLAS_WIDTH, height), (0, 0, 0, 0))
	for name, (bx, by, _, _) in boxes.items():
		atlas.paste(images[name], (bx, by))
	atlas.save(OUT_IMAGE, quality=92, alpha_quality=100, method=6)
	# (in the order of the sheets, as they're named there)
	named = [n for _, names, _, _ in SHEETS for row in names for n in row if n and n in boxes]
	named += [n for n in RECOLOR if n in boxes]
	lines = [
		'// Made by scripts/dash-sprites.py from the sprite sheets: where each sprite is in',
		'// sprites.webp (x, y, width, height). Not to be edited by hand.',
		'',
		'export const SPRITES = {',
		# (as prettier writes it: no comma after the last)
		',\n'.join(f'\t{name}: [{", ".join(str(v) for v in boxes[name])}]' for name in named),
		'} as const satisfies Record<string, readonly [number, number, number, number]>;',
		'',
		'export type SpriteName = keyof typeof SPRITES;',
		'',
		'/** How big sprites.webp is */',
		f'export const ATLAS = [{ATLAS_WIDTH}, {height}] as const;',
		'',
	]
	OUT_MAP.write_text('\n'.join(lines), encoding='utf-8')
	print(f'{len(boxes)} sprites -> {OUT_IMAGE.relative_to(ROOT)} ({ATLAS_WIDTH}×{height}), {OUT_MAP.relative_to(ROOT)}')


if __name__ == '__main__':
	main()
