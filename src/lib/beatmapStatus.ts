/** Colors of the osu! beatmap statuses, shared by the cards and the status filter */
export const BEATMAP_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
	ranked: { label: 'Ranked', dot: 'bg-lime-400', badge: 'bg-lime-400 text-lime-950' },
	approved: { label: 'Approved', dot: 'bg-lime-400', badge: 'bg-lime-400 text-lime-950' },
	loved: { label: 'Loved', dot: 'bg-pink-400', badge: 'bg-pink-400 text-pink-950' },
	qualified: { label: 'Qualified', dot: 'bg-sky-400', badge: 'bg-sky-400 text-sky-950' },
	pending: { label: 'Pending', dot: 'bg-amber-400', badge: 'bg-amber-400 text-amber-950' },
	wip: { label: 'WIP', dot: 'bg-orange-400', badge: 'bg-orange-400 text-orange-950' },
	graveyard: { label: 'Graveyard', dot: 'bg-zinc-500', badge: 'bg-zinc-500 text-zinc-950' }
};

export function beatmapStatus(status: string) {
	return (
		BEATMAP_STATUS[status] ?? {
			label: status,
			dot: 'bg-zinc-500',
			badge: 'bg-zinc-500 text-zinc-950'
		}
	);
}

// osu!'s star rating color spectrum
const DIFFICULTY_SPECTRUM: [number, [number, number, number]][] = [
	[0.1, [66, 144, 251]],
	[1.25, [79, 192, 255]],
	[2, [79, 255, 213]],
	[2.5, [124, 255, 79]],
	[3.3, [246, 240, 92]],
	[4.2, [255, 128, 104]],
	[4.9, [255, 78, 111]],
	[5.8, [198, 69, 184]],
	[6.7, [101, 99, 222]],
	[7.7, [24, 21, 142]],
	[9, [0, 0, 0]]
];

/** Color of a star rating, as osu! shows it */
export function difficultyColor(stars: number) {
	if (stars <= DIFFICULTY_SPECTRUM[0][0]) return 'rgb(170 170 170)';
	for (let i = 1; i < DIFFICULTY_SPECTRUM.length; i++) {
		const [to, toColor] = DIFFICULTY_SPECTRUM[i];
		if (stars <= to) {
			const [from, fromColor] = DIFFICULTY_SPECTRUM[i - 1];
			const t = (stars - from) / (to - from);
			const [r, g, b] = fromColor.map((c, j) => Math.round(c + (toColor[j] - c) * t));
			return `rgb(${r} ${g} ${b})`;
		}
	}
	return 'rgb(0 0 0)';
}
