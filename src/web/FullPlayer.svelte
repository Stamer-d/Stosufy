<script>
	const base = __WEB_BASE__;
	// The player on the whole screen: the cover (or the lyrics, or what comes next), where
	// the song is, shuffle and repeat, the sleep timer. Swipe it down to close it, swipe the
	// cover for the next song or the one before.
	import {
		queue,
		playing,
		time,
		previewOnly,
		shuffle,
		repeat,
		playerOpen,
		toggle,
		next,
		previous,
		jumpTo,
		removeFromQueue,
		toggleShuffle,
		cycleRepeat,
		bigCoverUrl,
		coverUrl,
		sleepTimer,
		autoplay,
		toggleAutoplay
	} from './player';
	import { haptic } from './haptics';
	import Lyrics from './Lyrics.svelte';
	import Scrubber from './Scrubber.svelte';
	import Triangles from '../lib/components/Triangles.svelte';
	import SongSwipe from './SongSwipe.svelte';
	import SongBackdrop from './SongBackdrop.svelte';
	import { handleImageError } from './shims/data';
	import { songMenu } from './library';
	import { swipe } from './gestures';
	import { fade, fly } from 'svelte/transition';
	import { MODS, setMod, hitsoundStatus } from './hitsounds';
	import { userSettings, updateUserSettings } from './shims/user';
	import { showToast } from '../lib/stores/toast';
	import { isFavourite, toggleFavourite } from '../lib/stores/favourites';

	let song = $derived($queue.songs[$queue.index] ?? null);
	let upNext = $derived(
		$queue.songs.slice($queue.index + 1, $queue.index + 51).map((s, i) => ({
			song: s,
			at: $queue.index + 1 + i
		}))
	);
	/** What's in the middle: the cover, the lyrics or what comes next */
	let view = $state('cover');
	const toggleView = (which) => (view = view === which ? 'cover' : which);

	// The sleep timer: what's left of it, looked at every 15 s
	let choosingSleep = $state(false);
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});
	let sleepLabel = $derived(
		!$sleepTimer
			? ''
			: 'endOfSong' in $sleepTimer
				? 'End of song'
				: `${Math.max(1, Math.ceil(($sleepTimer.at - now) / 60_000))} min`
	);
	const SLEEP_MINUTES = [15, 30, 45, 60, 90];
	function setSleep(minutes) {
		choosingSleep = false;
		now = Date.now();
		sleepTimer.set(
			minutes === 'song'
				? { endOfSong: true }
				: minutes
					? { at: Date.now() + minutes * 60_000 }
					: null
		);
	}
	const close = () => playerOpen.set(false);

	// Speed mods and hitsounds (the account's settings, as in the desktop app)
	const MOD_COLOR = {
		HT: 'oklch(0.85 0.17 135)',
		DC: 'oklch(0.85 0.17 135)',
		DT: 'oklch(0.7 0.19 20)',
		NC: 'oklch(0.7 0.19 20)'
	};
	let choosingMods = $state(false);
	let mod = $derived($userSettings.settings?.mod ?? 'NM');
	let beatOn = $derived($userSettings.settings?.nightcoreBeat ?? true);
	let hitsoundsOn = $derived($userSettings.settings?.hitsounds ?? false);
	let hitsoundVolume = $derived($userSettings.settings?.hitsoundVolume ?? 0.8);
	function toggleHitsounds() {
		haptic();
		const on = !hitsoundsOn;
		updateUserSettings({ hitsounds: on });
		showToast(on ? 'Hitsounds on' : 'Hitsounds off', 'icon-[mingcute--drum-line]');
	}

	$effect(() => {
		if (!song) close();
	});
</script>

{#snippet toggleRow(label, detail, on, onclick)}
	<button
		class="w-full px-5 pt-4 flex items-center justify-between gap-4 text-start"
		role="switch"
		aria-checked={on}
		onclick={() => {
			haptic();
			onclick();
		}}
	>
		<span>
			<span class="block font-semibold">{label}</span>
			<span class="block text-sm text-white/60">{detail}</span>
		</span>
		<span
			class="relative w-11 h-6 shrink-0 rounded-full transition {on
				? 'bg-primary-400'
				: 'bg-white/20'}"
		>
			<span
				class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {on
					? 'translate-x-5'
					: ''}"
			></span>
		</span>
	</button>
{/snippet}

