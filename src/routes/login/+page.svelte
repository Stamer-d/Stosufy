<script lang="ts">
	import { onMount } from 'svelte';

	import Button from '#lib/components/Button.svelte';
	import Input from '#lib/components/Input.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import {
		checkSessionKey,
		exchangeCode,
		keyStore,
		type SessionKeyCheck
	} from '#lib/stores/auth.ts';
	import { open } from '@tauri-apps/plugin-shell';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { goto } from '$app/navigation';

	const clientId = '40234';
	const redirectUrl = 'stosufynew://callback';
	const scope = 'public';
	const authUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&scope=${scope}`;

	let sessionKeyValid: Pick<SessionKeyCheck, 'status' | 'status_code'> = {
		status: false
	};
	let showInfo = false;

	onMount(async () => {
		if ($keyStore.sessionKey) {
			sessionKeyValid = await checkSessionKey($keyStore?.sessionKey);
		}

		await onOpenUrl(async (urls) => {
			const code = urls[0].split('code=')[1];
			const tokenData = await exchangeCode(code);
			$keyStore.access_token = tokenData.access_token;
			$keyStore.refresh_token = tokenData.refresh_token;
			$keyStore.expiry_time = Date.now() + tokenData.expires_in * 1000;
			goto('/callback');
		});
	});
</script>

<main class="min-h-full grid place-items-center px-6 py-10">
	<div class="w-full max-w-sm flex flex-col items-center">
		<img src="logo.png" alt="" class="size-20 mb-6" />
		<h1 class="text-3xl font-extrabold tracking-tight text-center">Log in to Stosufy</h1>
		<p class="mt-2 text-sm text-secondary-600 text-center">
			Listen to osu! beatmaps and build your own playlists.
		</p>

		{#if sessionKeyValid.status_code === 429 || sessionKeyValid.status_code === 401}
			<div
				class="mt-6 w-full flex items-start gap-2 rounded-lg bg-red-500/10 ring-1 ring-red-500/30 px-3 py-2.5 text-sm text-red-300"
				role="alert"
			>
				<span class="icon-[mingcute--warning-line] size-5 shrink-0"></span>
				{sessionKeyValid.status_code === 429
					? 'Too many attempts. Please try again later.'
					: 'This session key is invalid. Please check it and try again.'}
			</div>
		{/if}

		<div class="mt-8 w-full">
			<div class="flex items-center justify-between mb-2">
				<label for="session-key" class="text-sm font-semibold">osu! session key</label>
				<button
					class="text-xs font-semibold text-secondary-600 hover:text-white cursor-pointer"
					onclick={() => (showInfo = true)}
				>
					Where do I find it?
				</button>
			</div>
			<Input
				id="session-key"
				bind:value={$keyStore.sessionKey}
				type="password"
				on:blur={async () => {
					if ($keyStore?.sessionKey?.startsWith('ey')) {
						sessionKeyValid = await checkSessionKey($keyStore?.sessionKey);
					} else {
						sessionKeyValid.status = false;
					}
				}}
				placeholder="Paste your session key"
			></Input>
			<p class="mt-2 text-xs text-secondary-600">
				Needed to download beatmaps. It stays on this device.
			</p>
		</div>

		<Button
			class="mt-6 w-full justify-center h-11"
			type="primary"
			disabled={!sessionKeyValid.status}
			on:click={async () => {
				await open(authUrl);
			}}
		>
			Continue with osu!
		</Button>
	</div>
</main>

<Modal bind:open={showInfo} title="About the session key">
	<div class="flex flex-col gap-4">
		<div>
			<h3 class="text-base font-bold text-white">What is a session key?</h3>
			<p class="text-sm leading-relaxed">
				A <strong>Session Key</strong> is a small piece of data that osu! uses to keep you logged in while
				browsing their website. It’s stored in your browser as a cookie and identifies your account during
				your session. Think of it as a temporary pass that tells the osu! website, “Hey, this user is
				already logged in.”
			</p>
			<p class="text-sm leading-relaxed mt-2">
				It usually looks like a random string of letters and numbers and is stored under a cookie
				called <code>osu_session</code>.
			</p>
		</div>
		<div>
			<h3 class="text-base font-bold text-white">Why does Stosufy need it?</h3>
			<p class="text-sm leading-relaxed">
				Normally, downloading beatmaps (songs) from osu! requires you to be logged in. The osu! API
				doesn’t allow direct song downloads — it only provides metadata (like song title, artist,
				etc.).
			</p>
			<p class="text-sm leading-relaxed mt-2">
				By providing your <strong>Session Key</strong>, you allow this app to “act” like you are in
				your browser, enabling it to download beatmaps on your behalf.
			</p>
			<p class="text-sm leading-relaxed mt-2 text-red-500 font-semibold">
				Security note: Never share your Session Key with untrusted sources. This app only uses it
				for downloads and stores it locally on your device to keep you logged in to Stosufy after
				restarts.
			</p>
		</div>
		<div>
			<h3 class="text-base font-bold text-white">How do I get it?</h3>
			<p class="text-sm leading-relaxed">
				Follow these steps to retrieve your <strong>Session Key</strong>:
			</p>
			<ul class="list-disc list-inside text-sm leading-relaxed mt-2">
				<li>Log in to osu! on your browser.</li>
				<li>
					Right-click anywhere on the page and choose <strong>Inspect</strong> (or press
					<code>F12</code>) to open Developer Tools.
				</li>
				<li>Go to the <strong>Application</strong> tab.</li>
				<li>
					On the left, under <strong>Storage</strong>, click <strong>Cookies</strong> and select
					<code>https://osu.ppy.sh</code>.
				</li>
				<li>In the list of cookies, look for the one called <code>osu_session</code>.</li>
				<li>Copy the <strong>Value</strong> of that cookie — that’s your Session Key!</li>
			</ul>
		</div>
	</div>
</Modal>
