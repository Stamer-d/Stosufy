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
	import '../hitsounds';
	import { offline } from '../../lib/stores/network';
	import { queue } from '../player';
	import { setupNavigation } from '../navigation';
	import { onMount } from 'svelte';
	import { startSettingsSync } from '../../lib/stores/settingsSync';
	import { userSettings } from '../../lib/stores/user';
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
			!page.url.pathname.startsWith(`${base}/downloads`) &&
			!page.url.pathname.startsWith(`${base}/library/downloads`)
	);

	$effect(() => {
		if ($keyStore.access_token && !$loginExpired) loadLibrary($keyStore.access_token);
	});

	// The account's settings, as in the desktop app (its accent color, smart playlists…)
	onMount(startSettingsSync);
	let appearance = $derived({
		accent: 'violet',
		background: true,
		dim: 75,
		...$userSettings.settings?.appearance
	});
	$effect(() => {
		document.documentElement.dataset.accent = appearance.accent;
	});
	/** The background behind the app, dimmed as set in the desktop app (osu!'s background dim) */
	let dim = $derived(song && appearance.background ? appearance.dim / 100 : 1);

	// Typing: the tab bar steps aside (html.typing); scrolling puts the keyboard away, as in
	// the phone's own apps
	const isField = (element) =>
		element instanceof HTMLTextAreaElement ||
		(element instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(element.type));
	onMount(() => {
		const focusIn = (event) =>
			isField(event.target) && document.documentElement.classList.add('typing');
		const focusOut = () =>
			setTimeout(() => {
				if (!isField(document.activeElement)) document.documentElement.classList.remove('typing');
			}, 50);
		const scrolled = (event) => {
			if (isField(document.activeElement) && !isField(event.target))
				/** @type {HTMLElement} */ (document.activeElement).blur();
		};
		document.addEventListener('focusin', focusIn);
		document.addEventListener('focusout', focusOut);
		window.addEventListener('touchmove', scrolled, { passive: true });
		return () => {
			document.removeEventListener('focusin', focusIn);
			document.removeEventListener('focusout', focusOut);
			window.removeEventListener('touchmove', scrolled);
		};
	});

	/** Scrolled down: the bar behind the clock shows */
	let scrolled = $state(false);
	onMount(() => {
		const onScroll = () => (scrolled = window.scrollY > 4);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<!-- The song's background behind the app, blurred and dimmed (like the desktop app's) -->
<div class="fixed inset-0 -z-10">
	<SongBackdrop {song} {dim} />
</div>

<!-- The app on the whole screen, edge to edge (a page swiped aside doesn't widen it: that
     painted the whole document again every frame): the pages start under the clock (their
     header's color reaches up behind it); once scrolled, a bar behind the clock keeps what
     scrolls from showing there -->
<div class="min-h-dvh overflow-x-clip">
	<main
		bind:this={panel}
		class="min-h-dvh pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+8.5rem)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] {song
			? 'bg-panel/80'
			: 'bg-panel'} overflow-clip"
	>
		{#if $offline}
			<div
				class="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-20 mx-2 mt-2 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#2b2410] ring-1 ring-amber-300/25 text-amber-100"
			>
				<span class="icon-[mingcute--wifi-off-line] size-6 shrink-0 text-amber-300"></span>
				<span class="min-w-0">
					<span class="block font-semibold">You're offline</span>
					<span class="block text-sm text-amber-100/70">Your downloaded songs still play.</span>
				</span>
			</div>
		{/if}
		{#if needsLogin}
			<Login />
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<Dock />
<div
	class="fixed inset-x-0 top-0 z-20 h-[env(safe-area-inset-top)] bg-panel pointer-events-none transition-opacity duration-150 {scrolled
		? 'opacity-100'
		: 'opacity-0'}"
></div>
<FullPlayer />
<SongMenu />
<Toasts />
