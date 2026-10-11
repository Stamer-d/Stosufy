<script>
	import TerminalWindow from './TerminalWindow.svelte';
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
		['playlists', `${$playlists.filter((p) => p.id != -1 && p.id != -2).length}`],
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

<TerminalWindow title="~ : stosufetch" class="w-80">
	<p class="text-white/50"><span class="text-primary-500">$</span> stosufetch</p>
	<p>
		<span class="font-bold text-primary-500">{$user?.username?.toLowerCase() ?? 'user'}</span><span
			class="text-white/60">@</span
		><span class="font-bold text-primary-500">stosufy</span>
	</p>
	<p class="text-white/40">{'-'.repeat(($user?.username?.length ?? 4) + 8)}</p>
	<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
		{#each rows as [key, value] (key)}
			<dt class="font-bold text-primary-500">{key}</dt>
			<dd class="truncate">{value}</dd>
		{/each}
	</dl>
	<div class="mt-2 flex">
		{#each PALETTE as color (color)}
			<span class="size-3.5 {color}"></span>
		{/each}
	</div>
</TerminalWindow>
