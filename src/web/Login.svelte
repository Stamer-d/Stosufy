<script>
	const base = __WEB_BASE__;
	// The proof of concept's login: the token the desktop app copies (Settings → Library →
	// Web app on your phone). A real login needs the osu! login through the Stosufy API.
	import { logIn, logOut } from './shims/auth';
	import { getStosufyUser } from '../lib/api';

	let token = $state('');
	let checking = $state(false);
	let error = $state('');

	async function submit() {
		if (!token.trim()) return;
		checking = true;
		error = '';
		try {
			await getStosufyUser(token.trim());
			logIn(token);
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
		class="h-12 rounded-full bg-primary-300 font-semibold disabled:opacity-50"
		disabled={checking || !token.trim()}
		onclick={submit}
	>
		{checking ? 'Checking…' : 'Log in'}
	</button>
	{#if error}
		<p class="text-sm text-red-400">{error}</p>
	{/if}
</div>
