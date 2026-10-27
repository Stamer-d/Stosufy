<script>
	import { onDestroy, onMount } from 'svelte';
	import Button from '#lib/components/Button.svelte';
	import { verifyAccessToken, keyStore, takePendingOsuFolder } from '#lib/stores/auth.ts';
	import { importOsuFolder } from '#lib/stores/osuImport.ts';
	import { goto } from '$app/navigation';
	let timer = null;
	let count = 0;

	let checking = false;
	async function checkStatus() {
		if (checking) return;
		checking = true;
		// No connection right now: tried again with the next check
		let accessTokenValid = await verifyAccessToken($keyStore.access_token).catch(() => ({
			status: false
		}));
		checking = false;
		count++;
		if (count > 9) {
			clearInterval(timer);
		}
		if (accessTokenValid.status) {
			clearInterval(timer);
			// The osu! folder picked at the login
			const folder = takePendingOsuFolder();
			if (folder) importOsuFolder(folder);
			goto('/home', { replaceState: true });
		}
	}

	onMount(() => {
		timer = setInterval(checkStatus, 3000);
		checkStatus();
	});

	onDestroy(() => {
		if (timer) {
			clearInterval(timer);
		}
	});
</script>

<div class="h-screen flex flex-col justify-center items-center gap-6">
	<img src="logo.png" alt="" class="size-32 animate-bounce" />
	{#if count > 9}
		<p class="text-red-500">Something got messed up here...</p>
		<p>Please try again later or contact the creator of Stosufy!</p>
		<Button
			onclick={() => {
				goto('/login', { replaceState: true });
			}}>Back to Login</Button
		>
	{:else}
		<p class="text-5xl font-semibold">Processing login...</p>
		<p class="text-lg">Please wait while we process your login.</p>
	{/if}
</div>
