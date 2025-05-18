<script>
	let { children } = $props();
	import '../app.css';
	import Songbar from '$lib/components/Songbar.svelte';
	import Playlist from '$lib/components/Playlist.svelte';
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { startTokenRefresh } from '$lib/stores/auth';
	import Titlebar from '$lib/components/Titlebar.svelte';

	let showUI = $state(false);

	// Update showUI based on current URL
	function updateShowUI() {
		const url = window.location.href;
		const path = window.location.pathname;

		// Don't show UI on login, callback, or root path
		showUI = !url.includes('login') && !url.includes('callback') && path !== '/' && path !== '';
	}

	// Initial check when mounted
	onMount(async () => {
		await startTokenRefresh();
		updateShowUI();
	});

	// Setup effect to update when the page changes
	$effect(() => {
		if ($page) {
			updateShowUI();
		}
	});

	onDestroy(async () => {
		await startTokenRefresh();
	});
</script>

<main>
	{#if showUI}
		<div class="fixed top-0 left-0 right-0 z-30">
			<Titlebar />
		</div>

		<main class="flex flex-col h-screen pt-[60px]">
			<div class="flex flex-1 overflow-hidden">
				<!-- Playlist on the left -->
				<div class="w-64 h-full">
					<Playlist />
				</div>

				<!-- MapFinder on the right -->
				<div class="flex-1 p-4 overflow-y-auto">
					{@render children()}
				</div>
			</div>

			<div class="w-full">
				<Songbar />
			</div>
		</main>
	{:else}
		<div class="fixed top-0 left-0 right-0 z-30">
			<Titlebar />
		</div>
		{@render children()}
	{/if}
</main>

<style lang="postcss">
	:global(html) {
		@apply bg-[#242227];
		color: white;
		user-select: none;
	}
	/* Custom scrollbar styles */

	:global(::-webkit-scrollbar-thumb) {
		background: #555;
		border-radius: 4px;
		transition: background 0.2s ease;
	}

	/* For Firefox */
	:global(html) {
		scrollbar-width: thin;
		scrollbar-color: #555 #1a1a1a;
	}
</style>
