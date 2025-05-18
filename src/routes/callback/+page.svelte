<script>
	import { onDestroy, onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import { verifyAccessToken, exchangeCode, keyStore } from '$lib/stores/auth';
	import { goto } from '$app/navigation';
	let timer = null;
	let count = 0;

	async function checkStatus() {
		let accessTokenValid = await verifyAccessToken($keyStore.access_token);
		count++;
		if (count > 9) {
			clearInterval(timer);
		}
		console.log('Access token valid:', accessTokenValid);
		if (accessTokenValid.status) {
			clearInterval(timer);
			goto('/home');
		}
	}

	onMount(() => {
		timer = setInterval(checkStatus, 3000);
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
