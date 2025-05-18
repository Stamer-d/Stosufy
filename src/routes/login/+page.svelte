<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	import Button from '$lib/components/Button.svelte';
	import Input from '$lib/components/Input.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { checkSessionKey, keyStore } from '$lib/stores/auth';
	import { open } from '@tauri-apps/plugin-shell';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { goto } from '$app/navigation';

	const clientId = '40234';
	const redirectUrl = 'stosufynew://callback';
	const scope = 'public';
	const authUrl = `https://osu.ppy.sh/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUrl)}&response_type=code&scope=${scope}`;

	let sessionKeyValid = {
		status: false
	};
	let showInfo = false;

	onMount(async () => {
		if ($keyStore.sessionKey) {
			sessionKeyValid = await checkSessionKey($keyStore?.sessionKey);
		}

		await onOpenUrl((urls) => {
			goto('/callback?code =' + urls[0].split('code=')[1]);
		});
	});
</script>

<main class="flex flex-col justify-center items-center h-screen gap-6 relative">
	{#if sessionKeyValid.status_code === 429}
		<p class="font-semibold absolute top-1/8 z-50 text-red-300 text-center text-xl p-4">
			Rate limit exceeded. Please try again later.
		</p>
	{:else if sessionKeyValid.status_code === 401}
		<p class="font-semibold absolute top-1/8 z-50 text-red-300 text-center text-xl p-4">
			Invalid session key. Please check your session key.
		</p>
	{/if}
	<div class="flex flex-col gap-2 items-center">
		<img src="logo.png" alt="" class="size-30" />
		<p class="text-5xl font-semibold">Log in to Stosufy</p>
	</div>
	<div class="w-1/4 flex flex-col gap-2">
		<div class="flex items-center">
			<p class="font-semibold text-lg">Session Key</p>
			<Button
				on:click={() => {
					showInfo = true;
				}}
				class="-mt-3 -ml-1"
				type="ghost"
				icon="icon-[fa6-solid--circle-question]"
			/>
		</div>
		<Input
			bind:value={$keyStore.sessionKey}
			type="password"
			on:blur={async () => {
				if ($keyStore?.sessionKey?.startsWith('ey')) {
					sessionKeyValid = await checkSessionKey($keyStore?.sessionKey);
					if (sessionKeyValid.status) {
					}
				} else {
					sessionKeyValid.status = false;
				}
			}}
			placeholder="Session Key"
		></Input>
	</div>
	<Button
		class="w-1/4 flex justify-center"
		type="primary"
		disabled={!sessionKeyValid.status}
		on:click={async () => {
			await open(authUrl);
		}}>Authorize at Osu!</Button
	>
</main>

<Modal bind:open={showInfo} title="Session Key Info">
	<div class="flex flex-col gap-4">
		<div>
			<h1 class="text-lg font-bold">🟣 What is a Session Key?</h1>
			<p class="text-sm leading-relaxed">
				A <strong>Session Key</strong> is a small piece of data that osu! uses to keep you logged in
				while browsing their website. It’s stored in your browser as a cookie and identifies your account
				during your session. Think of it as a temporary pass that tells the osu! website, “Hey, this
				user is already logged in.”
			</p>
			<p class="text-sm leading-relaxed mt-2">
				It usually looks like a random string of letters and numbers and is stored under a cookie
				called <code>osu_session</code>.
			</p>
		</div>
		<div>
			<h1 class="text-lg font-bold">🟡 Why does this app need my Session Key?</h1>
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
				⚠️ Security Note: Never share your Session Key with untrusted sources. This app only uses it
				for downloads and stores it locally on your device to keep you logged in to Stosufy after
				restarts.
			</p>
		</div>
		<div>
			<h1 class="text-lg font-bold">🟢 How do I get my Session Key?</h1>
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
