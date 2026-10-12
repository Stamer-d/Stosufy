<script>
	import '../app.css';
	import Songbar from '#lib/components/Songbar.svelte';
	import Playlist from '#lib/components/Playlist.svelte';
	import { onMount } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import { offline } from '#lib/stores/network.ts';
	import { startBeatEffects } from '#lib/stores/beat.ts';
	import { joinSession } from '#lib/stores/listen.ts';
	import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
	import { page } from '$app/state';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import { startTokenRefresh } from '#lib/stores/auth.ts';
	import Titlebar from '#lib/components/Titlebar.svelte';
	import QueuePanel from '#lib/components/QueuePanel.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import SettingsModal from '#lib/components/SettingsModal.svelte';
	import OsuProfileImport from '#lib/components/OsuProfileImport.svelte';
	import FriendsPanel from '#lib/components/FriendsPanel.svelte';
	import { friendsPanelOpen, goOffline } from '#lib/stores/friends.ts';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { startKeybinds } from '#lib/stores/keybinds.ts';
	import { startSettingsSync } from '#lib/stores/settingsSync.ts';
	import { startHitsounds } from '#lib/hitsounds/player.ts';
	import { queuePanelOpen, currentSong, focusMode } from '#lib/stores/audio.ts';
	import { playingLive } from '#lib/gameplay/play.ts';
	import PlayOverlay from '#lib/components/PlayOverlay.svelte';
	import DjView from '#lib/components/dj/DjView.svelte';
	import { djOpen } from '#lib/dj/engine.ts';
	import FocusView from '#lib/components/desktop/FocusView.svelte';
	import { userSettings, DEFAULT_APPEARANCE } from '#lib/stores/user.ts';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';

	let { children } = $props();

	// The pages scroll in one container: each page keeps where it was scrolled to (back and
	// forward come back there), a new page starts at the top. Without this, a page opened
	// after the lyrics (which scroll along) showed up somewhere in the middle.
	let scroller = $state();
	const scrolled = new Map();
	beforeNavigate(({ from }) => {
		if (from && scroller) scrolled.set(from.url.pathname + from.url.search, scroller.scrollTop);
	});
	afterNavigate(({ from, to, type }) => {
		if (!scroller || !to) return;
		const restore = type === 'popstate' ? scrolled.get(to.url.pathname + to.url.search) : 0;
		// Only a new page, not a change of the same page's address (like a search)
		if (type !== 'popstate' && from?.url.pathname === to.url.pathname) return;
		requestAnimationFrame(() => {
			if (scroller) scroller.scrollTop = restore ?? 0;
		});
	});

	// While a full-screen view (playing, focus, DJ) covers the page, the page keeps where it
	// was scrolled to: nothing behind it may move it, and it's put back when the view closes
	let covered = $derived($playingLive || $focusMode || $djOpen);
	let keptScroll = null;
	$effect(() => {
		const el = scroller;
		if (!el) return;
		if (covered) {
			keptScroll = el.scrollTop;
			const hold = () => {
				if (keptScroll !== null && el.scrollTop !== keptScroll) el.scrollTop = keptScroll;
			};
			el.addEventListener('scroll', hold);
			return () => {
				el.removeEventListener('scroll', hold);
				const top = keptScroll;
				// Once the page is laid out again
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						if (top !== null) el.scrollTop = top;
						keptScroll = null;
					})
				);
			};
		}
	});

	let showUI = $state(false);

	let appearance = $derived({ ...DEFAULT_APPEARANCE, ...$userSettings.settings?.appearance });
	let backgroundOn = $derived(appearance.background && !!$currentSong.song);
	let panel = $derived(backgroundOn ? 'bg-panel/80' : 'bg-panel');

	$effect(() => {
		document.documentElement.dataset.accent = appearance.accent;
	});

	// Update showUI based on current URL
	function updateShowUI() {
		const url = window.location.href;
		const path = window.location.pathname;

		// Don't show UI on login, callback, or root path
		showUI = !url.includes('login') && !url.includes('callback') && path !== '/' && path !== '';
	}

	onMount(async () => {
		startBeatEffects();
		startKeybinds();
		startSettingsSync();
		startHitsounds();
		// Invites to listening sessions: stosufynew://listen/CODE
		const joinFromLink = (urls) => {
			const link = urls?.find((url) => url.includes('listen/'));
			if (link) joinSession(link.split('listen/')[1]);
		};
		onOpenUrl(joinFromLink).catch(() => {});
		getCurrent()
			.then(joinFromLink)
			.catch(() => {});
		// Friends see you go offline right away instead of after a few minutes
		getCurrentWindow()
			.onCloseRequested(() => goOffline())
			.catch(() => {});
		await startTokenRefresh();
		updateShowUI();
	});

	// Update when the page changes
	$effect(() => {
		if (page.url) {
			updateShowUI();
		}
	});
