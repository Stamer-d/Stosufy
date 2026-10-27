<script>
	// The web app: the songs of your playlists on a phone. Installed from Safari (Share → Add
	// to Home Screen) it opens as an app of its own and plays on with the screen locked. It
	// looks like the desktop app: the song's background behind it all, dimmed like osu!'s, the
	// pages on a panel over it, the song bar at the bottom.
	const base = __WEB_BASE__;
	import '../../app.css';
	import '../web.css';
	import { page } from '$app/state';
	import { keyStore, loginExpired } from '../shims/auth';
	import { loadLibrary } from '../library';
	import '../listening';
	import { offline } from '../../lib/stores/network';
	import { queue } from '../player';
	import { setupNavigation } from '../navigation';
	import Dock from '../Dock.svelte';
	import SongBackdrop from '../SongBackdrop.svelte';
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
<div class="fixed inset-0 -z-10">
	<SongBackdrop {song} dim={song ? 0.75 : 1} />
</div>

<div
	class="min-h-dvh pt-[env(safe-area-inset-top)] px-2 pb-[calc(env(safe-area-inset-bottom)+8.5rem)]"
>
	{#if $offline}
		<div
			class="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 mt-2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#2b2410] ring-1 ring-amber-300/25 text-amber-100"
		>
			<span class="icon-[mingcute--wifi-off-line] size-6 shrink-0 text-amber-300"></span>
			<span class="min-w-0">
				<span class="block font-semibold">You're offline</span>
				<span class="block text-sm text-amber-100/70">Your downloaded songs still play.</span>
			</span>
		</div>
	{/if}
	<main
		bind:this={panel}
		class="mt-3 min-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-9.5rem)] rounded-xl {song
			? 'bg-panel/80'
			: 'bg-panel'} overflow-clip"
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
<div class="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-app"></div>
<FullPlayer />
<SongMenu />
<Toasts />
