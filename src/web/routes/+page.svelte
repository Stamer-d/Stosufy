<script>
	const base = __WEB_BASE__;
	// Home, as the desktop app's: the time and a hello on the song's background, widgets for
	// what plays, your playlists, what's next and your library, then today's mixes, what you
	// heard last (here and in the desktop app), radios and your top songs
	import { onMount } from 'svelte';
	import { playlists } from '../../lib/stores/playlist';
	import { showToast } from '../../lib/stores/toast';
	import { play, queue, playing, time, toggle, next, previous, playerOpen } from '../player';
	import { downloadedSongs } from '../downloads';
	import { recentSongs, topSongs, startRadio, mixes } from '../listening';
	import { webUser } from '../library';
	import Widget from '../../lib/components/widgets/MacWidget.svelte';
	import SongCover from '../../lib/components/SongCover.svelte';
	import PlaylistCover from '../../lib/components/PlaylistCover.svelte';
	import MixCover from '../../lib/components/MixCover.svelte';
	import SongRow from '../SongRow.svelte';

	let now = $state(new Date());
	onMount(() => {
		const timer = setInterval(() => (now = new Date()), 1000);
		return () => clearInterval(timer);
	});
	let clock = $derived(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
	let date = $derived(
		now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
	);
	let greeting = $derived.by(() => {
		const hour = now.getHours();
		const part =
			hour < 5
				? 'Good night'
				: hour < 12
					? 'Good morning'
					: hour < 18
						? 'Good afternoon'
						: 'Good evening';
		return $webUser?.username ? `${part}, ${$webUser.username}` : part;
	});

	let song = $derived($queue.songs[$queue.index] ?? null);
	let upNext = $derived($queue.songs[$queue.index + 1] ?? null);
	let progress = $derived($time.duration ? ($time.current / $time.duration) * 100 : 0);

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

<section class="relative px-4 pt-5 pb-2">
	<a
		href="{base}/check"
		aria-label="Checks"
		class="absolute right-2 top-3 size-10 grid place-items-center text-white/60"
	>
		<span class="icon-[mingcute--settings-3-line] size-6"></span>
	</a>
	<p class="text-6xl font-extrabold tracking-tight tabular-nums drop-shadow-lg">{clock}</p>
	<p class="mt-2 font-semibold">{date}</p>
	<p class="text-white/70">{greeting}</p>
</section>

<div class="px-3 pt-4 grid grid-cols-2 gap-3">
	<Widget class="col-span-2">
		{#if song}
			<div class="flex gap-4">
				<button class="shrink-0" aria-label="Open the player" onclick={() => playerOpen.set(true)}>
					{#key song.id}
						<SongCover
							setId={song.id}
							track={song.track}
							title={song.title}
							class="size-28 rounded-2xl shadow-lg shadow-black/30"
						/>
					{/key}
				</button>
				<div class="min-w-0 flex-1 flex flex-col">
					<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">
						{$playing ? 'Now playing' : 'Paused'}
					</p>
					<p class="mt-0.5 font-bold leading-tight line-clamp-2">{song.title}</p>
					<p class="text-sm text-white/65 truncate">{song.artist}</p>
					<div class="mt-auto h-1 rounded-full bg-white/20">
						<div
							class="h-full rounded-full bg-white transition-[width] duration-500 ease-linear"
							style="width: {progress}%"
						></div>
					</div>
					<div class="mt-2 flex items-center justify-between">
						<button
							aria-label="Previous"
							class="size-8 grid place-items-center text-white/80"
							onclick={previous}
						>
							<span class="icon-[mingcute--skip-previous-fill] size-5"></span>
						</button>
						<button
							aria-label={$playing ? 'Pause' : 'Play'}
							class="size-9 grid place-items-center text-white"
							onclick={toggle}
						>
							<span
								class="{$playing
									? 'icon-[mingcute--pause-fill]'
									: 'icon-[mingcute--play-fill]'} size-7"
							></span>
						</button>
						<button
							aria-label="Next"
							class="size-8 grid place-items-center text-white/80"
							onclick={() => next()}
						>
							<span class="icon-[mingcute--skip-forward-fill] size-5"></span>
						</button>
					</div>
				</div>
			</div>
		{:else}
			<div class="flex gap-4 items-center">
				<div class="size-28 shrink-0 rounded-2xl bg-white/10 grid place-items-center">
					<span class="icon-[mingcute--music-2-fill] size-10 text-white/40"></span>
				</div>
				<div>
					<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">Not playing</p>
					<p class="mt-0.5 font-bold">Nothing playing</p>
					<p class="text-sm text-white/65">Pick a song from your playlists.</p>
				</div>
			</div>
		{/if}
	</Widget>

	<Widget label="Playlists" class="col-span-2">
		<div class="grid grid-cols-4 gap-2.5">
			{#each $playlists.slice(0, 4) as playlist (playlist.id)}
				<a href="{base}/playlist/{playlist.id}" class="min-w-0" aria-label="Open {playlist.title}">
					<PlaylistCover {playlist} class="w-full aspect-square rounded-xl" iconClass="size-6" />
					<p class="mt-1.5 text-xs font-semibold truncate">{playlist.title}</p>
				</a>
			{/each}
		</div>
	</Widget>

	<Widget class="aspect-square !p-0">
		{#if upNext}
			<button
				class="relative size-full text-start"
				onclick={() => next()}
				aria-label="Play {upNext.title}"
			>
				<SongCover
					setId={upNext.id}
					track={upNext.track}
					title={upNext.title}
					class="absolute inset-0 size-full"
				/>
				<span class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"
				></span>
				<span class="absolute inset-x-0 bottom-0 p-4">
					<span class="block text-[11px] font-bold uppercase tracking-wide text-primary-500"
						>Up next</span
					>
					<span class="block font-bold leading-tight truncate">{upNext.title}</span>
					<span class="block text-xs text-white/70 truncate">{upNext.artist}</span>
				</span>
			</button>
		{:else}
			<div class="size-full p-4 flex flex-col justify-end">
				<p class="text-[11px] font-bold uppercase tracking-wide text-primary-500">Up next</p>
				<p class="font-bold">Nothing yet</p>
			</div>
		{/if}
	</Widget>

	<Widget label="Library" icon="icon-[mingcute--music-2-fill]" class="aspect-square">
		<a href="{base}/downloads" class="mt-auto">
			<p class="text-4xl font-extrabold">{$downloadedSongs.length}</p>
			<p class="text-sm text-white/65">songs on the phone</p>
			<p class="mt-2 text-sm">
				<span class="font-bold">{$playlists.filter((p) => Number(p.id) > 0).length}</span>
				<span class="text-white/65">playlists</span>
			</p>
		</a>
	</Widget>
</div>

{#snippet heading(title, detail = '')}
	<div class="px-4 mb-3">
		<h2 class="text-xl font-bold">{title}</h2>
		{#if detail}<p class="text-sm text-secondary-600">{detail}</p>{/if}
	</div>
{/snippet}

{#if $mixes.length}
	<section class="mt-8">
		{@render heading('Made for you', 'Your daily mixes')}
		<ul class="flex gap-3 overflow-x-auto px-4 scroll-px-4 pb-1 snap-x [scrollbar-width:none]">
			{#each $mixes as mix (mix.id)}
				<li class="w-36 shrink-0 snap-start">
					<a href="{base}/mix/{mix.id}" class="block active:opacity-70 transition-opacity">
						<MixCover songs={mix.songs} class="size-36 rounded-md shadow-lg shadow-black/30" />
						<span class="mt-2 block text-sm font-semibold truncate">{mix.title}</span>
						<span class="block text-xs text-secondary-600 line-clamp-2">{mix.description}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if $recentSongs.length}
	<section class="mt-8">
		{@render heading('Recently played')}
		<ul class="flex gap-3 overflow-x-auto px-4 scroll-px-4 pb-1 snap-x [scrollbar-width:none]">
			{#each $recentSongs as recent, i (`${recent.id}:${recent.track ?? 0}`)}
				<li class="w-32 shrink-0 snap-start">
					<button
						class="w-full text-start active:opacity-70 transition-opacity"
						onclick={() => play($recentSongs, i)}
					>
						<SongCover
							setId={recent.id}
							track={recent.track}
							title={recent.title}
							class="size-32 rounded-md shadow-lg shadow-black/30"
							lazy
						/>
						<span class="mt-2 block text-sm font-semibold truncate">{recent.title}</span>
						<span class="block text-xs text-secondary-600 truncate">{recent.artist}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if radios.length}
	<section class="mt-8">
		{@render heading('Radio', 'Songs like these from your playlists')}
		<ul class="flex gap-3 overflow-x-auto px-4 scroll-px-4 pb-1 snap-x [scrollbar-width:none]">
			{#each radios as seed (`${seed.id}:${seed.track ?? 0}`)}
				<li class="w-32 shrink-0 snap-start">
					<button
						class="w-full text-start active:opacity-70 transition-opacity"
						disabled={!!radioFor}
						onclick={() => radio(seed)}
					>
						<span class="relative block size-32">
							<SongCover
								setId={seed.id}
								track={seed.track}
								title={seed.title}
								class="size-32 rounded-md shadow-lg shadow-black/30"
								lazy
							/>
							<span
								class="absolute inset-0 rounded-md bg-gradient-to-t from-primary-200/90 via-primary-200/20 to-transparent grid place-items-end p-2"
							>
								<span
									class="{radioFor === seed
										? 'icon-[svg-spinners--ring-resize]'
										: 'icon-[mingcute--radio-fill]'} size-6"
								></span>
							</span>
						</span>
						<span class="mt-2 block text-sm font-semibold truncate">{seed.artist}</span>
						<span class="block text-xs text-secondary-600 truncate">Like {seed.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if $topSongs.length}
	<section class="mt-8 pb-4">
		<div class="px-4 mb-2 flex items-center justify-between">
			<div>
				<h2 class="text-xl font-bold">Your top songs</h2>
				<p class="text-sm text-secondary-600">The last 30 days</p>
			</div>
			<button
				aria-label="Play your top songs"
				class="size-11 grid place-items-center rounded-full bg-primary-300 shadow-lg shadow-black/30"
				onclick={() => play($topSongs, 0)}
			>
				<span class="icon-[mingcute--play-fill] size-5"></span>
			</button>
		</div>
		<ol class="px-2">
			{#each showAllTop ? $topSongs : $topSongs.slice(0, 5) as top, i (`${top.id}:${top.track ?? 0}`)}
				<SongRow song={top} index={i} onplay={() => play($topSongs, i)} />
			{/each}
		</ol>
		{#if $topSongs.length > 5}
			<button
				class="mx-4 mt-1 h-9 px-4 rounded-full bg-white/[0.06] text-sm font-semibold text-secondary-600"
				onclick={() => (showAllTop = !showAllTop)}
			>
				{showAllTop ? 'Show less' : `Show all ${$topSongs.length}`}
			</button>
		{/if}
	</section>
{/if}

{#if !$recentSongs.length}
	<p class="px-8 py-10 text-center text-sm text-secondary-600">
		What you listen to shows up here, also what you hear in the desktop app.
	</p>
{/if}
