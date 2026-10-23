<script>
	// A mix: one of today's daily mixes, the fresh finds or the forgotten favourites
	import { page } from '$app/state';
	import { allMixes } from '#lib/stores/mixes.ts';
	import MixView from '#lib/components/MixView.svelte';

	let id = $derived(page.params.id);
	let mix = $derived($allMixes.get(id) ?? null);
</script>

{#if mix}
	<MixView
		songs={mix.songs}
		queueId="mix:{id}"
		label="Made for you"
		title={mix.title}
		description={mix.description}
	/>
{:else}
	<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--music-2-line] size-12 text-secondary-600"></span>
		<p class="text-xl font-bold">This mix isn't here anymore</p>
		<p class="text-secondary-600 max-w-md">
			The daily mixes are made new every day. Find today's on the home page.
		</p>
		<a href="/home" class="mt-2 text-sm font-semibold hover:underline">Go home</a>
	</div>
{/if}
