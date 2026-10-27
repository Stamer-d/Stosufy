<script>
	// What works in this browser: the answers decide what the web app can do on this phone
	// (the Stosufy and osu! servers and the mirror have to allow a web page to ask them)
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { keyStore, webLoginSetup } from '../../shims/auth';
	import { osuApi } from '../../shims/http';
	import { playerLog, clearLog } from '../../log';

	const version = __WEB_VERSION__;
	import { getStosufyUser } from '../../../lib/api';
	import { playlistSongsCache } from '../../../lib/stores/playlist';
	import { streamUrl } from '../../player';

	/** @type {{ name: string, state: 'wait' | 'ok' | 'fail' | 'info', detail: string }[]} */
	let checks = $state([]);

	function check(name, run) {
		checks.push({ name, state: 'wait', detail: '' });
		const item = checks[checks.length - 1];
		return run()
			.then((result) => {
				item.state = result?.state ?? 'ok';
				item.detail = result?.detail ?? '';
			})
			.catch((error) => {
				item.state = 'fail';
				item.detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
			});
	}

	const withTimeout = (promise, ms, what) =>
		Promise.race([
			promise,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error(`${what}: no answer in ${ms / 1000} s`)), ms)
			)
		]);

	/** A song to try the mirror with: one of a playlist, else osu!'s first beatmap */
	function someSong() {
		for (const { songs } of Object.values(get(playlistSongsCache)))
			if (songs?.[0]?.beatmaps?.[0]) return songs[0];
		return { id: 1, title: 'DISCO★PRINCE', beatmaps: [{ id: 75 }] };
	}

	onMount(async () => {
		const token = get(keyStore).access_token;
		await check('Installed as an app', async () => {
			const standalone =
				matchMedia('(display-mode: standalone)').matches ||
				/** @type {any} */ (navigator).standalone;
			return standalone
				? { detail: 'Opened from the home screen' }
				: { state: 'info', detail: 'In the browser: Share → Add to Home Screen' };
		});
		await check('Stosufy API (playlists)', async () => {
			if (!token) return { state: 'info', detail: 'Log in first' };
			const user = await getStosufyUser(token);
			return { detail: `Logged in as ${user.username}` };
		});
		await check('osu! login', async () => {
			const keys = get(keyStore);
			if (keys.refresh_token) return { detail: 'Logged in with osu!: it renews itself' };
			const setup = await webLoginSetup();
			return setup
				? { state: 'info', detail: 'Set up: log out and back in with osu! to stay logged in' }
				: { state: 'info', detail: 'Not set up on the server yet: the pasted login lasts a day' };
		});
		await check('osu! API (song details, search)', async () => {
			if (!token) return { state: 'info', detail: 'Log in first' };
			// (through the Stosufy API: osu! doesn't let web pages ask it)
			const response = await osuApi('me', token);
			return { state: response.ok ? 'ok' : 'fail', detail: `HTTP ${response.status}` };
		});
		const song = someSong();
		await check('Streaming from the mirror (playing)', () =>
			withTimeout(
				new Promise((resolve, reject) => {
					const audio = new Audio();
					audio.preload = 'auto';
					audio.muted = true;
					audio.addEventListener('canplay', () => resolve({ detail: `"${song.title}" can play` }), {
						once: true
					});
					audio.addEventListener(
						'error',
						() => reject(new Error(`The audio didn't load (code ${audio.error?.code})`)),
						{ once: true }
					);
					audio.src = streamUrl(song);
					audio.load();
				}),
				20000,
				'The mirror'
			)
		);
		await check('Downloading from the mirror (keeping songs)', async () => {
			const controller = new AbortController();
			const response = await withTimeout(
				fetch(streamUrl(song), { signal: controller.signal }),
				20000,
				'The mirror'
			);
			const reader = response.body?.getReader();
			const first = await reader?.read();
			controller.abort();
			return response.ok
				? { detail: `Allowed (${first?.value?.byteLength ?? 0} bytes read)` }
				: { state: 'fail', detail: `HTTP ${response.status}` };
		});
		await check('Storage', async () => {
			const estimate = await navigator.storage?.estimate?.();
			const persisted = await navigator.storage?.persisted?.();
			const gb = (bytes) => `${((bytes ?? 0) / 1e9).toFixed(1)} GB`;
			return {
				state: 'info',
				detail: estimate
					? `${gb(estimate.usage)} used of ${gb(estimate.quota)}${persisted ? ', kept for good' : ', may be cleared when space runs out'}`
					: 'Unknown'
			};
		});
		await check('Lock screen controls', async () =>
			'mediaSession' in navigator
				? { detail: 'Media Session is there' }
				: { state: 'fail', detail: 'No Media Session' }
		);
	});

	const ICONS = {
		wait: 'icon-[svg-spinners--ring-resize] text-secondary-600',
		ok: 'icon-[mingcute--check-circle-fill] text-green-400',
		fail: 'icon-[mingcute--close-circle-fill] text-red-400',
		info: 'icon-[mingcute--information-fill] text-sky-400'
	};
</script>

<header class="px-5 pt-6 pb-3">
	<h1 class="text-3xl font-extrabold">Checks</h1>
	<p class="mt-1 text-sm text-secondary-600">What works in this browser · version {version}</p>
</header>
<ul class="px-5 flex flex-col gap-3">
	{#each checks as item (item.name)}
		<li class="flex items-start gap-3 p-3 rounded-xl bg-white/[0.04]">
			<span class="{ICONS[item.state]} size-5 shrink-0 mt-0.5"></span>
			<span class="min-w-0">
				<span class="block font-semibold">{item.name}</span>
				{#if item.detail}
					<span class="block text-sm text-secondary-600 break-words select-text">{item.detail}</span
					>
				{/if}
			</span>
		</li>
	{/each}
</ul>

<section class="px-5 pt-6">
	<div class="flex items-center justify-between">
		<h2 class="font-bold">What the player did</h2>
		<button class="text-sm text-secondary-600" onclick={clearLog}>Clear</button>
	</div>
	<p class="text-xs text-secondary-600">The newest last. Play, lock the screen, then look here.</p>
	<ol
		class="mt-2 p-3 rounded-xl bg-white/[0.04] text-xs font-mono flex flex-col gap-0.5 select-text"
	>
		{#each $playerLog as line, i (i)}
			<li class="break-words">{line}</li>
		{:else}
			<li class="text-secondary-600">Nothing yet</li>
		{/each}
	</ol>
</section>
