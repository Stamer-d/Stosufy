<script>
	const base = __WEB_BASE__;
	// The web app: the songs of your playlists on a phone. Installed from Safari (Share → Add
	// to Home Screen) it opens as an app of its own and plays on with the screen locked.
	import '../../app.css';
	import '../web.css';
	import { page } from '$app/state';
	import { keyStore, loginExpired } from '../shims/auth';
	import { loadLibrary } from '../library';
	import '../listening';
	import { offline } from '../../lib/stores/network';
	import MiniPlayer from '../MiniPlayer.svelte';
	import FullPlayer from '../FullPlayer.svelte';
	import SongMenu from '../SongMenu.svelte';
	import Toasts from '../Toasts.svelte';
	import Login from '../Login.svelte';

	let { children } = $props();

	const TABS = [
		{ href: `${base}/`, label: 'Home', icon: 'icon-[mingcute--home-4-line]' },
		{ href: `${base}/library`, label: 'Library', icon: 'icon-[mingcute--playlist-2-line]' },
		{ href: `${base}/search`, label: 'Search', icon: 'icon-[mingcute--search-line]' },
		{ href: `${base}/downloads`, label: 'Downloads', icon: 'icon-[mingcute--download-2-line]' }
	];
	const active = (href) =>
		href === `${base}/`
			? page.url.pathname === `${base}/` ||
				page.url.pathname === base ||
				page.url.pathname.startsWith(`${base}/mix`)
			: href === `${base}/library`
				? page.url.pathname.startsWith(href) || page.url.pathname.startsWith(`${base}/playlist`)
				: page.url.pathname.startsWith(href);

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

<div class="min-h-dvh bg-app pt-[env(safe-area-inset-top)]">
	{#if $offline}
		<div
			class="sticky top-[env(safe-area-inset-top)] z-20 px-4 py-1.5 bg-amber-400 text-black text-xs font-semibold flex items-center justify-center gap-1.5"
		>
			<span class="icon-[mingcute--wifi-off-line] size-4"></span>
			Offline · your downloads play
		</div>
	{/if}
	<main class="pb-44">
		{#if needsLogin}
			<Login />
		{:else}
			{@render children()}
		{/if}
	</main>
	<div
		class="fixed inset-x-0 bottom-0 z-20 bg-panel/95 backdrop-blur border-t border-white/5 pb-[env(safe-area-inset-bottom)]"
	>
		<MiniPlayer />
		<nav class="flex">
			{#each TABS as tab (tab.href)}
				<a
					href={tab.href}
					class="flex-1 flex flex-col items-center gap-0.5 py-2 text-[11px] {active(tab.href)
						? 'text-white'
						: 'text-secondary-600'}"
				>
					<span class="{tab.icon} size-6"></span>
					{tab.label}
				</a>
			{/each}
		</nav>
	</div>
	<!-- (what scrolls doesn't show behind the clock and the notch) -->
	<div class="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-app"></div>
	<FullPlayer />
	<SongMenu />
	<Toasts />
</div>
