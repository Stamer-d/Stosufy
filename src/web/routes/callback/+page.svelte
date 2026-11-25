<script>
	const base = __WEB_BASE__;
	// Back from osu!'s login: its code becomes the login, then on to the playlists (or, for
	// Claude's connector, on to the server)
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { finishOsuLogin } from '../../shims/auth';

	let error = $state('');

	/** Logins of Claude's Stosufy connector (they use this app's osu! login): the server goes on */
	const CLAUDE_LOGIN = 'stosufy-mcp.';
	const CLAUDE_CALLBACK = 'https://api.stamer-d.de/v2/stosufy/oauth/osu';

	onMount(async () => {
		const params = page.url.searchParams;
		if (params.get('state')?.startsWith(CLAUDE_LOGIN)) {
			location.replace(`${CLAUDE_CALLBACK}${location.search}`);
			return;
		}
		try {
			if (params.get('error'))
				throw new Error(params.get('error_description') ?? params.get('error'));
			await finishOsuLogin(params.get('code'), params.get('state'));
			goto(`${base}/`, { replaceState: true });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	});
</script>

<div class="px-5 pt-24 flex flex-col items-center gap-4 text-center">
	{#if error}
		<span class="icon-[mingcute--warning-line] size-10 text-amber-300"></span>
		<p class="font-semibold">The login didn't work</p>
		<p class="text-sm text-secondary-600">{error}</p>
		<a
			href="{base}/"
			class="h-11 px-6 grid place-items-center rounded-full bg-white/10 font-semibold">Try again</a
		>
	{:else}
		<span class="icon-[svg-spinners--ring-resize] size-8 text-secondary-600"></span>
		<p class="text-sm text-secondary-600">Logging in…</p>
	{/if}
</div>
