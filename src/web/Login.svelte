<script>
	const base = __WEB_BASE__;
	// The login: osu!'s (once the Stosufy API has the web app's osu! app), else the login the
	// desktop app copies (Settings → Library → Web app on your phone), which lasts a day
	import { onMount } from 'svelte';
	import {
		logIn,
		logOut,
		readLogin,
		loginExpired,
		webLoginSetup,
		startOsuLogin
	} from './shims/auth';
	import { getStosufyUser } from '../lib/api';
	import InstallHint from './InstallHint.svelte';

	let token = $state('');
	let checking = $state(false);
	let error = $state('');
	// (shown again once the login ran out)
	const expired = $loginExpired;
	/** osu!'s login: null while asking, false when the API doesn't have it yet */
	let setup = $state(null);
	let pasting = $state(false);

	onMount(async () => {
		setup = (await webLoginSetup()) ?? false;
	});

	async function submit() {
		if (!token.trim()) return;
		checking = true;
		error = '';
		const login = readLogin(token);
		if (login.expires <= Date.now()) {
			error = 'That login ran out already: copy a new one';
			checking = false;
			return;
		}
		try {
			await getStosufyUser(login.token);
			logIn(login.token, login.expires);
		} catch (e) {
			logOut();
			error = `That didn't work: ${e instanceof Error ? e.message : e}`;
		} finally {
			checking = false;
		}
	}
</script>

<div class="px-5 pt-16 flex flex-col gap-5">
	<img src="{base}/icon-192.png" alt="" class="size-20 rounded-2xl self-center" />
	<div class="text-center">
		<h1 class="text-2xl font-extrabold">Stosufy</h1>
		<p class="mt-1 text-sm text-secondary-600">Your playlists on your phone</p>
	</div>
	<!-- (before logging in: the installed app needs its own login) -->
	<InstallHint />
	{#if expired}
		<p class="p-3 rounded-xl bg-amber-300/10 text-sm text-amber-200">
			Your login ran out. Log in again; your downloads stay.
		</p>
	{/if}

	{#if setup}
		<button
			class="h-12 rounded-full bg-primary-300 font-semibold flex items-center justify-center gap-2"
			onclick={() => startOsuLogin(setup)}
		>
			Log in with osu!
		</button>
		{#if !pasting}
			<button class="text-sm text-secondary-600" onclick={() => (pasting = true)}>
				Or paste the login from the desktop app
			</button>
		{/if}
	{:else if setup === null}
		<span class="icon-[svg-spinners--ring-resize] size-6 self-center text-secondary-600"></span>
	{/if}

	{#if setup === false || pasting}
		<ol class="text-sm text-white/80 list-decimal pl-5 flex flex-col gap-1">
			<li>In the desktop app: Settings → Library → <b>Copy login</b></li>
			<li>Paste it here (it lasts a day)</li>
		</ol>
		<textarea
			bind:value={token}
			rows="3"
			placeholder="Paste your login"
			class="w-full p-3 rounded-xl bg-secondary-300 text-sm outline-none focus:ring-2 focus:ring-primary-400 select-text"
		></textarea>
		<button
			class="h-12 rounded-full font-semibold disabled:opacity-50 {setup
				? 'bg-white/10'
				: 'bg-primary-300'}"
			disabled={checking || !token.trim()}
			onclick={submit}
		>
			{checking ? 'Checking…' : 'Log in'}
		</button>
	{/if}
	{#if error}
		<p class="text-sm text-red-400">{error}</p>
	{/if}
</div>
