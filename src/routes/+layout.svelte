<script>
	import '../app.css';
	import Songbar from '#lib/components/Songbar.svelte';
	import Playlist from '#lib/components/Playlist.svelte';
	import { onMount } from 'svelte';
	import { startBeatEffects } from '#lib/stores/beat.ts';
	import { joinSession } from '#lib/stores/listen.ts';
	import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link';
	import { page } from '$app/state';
	import { startTokenRefresh } from '#lib/stores/auth.ts';
	import Titlebar from '#lib/components/Titlebar.svelte';
	import QueuePanel from '#lib/components/QueuePanel.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import SettingsModal from '#lib/components/SettingsModal.svelte';
	import { queuePanelOpen, currentSong, focusMode } from '#lib/stores/audio.ts';
	import FocusView from '#lib/components/desktop/FocusView.svelte';
	import { userSettings, DEFAULT_APPEARANCE } from '#lib/stores/user.ts';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';

	let { children } = $props();

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
		// Invites to listening sessions: stosufynew://listen/CODE
		const joinFromLink = (urls) => {
			const link = urls?.find((url) => url.includes('listen/'));
			if (link) joinSession(link.split('listen/')[1]);
		};
		onOpenUrl(joinFromLink).catch(() => {});
		getCurrent()
			.then(joinFromLink)
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
			<BeatmapBackground
				setId={$currentSong.song.id}
				mapId={$currentSong.song?.beatmaps?.[0]?.id}
				title={$currentSong.song.title}
				class="absolute inset-0"
				imageClass="blur-2xl scale-110"
				video
				beat
			/>
			<!-- A bit brighter in kiai time, like osu! -->
			<div
				class="absolute inset-0 bg-app"
				style="opacity: calc({appearance.dim / 100} - var(--kiai, 0) * 0.15)"
			></div>
		</div>
	{/if}
	<div class="h-screen flex flex-col {backgroundOn ? '' : 'bg-app'}">
		<Titlebar />

		<div class="flex flex-1 min-h-0 px-2 gap-2">
			<aside class="w-72 shrink-0 rounded-lg {panel} overflow-hidden transition-colors">
				<Playlist />
			</aside>

			<main
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
		</div>

		<Songbar />
	</div>
	{#if $focusMode}
		<FocusView />
	{/if}
	<Toasts />
	<SettingsModal />
{:else}
	<div class="h-screen flex flex-col bg-app">
		<Titlebar />
		<div class="flex-1 min-h-0 overflow-y-auto">
			{@render children()}
		</div>
	</div>
{/if}
