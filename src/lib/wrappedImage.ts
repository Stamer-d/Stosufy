// Wrapped as a picture to share (Discord, a story…): the minutes, the top song with its cover,
// the top songs and artists and a few numbers, drawn on a canvas. The covers are read as
// files (or fetched through Tauri), so the canvas can still be saved.

import { get } from 'svelte/store';
import { readFile, writeFile, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import { fetch } from '@tauri-apps/plugin-http';
import * as path from '@tauri-apps/api/path';
import { filesRoot } from './platform';
import { colorFromString, mapDataStore } from './stores/data';
import { trackGroups } from './tracks';
import type { Recap } from './wrapped';
import type { HistorySong } from './stores/history';

const WIDTH = 1080;
const HEIGHT = 1350;
const FONT = '"Figtree Variable", ui-sans-serif, system-ui, sans-serif';

/** A song's cover as an image the canvas may draw (null: none to be had) */
async function coverOf(song: HistorySong): Promise<ImageBitmap | null> {
	try {
		const set = get(mapDataStore)[song.setId];
		const own =
			song.track > 0 && set
				? trackGroups(set)[song.track]?.find((map) => map.background)?.background
				: null;
		const file = own || set?.thumbnail || set?.background;
		if (file) {
			const bytes = await readFile(file, { baseDir: BaseDirectory.Home });
			return await createImageBitmap(new Blob([bytes]));
		}
		if (Number(song.setId) > 0) {
			const response = await fetch(
				`https://assets.ppy.sh/beatmaps/${song.setId}/covers/list@2x.jpg`
			);
			if (response.ok) return await createImageBitmap(await response.blob());
		}
	} catch {
		// (drawn without it)
	}
	return null;
}

export interface WrappedPicture {
	recap: Recap;
	/** "2026", "Last 30 days"… */
	period: string;
	username?: string;
}

/** The picture (a PNG) */
export async function wrappedImage({ recap, period, username }: WrappedPicture): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext('2d')!;
	await Promise.all(
		['400', '600', '800'].map((weight) => document.fonts?.load(`${weight} 40px ${FONT}`))
	).catch(() => {});
	const accent =
		getComputedStyle(document.documentElement).getPropertyValue('--color-primary-300').trim() ||
		'#8b5cf6';

	// The background: the accent fading into the dark, a few triangles like osu!'s
	const background = ctx.createLinearGradient(0, 0, WIDTH * 0.6, HEIGHT);
	background.addColorStop(0, accent);
	background.addColorStop(0.55, '#1a1530');
	background.addColorStop(1, '#0d0d12');
	ctx.fillStyle = background;
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
	ctx.save();
	ctx.globalAlpha = 0.08;
	ctx.fillStyle = '#ffffff';
	for (const [x, y, size] of [
		[880, 120, 220],
		[160, 520, 140],
		[960, 760, 180],
		[620, 60, 90],
		[520, 470, 110]
	]) {
		ctx.beginPath();
		ctx.moveTo(x, y - size / 2);
		ctx.lineTo(x + size / 2, y + size / 2);
		ctx.lineTo(x - size / 2, y + size / 2);
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();

	const text = (
		value: string,
		x: number,
		y: number,
		size: number,
		weight = 600,
		color = '#ffffff',
		maxWidth = WIDTH - 2 * 80
	) => {
		ctx.font = `${weight} ${size}px ${FONT}`;
		ctx.fillStyle = color;
		let shown = value;
		// Too long: cut with an ellipsis
		while (shown.length > 1 && ctx.measureText(shown).width > maxWidth) shown = shown.slice(0, -1);
		if (shown !== value) shown = shown.trimEnd() + '…';
		ctx.fillText(shown, x, y);
	};
	const roundedImage = (
		image: ImageBitmap | null,
		x: number,
		y: number,
		size: number,
		title: string
	) => {
		ctx.save();
		ctx.beginPath();
		ctx.roundRect(x, y, size, size, size * 0.08);
		ctx.clip();
		if (image) {
			// Square from the middle of the picture
			const side = Math.min(image.width, image.height);
			ctx.drawImage(
				image,
				(image.width - side) / 2,
				(image.height - side) / 2,
				side,
				side,
				x,
				y,
				size,
				size
			);
		} else {
			ctx.fillStyle = colorFromString(title);
			ctx.fillRect(x, y, size, size);
		}
		ctx.restore();
	};

	ctx.textBaseline = 'alphabetic';
	text(
		`${username ? `${username}'s ` : ''}Stosufy Wrapped`.toUpperCase(),
		80,
		120,
		30,
		800,
		'rgba(255,255,255,0.75)'
	);
	text(period, 80, 200, 76, 800);

	// The minutes
	text(Math.round(recap.seconds / 60).toLocaleString(), 80, 370, 170, 800);
	text('minutes of music', 84, 425, 38, 600, 'rgba(255,255,255,0.8)');

	// The top song, with its cover
	const top = recap.topSongs[0];
	if (top) {
		const cover = await coverOf(top.song);
		roundedImage(cover, 80, 490, 260, top.song.title);
		text('TOP SONG', 380, 545, 26, 800, 'rgba(255,255,255,0.65)');
		text(top.song.title, 380, 610, 54, 800, '#ffffff', WIDTH - 380 - 80);
		text(top.song.artist, 380, 662, 36, 500, 'rgba(255,255,255,0.8)', WIDTH - 380 - 80);
		text(
			`${top.plays} ${top.plays === 1 ? 'play' : 'plays'}`,
			380,
			720,
			30,
			600,
			'rgba(255,255,255,0.6)'
		);
	}

	// The top songs and artists, side by side
	const column = (title: string, entries: string[], x: number) => {
		text(title.toUpperCase(), x, 840, 26, 800, 'rgba(255,255,255,0.65)', 420);
		entries.slice(0, 5).forEach((entry, i) => {
			text(`${i + 1}`, x, 900 + i * 58, 34, 800, 'rgba(255,255,255,0.45)', 40);
			text(entry, x + 44, 900 + i * 58, 34, 600, '#ffffff', 400);
		});
	};
	column(
		'Top songs',
		recap.topSongs.map(({ song }) => song.title),
		80
	);
	column(
		'Top artists',
		recap.topArtists.map(({ name }) => name),
		580
	);

	// A few numbers, and where it's from
	const numbers: [string, string][] = [
		[recap.plays.toLocaleString(), 'plays'],
		[recap.songs.toLocaleString(), 'songs'],
		[recap.days.toLocaleString(), 'days with music']
	];
	if (recap.streak > 1) numbers.push([String(recap.streak), 'days in a row']);
	numbers.slice(0, 4).forEach(([value, label], i) => {
		const x = 80 + i * 240;
		text(value, x, 1240, 52, 800, '#ffffff', 220);
		text(label, x, 1280, 26, 500, 'rgba(255,255,255,0.65)', 220);
	});

	return new Promise((resolve, reject) =>
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No picture'))), 'image/png')
	);
}

/** Saves the picture in ~/Stosufy/Wrapped; returns where */
export async function saveWrappedImage(picture: Blob, period: string) {
	const dir = await path.join(await filesRoot(), 'Stosufy', 'Wrapped');
	await mkdir(dir, { recursive: true });
	const stamp = new Date().toISOString().slice(0, 10);
	const name = `Wrapped ${period.replace(/[^\w ]+/g, '')} ${stamp}.png`;
	const file = await path.join(dir, name);
	await writeFile(file, new Uint8Array(await picture.arrayBuffer()));
	return file;
}

/** Puts the picture on the clipboard (to paste it into Discord) */
export async function copyWrappedImage(picture: Blob) {
	await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture })]);
}
