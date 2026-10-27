<script>
	const base = __WEB_BASE__;
	// A beatmap set, as in the desktop app: who made it, how long it is, its difficulties and
	// the songs of a set with several. Play it, like it, keep it on the phone, put it in a
	// playlist. Opened from the player's title or a song's ⋯.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		fetchBeatmapset,
		libraryPool,
		colorFromImage,
		colorFromString
	} from '../../../shims/data';
	import { offline } from '../../../../lib/stores/network';
	import { isFavourite, toggleFavourite } from '../../../../lib/stores/favourites';
	import { songFromSearch } from '../../../../lib/stores/smartPlaylists';
	import { beatmapStatus, difficultyColor } from '../../../../lib/beatmapStatus';
	import { sameSong, songKey } from '../../../../lib/tracks';
	import { queue, playing, play, toggle, slim } from '../../../player';
	import {
		downloaded,
		downloading,
		download,
		removeDownload,
		isDownloaded
	} from '../../../downloads';
	import { songMenu } from '../../../library';
	import PageHeader from '../../../PageHeader.svelte';
	import SongRow from '../../../SongRow.svelte';
	import SongCover from '../../../../lib/components/SongCover.svelte';
	import PlayButton from '../../../../lib/components/PlayButton.svelte';

	let id = $derived(page.params.id);
	/** Which song of a set with several (?track=) */
	let track = $derived(Number(page.url.searchParams.get('track')) || 0);

	// What's known right away (the playing song, one of the playlists'), then osu!'s own data
	let current = $derived($queue.songs[$queue.index] ?? null);
	let local = $derived(
		(current?.id == id && (current.track ?? 0) === track ? current : null) ??
			$libraryPool.find((song) => song.id == id && (song.track ?? 0) === track) ??
			null
	);
	let fetched = $state(null);
	let failed = $state(false);
	$effect(() => {
		const setId = id;
		fetched = null;
		failed = false;
		if ($offline || !(Number(setId) > 0)) return;
		fetchBeatmapset(setId)
			.then((set) => {
				if (setId === id) fetched = set;
			})
			.catch((error) => {
				console.error('Could not load the beatmap set', setId, error);
				if (setId === id) failed = true;
			});
	});

	/** The song to play: the one known already (it may be on the phone), else osu!'s */
	let song = $derived(local ?? (fetched ? slim(songFromSearch(fetched)) : null));
	let info = $derived(fetched ?? local);
	let status = $derived(fetched?.status ? beatmapStatus(fetched.status) : null);
	let difficulties = $derived(
		[...(fetched?.beatmaps ?? [])].sort((a, b) => a.difficulty_rating - b.difficulty_rating)
	);
	let length = $derived(
		Math.max(
			0,
			Number(song?.beatmaps?.[0]?.total_length) || 0,
			...difficulties.map((beatmap) => beatmap.total_length || 0)
		)
	);
	let songSource = $derived(fetched ? fetched.source : local?.songSource);
	/** The other songs of a set with several (the ones the playlists have) */
	let setSongs = $derived(
		$libraryPool.filter((other) => other.id == id && songKey(other) !== (song ? songKey(song) : ''))
	);
	let playingThis = $derived($playing && !!song && sameSong(current, song));
	let kept = $derived(song ? isDownloaded($downloaded, song) : false);
	let busy = $derived(!!song && $downloading.has(String(song.beatmaps?.[0]?.id)));
	let liked = $derived(song ? $isFavourite(song) : false);

	let color = $state(null);
	$effect(() => {
		const setId = id;
		color = colorFromString(String(setId));
		colorFromImage(`https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`)
			.then((found) => {
				if (found && setId === id) color = found;
			})
			.catch(() => {});
	});

	function searchFor(words) {
		goto(`${base}/search?q=${encodeURIComponent(words)}`);
	}

	const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const ACTION = 'size-10 grid place-items-center text-white/60 disabled:opacity-30';
</script>

