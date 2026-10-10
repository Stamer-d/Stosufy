<script>
	import Widget from './Widget.svelte';
	import { user } from '#lib/stores/user.ts';
	import { mapDataStore, formatSongData } from '#lib/stores/data.ts';
	import { playlists } from '#lib/stores/playlist.ts';
	import { currentSong, upNext } from '#lib/stores/audio.ts';

	// A system info panel in the style of neofetch, with Stosufy stats

	let songs = $derived(formatSongData($mapDataStore));

	function mostCommon(values) {
		const counts = new Map();
		for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
	}

	let rows = $derived([
		['songs', `${songs.length} downloaded`],
		['playlists', `${$playlists.filter((p) => p.id != -1).length}`],
		['top artist', mostCommon(songs.map((song) => song.artist))],
		['top mapper', mostCommon(songs.map((song) => song.creator))],
		['playing', $currentSong.song?.title ?? '-'],
		['queue', `${$upNext.length} queued`]
	]);

	const PALETTE = [
		'bg-primary-100',
		'bg-primary-200',
		'bg-primary-300',
		'bg-primary-400',
		'bg-primary-500',
		'bg-lime-400',
		'bg-pink-400',
		'bg-sky-400',
		'bg-amber-400'
	];
</script>

<Widget class="p-5 font-mono text-sm">
	<p>
		<span class="font-bold text-primary-500">{$user?.username?.toLowerCase() ?? 'user'}</span><span
			class="text-white/60">@</span
		><span class="font-bold text-primary-500">stosufy</span>
	</p>
	<p class="text-white/40">{'-'.repeat(($user?.username?.length ?? 4) + 8)}</p>
	<dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
		{#each rows as [key, value] (key)}
			<dt class="font-bold text-primary-500">{key}</dt>
			<dd class="text-white/85 truncate">{value}</dd>
		{/each}
	</dl>
	<div class="mt-3 flex">
		{#each PALETTE as color (color)}
			<span class="size-4 {color}"></span>
		{/each}
	</div>
</Widget>
