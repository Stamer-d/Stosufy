<script>
	import { onMount } from 'svelte';
	import { startDiscord } from '$lib/stores/discord';

	onMount(async () => {
		await startDiscord();
	});
</script>

<main class="flex flex-col items-center justify-center h-screen">
	<div class="flex flex-col items-center">
		<img src="logo.png" alt="Stosufy Logo" class="w-36 h-36 animate-bounce" />
		<h1 class="text-4xl font-bold mt-4 text-white">Stosufy</h1>
	</div>
</main>

<style>
</style>
