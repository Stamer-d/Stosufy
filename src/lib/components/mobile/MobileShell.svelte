<script>
	// The app on a phone: a top bar, the page, a mini player and the tabs at the bottom. The
	// mini player opens the full player; friends and the queue open as full sheets.
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fly, slide } from 'svelte/transition';
	import SearchBar from '../SearchBar.svelte';
	import SongCover from '../SongCover.svelte';
	import FriendsPanel from '../FriendsPanel.svelte';
	import QueuePanel from '../QueuePanel.svelte';
	import NowPlaying from './NowPlaying.svelte';
	import {
		currentSong,
		togglePlayback,
		skipForward,
		songQueue,
		queuePanelOpen
	} from '#lib/stores/audio.ts';
	import { friendsPanelOpen } from '#lib/stores/friends.ts';
	import { openSettings } from '#lib/stores/settings.ts';
	import { offline } from '#lib/stores/network.ts';
	import { user } from '#lib/stores/user.ts';

	/** @type {{ children: import('svelte').Snippet, scroller?: HTMLElement }} */
	let { children, scroller = $bindable() } = $props();

	let playerOpen = $state(false);

	const TABS = [
		{
			href: '/home',
			label: 'Home',
			icon: 'icon-[mingcute--home-4-line]',
			active: 'icon-[mingcute--home-4-fill]'
		},
		{
			href: '/search',
			label: 'Search',
			icon: 'icon-[mingcute--search-line]',
			active: 'icon-[mingcute--search-fill]'
		},
		{
			href: '/library',
			label: 'Library',
			icon: 'icon-[mingcute--playlist-line]',
			active: 'icon-[mingcute--playlist-fill]'
		},
		{
			href: '/profile/me',
			label: 'Profile',
			icon: 'icon-[mingcute--user-3-line]',
			active: 'icon-[mingcute--user-3-fill]'
		}
	];
	const isActive = (href) =>
		page.url.pathname === href ||
		(href === '/library' && page.url.pathname.startsWith('/playlist')) ||
		(href === '/profile/me' && page.url.pathname.startsWith('/profile'));

	// The mini player's progress
	let progress = $state(0);
	$effect(() => {
		const timer = setInterval(() => {
			const audio = $songQueue.audio;
			progress = audio?.duration ? audio.currentTime / audio.duration : 0;
		}, 500);
		return () => clearInterval(timer);
	});

	let onSearch = $derived(page.url.pathname === '/search');
</script>

<div class="h-dvh flex flex-col bg-app text-white mobile-safe">
	<!-- Top bar -->
	<header class="shrink-0 flex items-center gap-2 px-3 h-14">
		{#if onSearch}
			<div class="flex-1 min-w-0"><SearchBar /></div>
		{:else}
			<img src="/logo.png" alt="" class="size-8" />
			<span class="flex-1 text-lg font-extrabold tracking-tight">Stosufy</span>
		{/if}
		<button
			class="size-10 grid place-items-center rounded-full text-secondary-600 active:bg-white/10"
			aria-label="Friend activity"
			onclick={() => friendsPanelOpen.set(true)}
		>
			<span class="icon-[mingcute--user-heart-line] size-6"></span>
		</button>
		<button
			class="size-10 grid place-items-center rounded-full text-secondary-600 active:bg-white/10"
			aria-label="Settings"
			onclick={() => openSettings()}
		>
			<span class="icon-[mingcute--settings-3-line] size-6"></span>
		</button>
	</header>

	{#if $offline}
		<div
			class="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400/10 text-xs text-amber-100"
			transition:slide={{ duration: 200 }}
		>
			<span class="icon-[mingcute--wifi-off-line] size-4 shrink-0 text-amber-300"></span>
			You're offline: your downloaded songs still play.
		</div>
	{/if}

	<main
		bind:this={scroller}
		class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
		data-scroll-container
	>
		{@render children()}
	</main>

	<!-- Mini player -->
	{#if $currentSong.song}
		<div class="shrink-0 px-2 pb-1">
			<div class="relative flex items-center gap-3 p-2 rounded-xl bg-secondary-200 overflow-hidden">
				<button
					class="flex flex-1 min-w-0 items-center gap-3 text-start"
					aria-label="Open the player"
					onclick={() => (playerOpen = true)}
				>
					<SongCover
						setId={$currentSong.song.id}
						track={$currentSong.song.track}
						title={$currentSong.song.title}
						class="size-11 rounded-lg"
					/>
					<span class="min-w-0">
						<span class="block truncate text-sm font-semibold">{$currentSong.song.title}</span>
						<span class="block truncate text-xs text-secondary-600">{$currentSong.song.artist}</span
						>
					</span>
				</button>
				<button
					class="size-10 grid place-items-center rounded-full active:bg-white/10"
					aria-label={$currentSong.isPlaying ? 'Pause' : 'Play'}
					onclick={() => togglePlayback()}
				>
					<span
						class="{$currentSong.isPlaying
							? 'icon-[mingcute--pause-fill]'
							: 'icon-[mingcute--play-fill]'} size-7"
					></span>
				</button>
				<button
					class="size-10 grid place-items-center rounded-full active:bg-white/10"
					aria-label="Next"
					onclick={() => skipForward()}
				>
					<span class="icon-[mingcute--skip-forward-fill] size-6"></span>
				</button>
				<span class="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-white/10">
					<span class="block h-full rounded-full bg-white" style="width: {progress * 100}%"></span>
				</span>
			</div>
		</div>
	{/if}

	<!-- Tabs -->
	<nav class="shrink-0 grid grid-cols-4 h-16 pb-1">
		{#each TABS as tab (tab.href)}
			{@const active = isActive(tab.href)}
			<button
				class="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold {active
					? 'text-white'
					: 'text-secondary-600'}"
				onclick={() => goto(tab.href)}
			>
				<span class="{active ? tab.active : tab.icon} size-6"></span>
				{tab.label}
			</button>
		{/each}
	</nav>
</div>

{#if playerOpen && $currentSong.song}
	<NowPlaying onclose={() => (playerOpen = false)} />
{/if}

{#if $friendsPanelOpen}
	<div
		class="fixed inset-0 z-50 bg-secondary-100 mobile-safe flex flex-col"
		transition:fly={{ y: 40, duration: 200 }}
	>
		<div class="flex-1 min-h-0 [&>aside]:w-full"><FriendsPanel /></div>
	</div>
{/if}

{#if $queuePanelOpen}
	<div
		class="fixed inset-0 z-[60] bg-secondary-100 mobile-safe flex flex-col"
		transition:fly={{ y: 40, duration: 200 }}
	>
		<div class="flex-1 min-h-0 overflow-y-auto"><QueuePanel /></div>
	</div>
{/if}

<style>
	/* Android draws the app under the status and navigation bars */
	.mobile-safe {
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>