{#if $playerOpen && song}
	<!-- (swiped down, it closes) -->
	<div
		class="fixed inset-0 z-30 flex flex-col bg-app pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1rem)]"
		transition:fly={{ y: 900, duration: 280, opacity: 1 }}
		use:swipe={{ axis: 'y', only: 1, onswipe: close }}
	>
		<!-- The song's background, dimmed like the desktop app's, with osu!'s triangles -->
		<SongBackdrop {song} dim={0.7} />
		<Triangles count={14} seed={Number(song.id) || 3} />
		<div class="relative flex items-center justify-between px-3 py-2">
			<button aria-label="Close" class="size-11 grid place-items-center" onclick={close}>
				<span class="icon-[mingcute--down-line] size-7"></span>
			</button>
			<p class="text-xs font-bold uppercase tracking-wide text-white/70">
				{view === 'queue' ? 'Up next' : view === 'lyrics' ? 'Lyrics' : 'Playing'}
			</p>
			<button
				aria-label="More"
				class="size-11 grid place-items-center"
				onclick={() => songMenu.set({ song })}
			>
				<span class="icon-[mingcute--more-2-fill] size-6"></span>
			</button>
		</div>

		<div class="relative flex-1 min-h-0 px-6 flex flex-col">
			{#if view === 'lyrics'}
				<Lyrics />
			{:else if view === 'queue'}
				<button
					class="-mx-1 mb-1 px-1 py-2 flex items-center justify-between text-start"
					role="switch"
					aria-checked={$autoplay}
					onclick={toggleAutoplay}
				>
					<span>
						<span class="block text-sm font-semibold">Autoplay</span>
						<span class="block text-xs text-white/60">Songs like these play on at the end</span>
					</span>
					<span
						class="relative w-11 h-6 shrink-0 rounded-full transition {$autoplay
							? 'bg-primary-400'
							: 'bg-white/20'}"
					>
						<span
							class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {$autoplay
								? 'translate-x-5'
								: ''}"
						></span>
					</span>
				</button>
				<ol class="flex-1 overflow-y-auto overscroll-contain -mx-3" data-no-swipe>
					{#each upNext as { song: upcoming, at } (at)}
						<li class="flex items-center">
							<button
								class="min-w-0 flex-1 flex items-center gap-3 p-2 text-start rounded-lg active:bg-white/5"
								onclick={() => jumpTo(at)}
							>
								<img
									src={coverUrl(upcoming)}
									alt=""
									loading="lazy"
									class="size-10 rounded object-cover bg-secondary-300"
								/>
								<span class="min-w-0">
									<span class="block truncate font-semibold">{upcoming.title}</span>
									<span class="block truncate text-sm text-white/60">{upcoming.artist}</span>
								</span>
							</button>
							<button
								aria-label="Take {upcoming.title} out of the queue"
								class="size-10 grid place-items-center text-white/60"
								onclick={() => removeFromQueue(at)}
							>
								<span class="icon-[mingcute--close-line] size-5"></span>
							</button>
						</li>
					{:else}
						<li class="p-4 text-sm text-white/60">Nothing after this song</li>
					{/each}
				</ol>
			{:else}
				<div class="flex-1 min-h-0 flex items-center">
					<SongSwipe class="w-full">
						{#snippet item(shown)}
							<div class="px-1">
								<img
									src={bigCoverUrl(shown)}
									alt=""
									decoding="async"
									class="mx-auto w-full aspect-square object-cover rounded-xl shadow-2xl shadow-black/50 bg-secondary-300 bg-cover bg-center"
									style="max-width: min(100%, 46dvh); background-image: url({coverUrl(shown)})"
									onerror={handleImageError}
								/>
							</div>
						{/snippet}
					</SongSwipe>
				</div>
			{/if}

			<div class="mt-6 flex items-center gap-3">
				<div class="min-w-0 flex-1">
					<a
						class="block text-xl font-bold truncate"
						href="{base}/map/{song.id}{song.track ? `?track=${song.track}` : ''}"
						onclick={close}>{song.title}</a
					>
					<p class="text-white/60 truncate">
						{song.artist}{$previewOnly ? ' · preview' : ''}
					</p>
				</div>
				<button
					aria-label={$isFavourite(song) ? 'Unlike' : 'Like'}
					class="size-11 grid place-items-center"
					onclick={() => {
						haptic();
						toggleFavourite(song);
					}}
				>
					<span
						class="{$isFavourite(song)
							? 'icon-[mingcute--heart-fill] text-primary-400'
							: 'icon-[mingcute--heart-line]'} size-7"
					></span>
				</button>
			</div>

			<!-- Where the song is: touch anywhere on the line and drag -->
			<div class="mt-4">
				<Scrubber />
			</div>

			<div class="mt-3 flex items-center justify-between">
				<button
					aria-label="Shuffle"
					aria-pressed={$shuffle}
					class="size-12 grid place-items-center {$shuffle ? 'text-primary-400' : 'text-white/70'}"
					onclick={() => {
						haptic();
						toggleShuffle();
					}}
				>
					<span class="icon-[mingcute--shuffle-2-line] size-6"></span>
				</button>
				<button
					aria-label="Back"
					class="size-14 grid place-items-center"
					onclick={() => {
						haptic();
						previous();
					}}
				>
					<span class="icon-[mingcute--skip-previous-fill] size-9"></span>
				</button>
				<button
					aria-label={$playing ? 'Pause' : 'Play'}
					class="size-18 grid place-items-center rounded-full bg-white text-black"
					onclick={() => {
						haptic('medium');
						toggle();
					}}
				>
					<span
						class="{$playing ? 'icon-[mingcute--pause-fill]' : 'icon-[mingcute--play-fill]'} size-9"
					></span>
				</button>
				<button
					aria-label="Next"
					class="size-14 grid place-items-center"
					onclick={() => {
						haptic();
						next();
					}}
				>
					<span class="icon-[mingcute--skip-forward-fill] size-9"></span>
				</button>
				<button
					aria-label="Repeat: {$repeat}"
					class="size-12 grid place-items-center {$repeat !== 'off'
						? 'text-primary-400'
						: 'text-white/70'}"
					onclick={() => {
						haptic();
						cycleRepeat();
					}}
				>
					<span
						class="{$repeat === 'one'
							? 'icon-[mingcute--repeat-one-line]'
							: 'icon-[mingcute--repeat-line]'} size-6"
					></span>
				</button>
			</div>

			<div class="relative mt-2 flex justify-between">
				<button
					aria-label="Sleep timer"
					class="h-11 px-2 flex items-center gap-1.5 text-sm {$sleepTimer
						? 'text-primary-400'
						: 'text-white/70'}"
					onclick={() => (choosingSleep = !choosingSleep)}
				>
					<span class="icon-[mingcute--moon-line] size-6"></span>
					{sleepLabel}
				</button>
				{#if choosingSleep}
					<div
						class="absolute bottom-12 left-0 z-10 w-48 py-1 rounded-xl bg-secondary-300 shadow-2xl ring-1 ring-white/10"
					>
						{#each SLEEP_MINUTES as minutes (minutes)}
							<button
								class="w-full px-4 py-2.5 text-start active:bg-white/5"
								onclick={() => setSleep(minutes)}
							>
								In {minutes} minutes
							</button>
						{/each}
						<button
							class="w-full px-4 py-2.5 text-start active:bg-white/5"
							onclick={() => setSleep('song')}
						>
							At the end of the song
						</button>
						{#if $sleepTimer}
							<button
								class="w-full px-4 py-2.5 text-start text-red-400 active:bg-white/5"
								onclick={() => setSleep(null)}
							>
								Turn off
							</button>
						{/if}
					</div>
				{/if}
				<div class="flex">
					<button
						aria-label={mod === 'NM' ? 'Speed mods' : `Speed mod: ${MODS[mod].name}`}
						class="h-11 min-w-11 px-1 grid place-items-center {mod === 'NM' ? 'text-white/70' : ''}"
						onclick={() => (choosingMods = true)}
					>
						{#if mod === 'NM'}
							<span class="icon-[mingcute--dashboard-3-line] size-6"></span>
						{:else}
							<span
								class="px-1.5 py-0.5 rounded-md text-xs font-black tracking-wide text-black"
								style="background-color: {MOD_COLOR[mod]}"
							>
								{mod}
							</span>
						{/if}
					</button>
					<button
						aria-label="Hitsounds"
						aria-pressed={hitsoundsOn}
						class="size-11 grid place-items-center {hitsoundsOn
							? 'text-primary-400'
							: 'text-white/70'}"
						onclick={toggleHitsounds}
					>
						<span
							class="{$hitsoundStatus === 'loading' && hitsoundsOn
								? 'icon-[svg-spinners--ring-resize]'
								: 'icon-[mingcute--drum-line]'} size-6"
						></span>
					</button>
					<button
						aria-label="Lyrics"
						aria-pressed={view === 'lyrics'}
						class="size-11 grid place-items-center {view === 'lyrics'
							? 'text-primary-400'
							: 'text-white/70'}"
						onclick={() => toggleView('lyrics')}
					>
						<span class="icon-[mingcute--mic-line] size-6"></span>
					</button>
					<button
						aria-label="Up next"
						aria-pressed={view === 'queue'}
						class="size-11 grid place-items-center {view === 'queue'
							? 'text-primary-400'
							: 'text-white/70'}"
						onclick={() => toggleView('queue')}
					>
						<span class="icon-[mingcute--playlist-line] size-6"></span>
					</button>
				</div>
			</div>
		</div>
		{#if choosingMods}
			<div class="fixed inset-0 z-40 flex flex-col justify-end" data-no-swipe>
				<button
					class="absolute inset-0 bg-black/60"
					aria-label="Close"
					onclick={() => (choosingMods = false)}
					transition:fade={{ duration: 150 }}
				></button>
				<div
					class="relative rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
					transition:fly={{ y: 400, duration: 220, opacity: 1 }}
				>
					<div class="pt-2 flex justify-center">
						<span class="w-10 h-1 rounded-full bg-white/20"></span>
					</div>
					<p class="px-5 pt-3 text-lg font-bold">Speed</p>
					<div class="px-4 pt-3 grid grid-cols-5 gap-2">
						{#each ['NM', 'HT', 'DC', 'DT', 'NC'] as option (option)}
							<button
								class="h-16 flex flex-col items-center justify-center gap-1 rounded-xl ring-1 transition {mod ===
								option
									? 'ring-2 ring-white bg-white/10'
									: 'ring-white/10 bg-white/[0.04]'}"
								aria-pressed={mod === option}
								onclick={() => {
									haptic();
									setMod(option);
								}}
							>
								<span
									class="px-1.5 py-0.5 rounded-md text-xs font-black tracking-wide {option === 'NM'
										? 'bg-white/15'
										: 'text-black'}"
									style={option === 'NM' ? '' : `background-color: ${MOD_COLOR[option]}`}
								>
									{option}
								</span>
								<span class="text-[11px] text-white/60">{MODS[option].rate}×</span>
							</button>
						{/each}
					</div>
					<p class="px-5 pt-2 text-sm text-white/60">
						{mod === 'NM' ? 'As the song is.' : `${MODS[mod].name}: ${MODS[mod].description}`}
					</p>
					{#if mod === 'NC'}
						{@render toggleRow('Nightcore beat', 'Its drums, on the beat of the song', beatOn, () =>
							updateUserSettings({ nightcoreBeat: !beatOn })
						)}
					{/if}

					<p class="px-5 pt-5 text-lg font-bold">Hitsounds</p>
					{@render toggleRow(
						'Play the hitsounds',
						$hitsoundStatus === 'unavailable' && hitsoundsOn
							? "This song's beatmap couldn't be loaded"
							: 'Like watching osu! autoplay',
						hitsoundsOn,
						toggleHitsounds
					)}
					<label class="px-5 pt-3 flex items-center gap-4 {hitsoundsOn ? '' : 'opacity-40'}">
						<span class="icon-[mingcute--volume-line] size-5 text-white/60"></span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={hitsoundVolume}
							disabled={!hitsoundsOn}
							onchange={(e) =>
								updateUserSettings({ hitsoundVolume: Number(e.currentTarget.value) })}
							class="flex-1 accent-[var(--color-primary-400)]"
							aria-label="Hitsound volume"
						/>
					</label>
					<p class="px-5 pt-3 text-xs text-white/50">
						The same as in the desktop app. With the screen locked, only the music plays on.
					</p>
				</div>
			</div>
		{/if}
	</div>
{/if}
