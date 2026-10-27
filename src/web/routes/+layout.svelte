<script>
	// The web app: the songs of your playlists on a phone. Installed from Safari (Share → Add
	// to Home Screen) it opens as an app of its own and plays on with the screen locked. It
	// looks like the desktop app: the song's background behind it all, dimmed like osu!'s, the
	// pages on a panel over it, the song bar at the bottom.
	const base = __WEB_BASE__;
	import '../../app.css';
	import '../web.css';
	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { keyStore, loginExpired } from '../shims/auth';
	import { loadLibrary } from '../library';
	import '../listening';
	import { offline } from '../../lib/stores/network';
	import { queue } from '../player';
	import { setupNavigation } from '../navigation';
	import Dock from '../Dock.svelte';
	import FullPlayer from '../FullPlayer.svelte';
	import SongMenu from '../SongMenu.svelte';
	import Toasts from '../Toasts.svelte';
	import Login from '../Login.svelte';

	let { children } = $props();
	let panel = $state();
	setupNavigation(() => panel);

	let song = $derived($queue.songs[$queue.index] ?? null);

	// (the checks and the downloads work without a login: downloads play offline after it ran
	// out; the way back from osu!'s login is the login)
	let needsLogin = $derived(
		(!$keyStore.access_token || $loginExpired) &&
			!page.url.pathname.startsWith(`${base}/check`) &&
			!page.url.pathname.startsWith(`${base}/callback`) &&
			!page.url.pathname.startsWith(`${base}/downloads`)
	);

	$effect(() => {
		if ($keyStore.access_token && !$loginExpired) loadLibrary($keyStore.access_token);
	});
</script>

<!-- The song's background behind the app, blurred and dimmed (like the desktop app's) -->
<div class="fixed inset-0 -z-10 bg-app">
	{#if song}
		{#key song.id}
			<img
				src="https://assets.ppy.sh/beatmaps/{song.id}/covers/card@2x.jpg"
				alt=""
				class="absolute inset-0 size-full object-cover blur-2xl scale-125"
				transition:fade={{ duration: 600 }}
				onerror={(e) => e.currentTarget.classList.add('hidden')}
			/>
		{/key}
		<div class="absolute inset-0 bg-app/75"></div>
	{/if}
</div>

<div
	class="min-h-dvh pt-[env(safe-area-inset-top)] px-2 pb-[calc(env(safe-area-inset-bottom)+8.5rem)]"
>
	{#if $offline}
		<div
			class="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 mt-2 flex items-center gap-2 px-3 h-9 rounded-lg bg-amber-400/15 backdrop-blur-xl ring-1 ring-amber-300/25 text-xs text-amber-100"
		>
			<span class="icon-[mingcute--wifi-off-line] size-4 text-amber-300"></span>
			<span class="font-semibold">You're offline.</span>
			<span class="text-amber-100/70 truncate">Your downloaded songs still play.</span>
		</div>
	{/if}
	<main
		bind:this={panel}
		class="mt-2 min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-9.5rem)] rounded-xl {song
			? 'bg-panel/80'
			: 'bg-panel'} overflow-clip"
		style="view-transition-name: page"
	>
		{#if needsLogin}
			<Login />
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<Dock />
<!-- (what scrolls doesn't show behind the clock and the notch) -->
<div
	class="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-app/80 backdrop-blur-xl"
></div>
<FullPlayer />
<SongMenu />
<Toasts />
