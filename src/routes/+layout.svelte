<script>
	import '../app.css';
	import Songbar from '#lib/components/Songbar.svelte';
	import Playlist from '#lib/components/Playlist.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { startTokenRefresh } from '#lib/stores/auth.ts';
	import Titlebar from '#lib/components/Titlebar.svelte';
	import QueuePanel from '#lib/components/QueuePanel.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { queuePanelOpen } from '#lib/stores/audio.ts';

	let { children } = $props();

	let showUI = $state(false);

	// Update showUI based on current URL
	function updateShowUI() {
		const url = window.location.href;
		const path = window.location.pathname;

		// Don't show UI on login, callback, or root path
		showUI = !url.includes('login') && !url.includes('callback') && path !== '/' && path !== '';
	}

	onMount(async () => {
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
	<div class="h-screen flex flex-col bg-app">
		<Titlebar />

		<div class="flex flex-1 min-h-0 px-2 gap-2">
			<aside class="w-72 shrink-0 rounded-lg bg-panel overflow-hidden">
				<Playlist />
			</aside>

			<main class="flex-1 min-w-0 rounded-lg bg-panel overflow-y-auto" data-scroll-container>
				{@render children()}
			</main>

			<!-- The width animates, so the content next to it shrinks smoothly instead of jumping -->
			<div
				class="shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out {$queuePanelOpen
					? 'w-80'
					: 'w-0 -ml-2'}"
				inert={!$queuePanelOpen}
			>
				<div class="w-80 h-full rounded-lg bg-panel overflow-hidden">
					<QueuePanel />
				</div>
			</div>
		</div>

		<Songbar />
	</div>
	<Toasts />
{:else}
	<div class="h-screen flex flex-col bg-app">
		<Titlebar />
		<div class="flex-1 min-h-0 overflow-y-auto">
			{@render children()}
		</div>
	</div>
{/if}
