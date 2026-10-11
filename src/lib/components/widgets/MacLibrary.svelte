<script>
	import Widget from './MacWidget.svelte';
	import { mapDataStore, formatSongData } from '#lib/stores/data.ts';
	import { playlists } from '#lib/stores/playlist.ts';

	let songCount = $derived(formatSongData($mapDataStore).length);
	let playlistCount = $derived($playlists.filter((playlist) => playlist.id != -1 && playlist.id != -2).length);
</script>

<Widget size="small" label="Library" icon="icon-[mingcute--music-2-fill]">
	<div class="mt-auto">
		<p class="text-4xl font-extrabold tabular-nums leading-none">{songCount}</p>
		<p class="text-sm text-white/65">{songCount === 1 ? 'song' : 'songs'} downloaded</p>
		<p class="mt-2 text-sm font-semibold">
			{playlistCount}
			<span class="font-normal text-white/65">{playlistCount === 1 ? 'playlist' : 'playlists'}</span
			>
		</p>
	</div>
</Widget>
