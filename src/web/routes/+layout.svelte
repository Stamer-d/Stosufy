<script>
	const base = __WEB_BASE__;
	// The web app: the songs of your playlists on a phone. Installed from Safari (Share → Add
	// to Home Screen) it opens as an app of its own and plays on with the screen locked.
	import '../../app.css';
	import { page } from '$app/state';
	import MiniPlayer from '../MiniPlayer.svelte';

	let { children } = $props();

	const TABS = [
		{ href: `${base}/`, label: 'Playlists', icon: 'icon-[mingcute--playlist-2-line]' },
		{ href: `${base}/check`, label: 'Checks', icon: 'icon-[mingcute--check-circle-line]' }
	];
	const active = (href) =>
		href === `${base}/`
			? !page.url.pathname.startsWith(`${base}/check`)
			: page.url.pathname.startsWith(href);
</script>

<div class="min-h-dvh bg-app pt-[env(safe-area-inset-top)]">
	<main class="pb-40">{@render children()}</main>
	<div
		class="fixed inset-x-0 bottom-0 bg-panel/95 backdrop-blur border-t border-white/5 pb-[env(safe-area-inset-bottom)]"
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
</div>
