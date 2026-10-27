<script>
	const base = __WEB_BASE__;
	// Home, as the desktop app's (its normal layout, scrolled through): a hello, the song
	// playing (or heard last) big on its background, your playlists, what you heard last (here
	// and in the desktop app), today's mixes, radios, your top songs and beatmaps to discover
	import { untrack } from 'svelte';
	import { playlists } from '../../lib/stores/playlist';
	import { showToast } from '../../lib/stores/toast';
	import { sameSong } from '../../lib/tracks';
	import { play, queue, playing, toggle, slim } from '../player';
	import { recentSongs, topSongs, startRadio, mixes } from '../listening';
	import { webUser } from '../library';
	import { freshToken } from '../shims/auth';
	import { osuApi } from '../shims/http';
	import { handleImageError } from '../shims/data';
	import { offline } from '../../lib/stores/network';
	import Triangles from '../../lib/components/Triangles.svelte';
	import PlayButton from '../../lib/components/PlayButton.svelte';
	import PlaylistCover from '../../lib/components/PlaylistCover.svelte';
	import MixCover from '../../lib/components/MixCover.svelte';
	import SongRow from '../SongRow.svelte';
	import { onMount } from 'svelte';
	import { friendActivity, watchFriends } from '../friends';

	// (how many friends are on, at the friends button)
	onMount(watchFriends);
	let friendsOn = $derived($friendActivity.friends.filter((friend) => friend.online).length);

	const hour = new Date().getHours();
	const greeting =
		hour < 5
			? 'Good night'
			: hour < 12
				? 'Good morning'
				: hour < 18
					? 'Good afternoon'
					: 'Good evening';

	const background = (song) => `https://assets.ppy.sh/beatmaps/${song.id}/covers/cover@2x.jpg`;
	const square = (song) => `https://assets.ppy.sh/beatmaps/${song.id}/covers/list@2x.jpg`;

	let current = $derived($queue.songs[$queue.index] ?? null);
	/** The big one at the top: the song playing, else the one heard last */
	let hero = $derived(
		current
			? { song: current, label: $playing ? 'Now playing' : 'Paused' }
			: $recentSongs[0]
				? { song: $recentSongs[0], label: 'Jump back in' }
				: null
	);
	let heroPlaying = $derived(!!hero && sameSong(current, hero.song) && $playing);

	let showAllTop = $state(false);
	let radioFor = $state(null);
	/** Radios: from the songs heard last, of different artists */
	let radios = $derived.by(() => {
		const artists = new Set();
		return $recentSongs
			.filter((song) => {
				const artist = (song.artist ?? '').toLowerCase();
				if (artists.has(artist)) return false;
				artists.add(artist);
				return true;
			})
			.slice(0, 6);
	});

	async function radio(song) {
		radioFor = song;
		try {
			const found = await startRadio(song);
			if (!found)
				showToast('Found no songs like it in your playlists', 'icon-[mingcute--radio-line]');
		} finally {
			radioFor = null;
		}
	}

	// Beatmaps to discover: osu!'s newest ranked ones (as the desktop app's home)
	let discover = $state([]);
	let discoverCursor = $state('');
	let discovering = $state(false);
	function songOf(set) {
		const maps = [...(set.beatmaps ?? [])].sort(
			(a, b) => Number(b.mode === 'osu') - Number(a.mode === 'osu')
		);
		return slim({ ...set, beatmaps: maps });
	}
	async function loadDiscover(more = false) {
		if (discovering || $offline) return;
		discovering = true;
		try {
			const params = new URLSearchParams({ s: 'ranked' });
			if (more && discoverCursor) params.set('cursor_string', discoverCursor);
			const response = await osuApi(`beatmapsets/search?${params}`, await freshToken());
			if (!response.ok) return;
			const data = await response.json();
			const found = (data.beatmapsets ?? []).map(songOf);
			discover = more ? [...discover, ...found] : found;
			discoverCursor = data.cursor_string ?? '';
		} catch {
			// (shown when there's a connection again)
		} finally {
			discovering = false;
		}
	}
	// (once there's a connection and nothing yet; what loading changes doesn't ask again)
	$effect(() => {
		if (!discover.length && !$offline) untrack(() => loadDiscover());
	});
</script>

