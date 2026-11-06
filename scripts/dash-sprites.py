# Cuts the Dash sprite sheet (8 × 9 cells, a transparent background, made with an image AI) into
# the sprites the Dash renderer draws: each sprite (the shapes whose middle is in its cell) goes to
# its own place in src/lib/dash/sprites.webp, its box there to src/lib/dash/sprites.ts.
#   python scripts/dash-sprites.py <sheet.png|webp>
# Needs Pillow, numpy and scipy.

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
	['ship', 'ufo', 'ball', 'wave', 'swing', 'spider', 'robot', 'fxFlame'],
	['tile', 'tileTop', 'tileCorner', 'slab', 'chain', 'slopeUp', 'slopeDown', 'tileOutline'],
	['spike', 'spikeSmall', 'spikeDown', 'spikes3', 'saw', 'sawBig', 'sawHalf', 'thorns'],
	['orbYellow', 'orbPink', 'orbRed', 'orbBlue', 'orbGreen', 'orbBlack', 'orbDash', 'orbSpider'],
	['padYellow', 'padPink', 'padRed', 'padBlue', 'checkpoint', 'fxRing', 'fxSparks', 'fxDebris'],
	['portalCube', 'portalShip', 'portalBall', 'portalUfo', 'portalWave', 'portalRobot',
	 'portalSpider', 'portalSwing'],
	['portalNormal', 'portalUpside', 'portalMini', 'portalBig', 'speed0', 'speed1', 'speed2',
	 'speed3'],
	['speed4', 'play', 'pause', 'bar', 'decoPillar', 'decoFrame', 'decoBeam', None],
]
# What counts as part of a sprite (of 255)
SEEN = 10
# Each sprite's place in the atlas (px), a cell of the same grid
SLOT = 176


def main():
	if len(sys.argv) < 2:
		sys.exit('usage: python scripts/dash-sprites.py <sheet>')
	sheet = np.asarray(Image.open(sys.argv[1]).convert('RGBA'))
	height, width, _ = sheet.shape
	alpha = sheet[..., 3]
	if alpha.min() > 0:
		sys.exit('The sheet has no transparent background')
	columns, rows = len(NAMES[0]), len(NAMES)
	# The shapes on the sheet, each to the cell its middle is in (an image AI doesn't keep to an
	# even grid: a sprite reaches into the next cell now and then, and a few are in pieces)
	labels, count = ndimage.label(alpha > SEEN, structure=np.ones((3, 3)))
	middles = ndimage.center_of_mass(alpha > SEEN, labels, range(1, count + 1))
	cell_of = {}
	for k, (my, mx) in enumerate(middles, start=1):
		c = min(columns - 1, int(mx * columns / width))
		r = min(rows - 1, int(my * rows / height))
		cell_of.setdefault((r, c), []).append(k)
	out = np.zeros((rows * SLOT, columns * SLOT, 4), dtype=np.uint8)
	boxes = {}
	for r, row in enumerate(NAMES):
		for c, name in enumerate(row):
			if not name:
				continue
			mask = np.isin(labels, cell_of.get((r, c), []))
			# (the soft edge around the shapes too: a pixel each way)
			mask = ndimage.binary_dilation(mask, iterations=1) & (alpha > 0)
			seen = np.argwhere(mask)
			if not len(seen):
				sys.exit(f'Nothing in the cell of {name}')
			(top, left), (bottom, right) = seen.min(0), seen.max(0) + 1
			w, h = int(right - left), int(bottom - top)
			if w > SLOT or h > SLOT:
				sys.exit(f'{name} is bigger than a slot: {w} x {h}')
			piece = np.where(mask[top:bottom, left:right, None], sheet[top:bottom, left:right], 0)
			x, y = c * SLOT + (SLOT - w) // 2, r * SLOT + (SLOT - h) // 2
			out[y : y + h, x : x + w] = piece
			boxes[name] = (x, y, w, h)
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
		f'export const ATLAS = [{columns * SLOT}, {rows * SLOT}] as const;',
		'',
	]
	OUT_MAP.write_text('\n'.join(lines), encoding='utf-8')
	print(f'{len(boxes)} sprites -> {OUT_IMAGE.relative_to(ROOT)}, {OUT_MAP.relative_to(ROOT)}')


if __name__ == '__main__':
	main()