{#if song}
	<PageHeader
		{color}
		seed={Number(id) || 7}
		label="Beatmap"
		title={song.title}
		back="history"
		onplay={() => (playingThis ? toggle() : play([song], 0))}
	>
		{#snippet cover()}
			<SongCover
				setId={song.id}
				track={song.track}
				title={song.title}
				class="size-48 rounded-md shadow-2xl shadow-black/50"
				large
			/>
		{/snippet}
		{#if status}
			<span
				class="mt-2 inline-block px-1.5 py-0.5 rounded text-[11px] font-bold leading-none {status.badge}"
			>
				{status.label}
			</span>
		{/if}
		<p class="mt-2 text-sm">
			<button class="font-bold" onclick={() => searchFor(song.artist)}>{song.artist}</button>
		</p>
		<p class="mt-1 text-sm text-white/70">
			{#if info?.creator}
				mapped by <button
					class="font-semibold text-white"
					onclick={() => searchFor(`creator=${info.creator}`)}>{info.creator}</button
				>
			{/if}
			{#if length}· {clock(length)}{/if}
			{#if info?.bpm}· {Math.round(info.bpm)} BPM{/if}
		</p>
		{#if songSource && songSource !== 'osu'}
			<p class="mt-1 text-sm text-white/70 truncate">
				From <button class="text-white" onclick={() => searchFor(songSource)}>{songSource}</button>
			</p>
		{/if}
		{#snippet actions()}
			<PlayButton
				playing={playingThis}
				onclick={() => (playingThis ? toggle() : play([song], 0))}
			/>
			<button
				aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
				aria-pressed={liked}
				class="{ACTION} {liked ? 'text-primary-400!' : ''}"
				onclick={() => toggleFavourite(song)}
			>
				<span class="{liked ? 'icon-[mingcute--heart-fill]' : 'icon-[mingcute--heart-line]'} size-7"
				></span>
			</button>
			{#if busy}
				<span class="{ACTION} text-primary-400!" aria-label="Downloading">
					<span class="icon-[svg-spinners--ring-resize] size-6"></span>
				</span>
			{:else if kept}
				<button
					aria-label="Remove from the phone"
					class="{ACTION} text-primary-400!"
					onclick={() => removeDownload(song)}
				>
					<span class="icon-[mingcute--arrow-down-circle-fill] size-7"></span>
				</button>
			{:else}
				<button
					aria-label="Download"
					class={ACTION}
					disabled={$offline}
					onclick={() => download(song).catch(() => {})}
				>
					<span class="icon-[mingcute--download-2-line] size-7"></span>
				</button>
			{/if}
			<button aria-label="More" class="{ACTION} ml-auto" onclick={() => songMenu.set({ song })}>
				<span class="icon-[mingcute--more-2-fill] size-6"></span>
			</button>
		{/snippet}
	</PageHeader>

	{#if setSongs.length}
		<h2 class="px-4 pt-4 pb-1 text-lg font-bold">More songs of this set</h2>
		<ol class="px-2">
			{#each setSongs as other, i (songKey(other))}
				<SongRow song={other} onplay={() => play(setSongs, i)} />
			{/each}
		</ol>
	{/if}

	{#if difficulties.length}
		<h2 class="px-4 pt-4 pb-1 text-lg font-bold">
			{difficulties.length}
			{difficulties.length === 1 ? 'difficulty' : 'difficulties'}
		</h2>
		<ul class="px-2 pb-4">
			{#each difficulties as beatmap (beatmap.id)}
				<li class="flex items-center gap-3 px-3 h-11">
					<span
						class="size-3 shrink-0 rounded-full ring-1 ring-black/30"
						style="background-color: {difficultyColor(beatmap.difficulty_rating)}"
					></span>
					<span class="flex-1 min-w-0 truncate font-semibold">{beatmap.version}</span>
					{#if beatmap.mode && beatmap.mode !== 'osu'}
						<span class="text-xs text-secondary-600">{beatmap.mode}</span>
					{/if}
					<span class="w-16 text-end text-sm text-secondary-600 tabular-nums">
						{beatmap.difficulty_rating?.toFixed(2)}★
					</span>
				</li>
			{/each}
		</ul>
	{:else if !fetched && !$offline && !failed}
		<div class="py-6 grid place-items-center">
			<span class="icon-[svg-spinners--ring-resize] size-6 text-secondary-600"></span>
		</div>
	{/if}

	<div class="px-4 pt-2 pb-6">
		<a
			href="https://osu.ppy.sh/beatmapsets/{id}"
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/[0.06] text-sm font-semibold"
		>
			<span class="icon-[mingcute--external-link-line] size-5"></span>
			Open on osu!
		</a>
	</div>
{:else if failed || $offline}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--music-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">
			{$offline ? "You're offline" : "This beatmap couldn't be loaded"}
		</p>
		<p class="text-secondary-600">
			{$offline
				? 'It shows up again once you are connected.'
				: "It may have been deleted from osu!, or osu! didn't answer."}
		</p>
	</div>
{:else}
	<div class="py-16 grid place-items-center">
		<span class="icon-[svg-spinners--ring-resize] size-10 text-primary-300"></span>
	</div>
{/if}
