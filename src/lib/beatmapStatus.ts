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