{#snippet playOn(playingThis, onclick, label)}
	<button
		aria-label={label}
		class="absolute bottom-2 right-2 size-10 grid place-items-center rounded-full bg-primary-300 text-white shadow-lg shadow-black/40 active:scale-95 transition"
		{onclick}
	>
		<span
			class="{playingThis ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-5"
		></span>
	</button>
{/snippet}

<div class="px-4 pt-5 pb-8 flex flex-col gap-8">
	<div class="flex items-center justify-between gap-4 -mb-3">
		<h1 class="text-3xl font-bold tracking-tight">
			{greeting}{$webUser?.username ? `, ${$webUser.username}` : ''}
		</h1>
		<div class="-mr-2 flex shrink-0">
			<a
				href="{base}/friends"
				aria-label="Friends"
				class="relative size-11 grid place-items-center text-secondary-600"
			>
				<span class="icon-[mingcute--group-2-line] size-7"></span>
				{#if friendsOn}
					<span
						class="absolute top-1.5 right-1.5 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-green-500 text-[10px] font-bold text-black"
						>{friendsOn}</span
					>
				{/if}
			</a>
			<a
				href="{base}/check"
				aria-label="Checks"
				class="size-11 grid place-items-center text-secondary-600"
			>
				<span class="icon-[mingcute--settings-3-line] size-7"></span>
			</a>
		</div>
	</div>

	{#if hero}
		<section class="relative h-56 rounded-xl overflow-hidden">
			{#key hero.song.id}
				<img
					src={background(hero.song)}
					alt=""
					class="absolute inset-0 size-full object-cover"
					onerror={handleImageError}
				/>
			{/key}
			<!-- Keeps the text readable on bright backgrounds -->
			<div class="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/5"></div>
			<Triangles count={10} seed={Number(hero.song.id) || 1} />
			<div class="relative h-full flex flex-col justify-end gap-1.5 p-5">
				<span
					class="w-fit px-2 py-0.5 rounded bg-primary-300 text-[11px] font-bold uppercase tracking-wide"
				>
					{hero.label}
				</span>
				<h2
					class="text-2xl font-extrabold tracking-tight leading-tight line-clamp-2 drop-shadow-lg"
				>
					{hero.song.title}
				</h2>
				<p class="text-white/80 font-medium truncate">
					{hero.song.artist}{hero.song.creator ? ` · mapped by ${hero.song.creator}` : ''}
				</p>
				<div class="mt-2">
					<PlayButton
						size="md"
						playing={heroPlaying}
						label={heroPlaying ? 'Pause' : `Play ${hero.song.title}`}
						onclick={() => (sameSong(current, hero.song) ? toggle() : play($recentSongs, 0))}
					/>
				</div>
			</div>
		</section>
	{/if}

	{#if $playlists.length}
		<div class="grid grid-cols-2 gap-2">
			{#each $playlists.slice(0, 6) as playlist (playlist.id)}
				<a
					href="{base}/playlist/{playlist.id}"
					class="flex items-center gap-2.5 h-14 pr-2 rounded-md overflow-hidden bg-white/[0.06] active:bg-white/[0.12] transition-colors"
				>
					<PlaylistCover {playlist} class="size-14" />
					<span class="flex-1 min-w-0 text-sm font-semibold line-clamp-2 leading-tight"
						>{playlist.title}</span
					>
				</a>
			{/each}
		</div>
	{/if}

	{#if $recentSongs.length}
		<section>
			<h2 class="text-xl font-bold tracking-tight mb-3">Recently played</h2>
			<ul class="-mx-4 px-4 scroll-px-4 flex gap-4 overflow-x-auto snap-x [scrollbar-width:none]">
				{#each $recentSongs as song, i (`${song.id}:${song.track ?? 0}`)}
					{@const playingThis = sameSong(current, song) && $playing}
					<li class="w-36 shrink-0 snap-start min-w-0">
						<div class="relative aspect-square rounded-md overflow-hidden mb-2 bg-secondary-300">
							<img
								src={square(song)}
								alt=""
								loading="lazy"
								class="absolute inset-0 size-full object-cover"
								onerror={handleImageError}
							/>
							{@render playOn(
								playingThis,
								() => (playingThis ? toggle() : play($recentSongs, i)),
								playingThis ? 'Pause' : `Play ${song.title}`
							)}
						</div>
						<p class="font-semibold text-sm truncate {playingThis ? 'text-primary-500' : ''}">
							{song.title}
						</p>
						<p class="text-sm text-secondary-600 truncate">{song.artist}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if $mixes.length}
		<section>
			<h2 class="text-xl font-bold tracking-tight mb-3">Made for you</h2>
			<ul class="-mx-4 px-4 scroll-px-4 flex gap-4 overflow-x-auto snap-x [scrollbar-width:none]">
				{#each $mixes as mix (mix.id)}
					{@const playingThis = $playing && mix.songs.some((song) => sameSong(song, current))}
					<li class="w-36 shrink-0 snap-start min-w-0">
						<div class="relative mb-2">
							<a href="{base}/mix/{mix.id}" class="block" aria-label="Open {mix.title}">
								<MixCover songs={mix.songs} class="aspect-square rounded-md" />
							</a>
							{@render playOn(
								playingThis,
								() => (playingThis ? toggle() : play(mix.songs, 0)),
								playingThis ? 'Pause' : `Play ${mix.title}`
							)}
						</div>
						<a
							href="{base}/mix/{mix.id}"
							class="block font-semibold text-sm truncate {playingThis ? 'text-primary-500' : ''}"
							>{mix.title}</a
						>
						<p class="text-sm text-secondary-600 line-clamp-2">{mix.description}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if radios.length}
		<section>
			<h2 class="text-xl font-bold tracking-tight">Radio</h2>
			<p class="mb-3 text-sm text-secondary-600">Songs like these from your playlists</p>
			<ul class="-mx-4 px-4 scroll-px-4 flex gap-4 overflow-x-auto snap-x [scrollbar-width:none]">
				{#each radios as seed (`${seed.id}:${seed.track ?? 0}`)}
					<li class="w-36 shrink-0 snap-start min-w-0">
						<button
							class="relative block w-full aspect-square rounded-md overflow-hidden mb-2 bg-secondary-300"
							disabled={!!radioFor}
							onclick={() => radio(seed)}
							aria-label="Radio like {seed.title}"
						>
							<img
								src={square(seed)}
								alt=""
								loading="lazy"
								class="absolute inset-0 size-full object-cover"
								onerror={handleImageError}
							/>
							<span
								class="absolute inset-0 bg-gradient-to-t from-primary-200/90 via-primary-200/20 to-transparent"
							></span>
							<span
								class="absolute bottom-2 left-2 {radioFor === seed
									? 'icon-[svg-spinners--ring-resize]'
									: 'icon-[mingcute--radio-fill]'} size-6"
							></span>
						</button>
						<p class="font-semibold text-sm truncate">{seed.artist}</p>
						<p class="text-sm text-secondary-600 truncate">Like {seed.title}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if $topSongs.length}
		<section>
			<div class="mb-2 flex items-center justify-between">
				<div>
					<h2 class="text-xl font-bold tracking-tight">Your top songs</h2>
					<p class="text-sm text-secondary-600">The last 30 days</p>
				</div>
				<PlayButton size="md" label="Play your top songs" onclick={() => play($topSongs, 0)} />
			</div>
			<ol class="-mx-2">
				{#each showAllTop ? $topSongs : $topSongs.slice(0, 5) as top, i (`${top.id}:${top.track ?? 0}`)}
					<SongRow song={top} index={i} onplay={() => play($topSongs, i)} />
				{/each}
			</ol>
			{#if $topSongs.length > 5}
				<button
					class="mt-1 text-sm font-semibold text-secondary-600"
					onclick={() => (showAllTop = !showAllTop)}
				>
					{showAllTop ? 'Show less' : `Show all ${$topSongs.length}`}
				</button>
			{/if}
		</section>
	{/if}

	{#if discover.length}
		<section>
			<div class="mb-2 flex items-center gap-2">
				<h2 class="flex-1 text-xl font-bold tracking-tight">Discover beatmaps</h2>
				{#if discovering}
					<span class="icon-[svg-spinners--ring-resize] size-4 text-primary-400"></span>
				{/if}
			</div>
			<ol class="-mx-2">
				{#each discover as song, i (`${song.id}:${i}`)}
					<SongRow {song} onplay={() => play(discover, i)} />
				{/each}
			</ol>
			{#if discoverCursor}
				<button
					class="mt-2 h-9 px-4 rounded-full bg-white/[0.06] text-sm font-semibold text-secondary-600 disabled:opacity-50"
					disabled={discovering}
					onclick={() => loadDiscover(true)}
				>
					More
				</button>
			{/if}
		</section>
	{/if}

	{#if !hero && !$playlists.length}
		<p class="py-10 text-center text-sm text-secondary-600">
			What you listen to shows up here, also what you hear in the desktop app.
		</p>
	{/if}
</div>
