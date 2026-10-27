<script>
	const base = __WEB_BASE__;
	// Home: what you heard last (here and in the desktop app), your top songs, radios from
	// them, and your playlists at hand
	import { playlists } from '../../lib/stores/playlist';
	import { showToast } from '../../lib/stores/toast';
	import { play, coverUrl } from '../player';
	import { downloadedSongs } from '../downloads';
	import { recentSongs, topSongs, startRadio, mixes } from '../listening';
	import Mosaic from '../Mosaic.svelte';
	import SongRow from '../SongRow.svelte';
	import PlaylistCover from '../PlaylistCover.svelte';

	const hour = new Date().getHours();
	const greeting =
		hour < 5
			? 'Good night'
			: hour < 12
				? 'Good morning'
				: hour < 18
					? 'Good afternoon'
					: 'Good evening';

	let shortcuts = $derived($playlists.slice(0, 6));
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
</script>

<header class="px-5 pt-6 pb-4 flex items-center justify-between">
	<h1 class="text-3xl font-extrabold">{greeting}</h1>
	<a
		href="{base}/check"
		aria-label="Checks"
		class="size-10 grid place-items-center text-secondary-600"
	>
		<span class="icon-[mingcute--settings-3-line] size-6"></span>
	</a>
</header>

<div class="px-5 grid grid-cols-2 gap-2">
	{#each shortcuts as playlist (playlist.id)}
		<a
			href="{base}/playlist/{playlist.id}"
			class="h-14 flex items-center gap-2 pr-2 rounded-md bg-white/[0.06] overflow-hidden active:bg-white/10"
		>
			<PlaylistCover {playlist} class="size-14" icon="size-5" />
			<span class="text-sm font-semibold line-clamp-2">{playlist.title}</span>
		</a>
	{/each}
	{#if $downloadedSongs.length}
		<a
			href="{base}/downloads"
			class="h-14 flex items-center gap-2 pr-2 rounded-md bg-white/[0.06] overflow-hidden active:bg-white/10"
		>
			<span class="size-14 shrink-0 grid place-items-center bg-secondary-300">
				<span class="icon-[mingcute--download-2-line] size-5 text-primary-400"></span>
			</span>
			<span class="text-sm font-semibold">Downloads</span>
		</a>
	{/if}
</div>

{#snippet cards(songs, onplay)}
	<ul class="flex gap-3 overflow-x-auto px-5 scroll-px-5 pb-1 snap-x [scrollbar-width:none]">
		{#each songs as song, i (`${song.id}:${song.track ?? 0}`)}
			<li class="w-32 shrink-0 snap-start">
				<button class="w-full text-start" onclick={() => onplay(song, i)}>
					<img
						src={coverUrl(song)}
						alt=""
						loading="lazy"
						class="size-32 rounded-lg object-cover bg-secondary-300"
					/>
					<span class="mt-1.5 block text-sm font-semibold truncate">{song.title}</span>
					<span class="block text-xs text-secondary-600 truncate">{song.artist}</span>
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

{#if $mixes.length}
	<section class="mt-7">
		<h2 class="px-5 mb-2 text-xl font-bold">Made for you</h2>
		<ul class="flex gap-3 overflow-x-auto px-5 scroll-px-5 pb-1 snap-x [scrollbar-width:none]">
			{#each $mixes as mix (mix.id)}
				<li class="w-36 shrink-0 snap-start">
					<a href="{base}/mix/{mix.id}" class="block">
						<Mosaic songs={mix.songs} class="size-36 rounded-lg" />
						<span class="mt-1.5 block text-sm font-semibold truncate">{mix.title}</span>
						<span class="block text-xs text-secondary-600 line-clamp-2">{mix.description}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if $recentSongs.length}
	<section class="mt-7">
		<h2 class="px-5 mb-2 text-xl font-bold">Recently played</h2>
		{@render cards($recentSongs, (_, i) => play($recentSongs, i))}
	</section>
{/if}

{#if radios.length}
	<section class="mt-7">
		<h2 class="px-5 text-xl font-bold">Radio</h2>
		<p class="px-5 mb-2 text-sm text-secondary-600">Songs like these from your playlists</p>
		<ul class="flex gap-3 overflow-x-auto px-5 scroll-px-5 pb-1 snap-x [scrollbar-width:none]">
			{#each radios as song (`${song.id}:${song.track ?? 0}`)}
				<li class="w-32 shrink-0 snap-start">
					<button class="w-full text-start" disabled={!!radioFor} onclick={() => radio(song)}>
						<span class="relative block size-32">
							<img
								src={coverUrl(song)}
								alt=""
								loading="lazy"
								class="size-32 rounded-lg object-cover bg-secondary-300"
							/>
							<span
								class="absolute inset-0 rounded-lg bg-gradient-to-t from-primary-700/90 to-transparent grid place-items-end p-2"
							>
								<span
									class="{radioFor === song
										? 'icon-[svg-spinners--ring-resize]'
										: 'icon-[mingcute--radio-line]'} size-6"
								></span>
							</span>
						</span>
						<span class="mt-1.5 block text-sm font-semibold truncate">{song.artist}</span>
						<span class="block text-xs text-secondary-600 truncate">Like {song.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if $topSongs.length}
	<section class="mt-7">
		<div class="px-5 mb-1 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-bold">Your top songs</h2>
				<p class="text-sm text-secondary-600">The last 30 days</p>
			</div>
			<button
				aria-label="Play your top songs"
				class="size-11 grid place-items-center rounded-full bg-primary-300"
				onclick={() => play($topSongs, 0)}
			>
				<span class="icon-[mingcute--play-fill] size-6"></span>
			</button>
		</div>
		<ol class="px-3">
			{#each showAllTop ? $topSongs : $topSongs.slice(0, 5) as song, i (`${song.id}:${song.track ?? 0}`)}
				<SongRow {song} onplay={() => play($topSongs, i)} />
			{/each}
		</ol>
		{#if $topSongs.length > 5}
			<button
				class="px-5 py-2 text-sm font-semibold text-secondary-600"
				onclick={() => (showAllTop = !showAllTop)}
			>
				{showAllTop ? 'Show less' : `Show all ${$topSongs.length}`}
			</button>
		{/if}
	</section>
{/if}

{#if !$recentSongs.length}
	<p class="px-8 pt-10 text-center text-sm text-secondary-600">
		What you listen to shows up here, also what you hear in the desktop app.
	</p>
{/if}