</script>

{#if showUI}
	{#if backgroundOn}
		<!-- Background of the current song behind the app, dimmed like osu!'s background dim -->
		<div class="fixed inset-0 -z-10 bg-app">
			<!-- Drawn at a quarter of the size and scaled up: it's blurred anyway, and blurring a
			     playing video over the whole window every frame made the app stutter -->
			<div class="absolute top-0 left-0 w-1/4 h-1/4 origin-top-left scale-400">
				<BeatmapBackground
					setId={$currentSong.song.id}
					mapId={$currentSong.song?.beatmaps?.[0]?.id}
					title={$currentSong.song.title}
					class="absolute inset-0"
					imageClass="blur-[10px] scale-110"
					video
					beat
				/>
			</div>
			<!-- A bit brighter in kiai time, like osu! -->
			<div
				class="absolute inset-0 bg-app"
				style="opacity: calc({appearance.dim / 100} - var(--kiai, 0) * 0.15)"
			></div>
		</div>
	{/if}
	<div class="h-screen flex flex-col {backgroundOn ? '' : 'bg-app'}">
		<Titlebar />
		{#if $offline}
			<div
				class="mx-2 mb-2 flex items-center gap-2.5 px-4 h-9 shrink-0 rounded-lg bg-amber-400/10 ring-1 ring-amber-300/20 text-sm text-amber-100"
				transition:slide={{ duration: 200 }}
			>
				<span class="icon-[mingcute--wifi-off-line] size-4 text-amber-300"></span>
				<span class="font-semibold">You're offline.</span>
				<span class="text-amber-100/70 truncate"
					>Your downloaded songs and playlists still play; the rest comes back with the connection.</span
				>
			</div>
		{/if}

		<div class="flex flex-1 min-h-0 px-2 gap-2">
			<aside class="w-72 shrink-0 rounded-lg {panel} overflow-hidden transition-colors">
				<Playlist />
			</aside>

			<main
				bind:this={scroller}
				class="flex-1 min-w-0 rounded-lg {panel} overflow-y-auto transition-colors"
				data-scroll-container
			>
				{@render children()}
			</main>

			<!-- The width animates, so the content next to it shrinks smoothly instead of jumping -->
			<div
				class="shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out {$queuePanelOpen
					? 'w-80'
					: 'w-0 -ml-2'}"
				inert={!$queuePanelOpen}
			>
				<div class="w-80 h-full rounded-lg {panel} overflow-hidden transition-colors">
					<QueuePanel />
				</div>
			</div>
			<div
				class="shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out {$friendsPanelOpen
					? 'w-80'
					: 'w-0 -ml-2'}"
				inert={!$friendsPanelOpen}
			>
				<div class="w-80 h-full rounded-lg {panel} overflow-hidden transition-colors">
					<FriendsPanel />
				</div>
			</div>
		</div>

		<Songbar />
	</div>
	{#if $focusMode}
		<FocusView />
	{/if}
	{#if $playingLive}
		<PlayOverlay />
	{/if}
	{#if $djOpen}
		<DjView />
	{/if}
	<!-- Over the full-screen views (DJ, focus, playing) the friends panel floats on top -->
	{#if $friendsPanelOpen && ($djOpen || $focusMode || $playingLive)}
		<div
			class="fixed right-2 top-12 bottom-2 z-50 w-80 rounded-lg bg-secondary-100/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl overflow-hidden"
			transition:fly={{ x: 24, duration: 200 }}
		>
			<FriendsPanel />
		</div>
	{/if}
	<Toasts />
	<SettingsModal />
	<OsuProfileImport />
{:else}
	<div class="h-screen flex flex-col bg-app">
		<Titlebar />
		<div class="flex-1 min-h-0 overflow-y-auto">
			{@render children()}
		</div>
	</div>
{/if}
