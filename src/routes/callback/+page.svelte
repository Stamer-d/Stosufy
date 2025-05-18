<script>

	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
    import { verifyAccessToken, exchangeCode, keyStore } from '$lib/stores/auth';
  import { goto } from '$app/navigation';
	let timer = null;
	let count = 0;

	async function processAuthCode(code) {
		const tokenData = await exchangeCode(code);
        console.log('Token data:', tokenData);
		$keyStore.access_token = tokenData.access_token;
        $keyStore.refresh_token = tokenData.refresh_token;
        $keyStore.expiry_time = Date.now() + tokenData.expires_in * 1000;
		timer = setInterval(checkStatus, 3000);
	}

	async function checkStatus() {
		let accessTokenValid = await verifyAccessToken($keyStore.access_token);
		count++;
		if (count > 9) {
			clearInterval(timer);
		}
		console.log('Access token valid:', accessTokenValid);
		if (accessTokenValid.status ) {
			clearInterval(timer);
			goto('/home');
		}
	}

	onMount(() => {
        console.log('Mounting callback page');
        console.log('Current URL:', window.location.href);
		if (window.location.search.includes('?code%20=')) {
			const code = window.location.search.split('?code%20=')[1];
			if (code) {
				processAuthCode(code);
			}
		}
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
			on:click={() => {
				goto('/login');
			}}>Back to Login</Button
		>
	{:else}
		<p class="text-5xl font-semibold">Processing login...</p>
		<p class="text-lg">Please wait while we process your login.</p>
	{/if}
</div>
