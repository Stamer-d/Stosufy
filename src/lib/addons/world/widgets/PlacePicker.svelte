<script>
	// Asks for the city a widget shows
	import { findPlace, setPlace } from '#lib/stores/widgetData.ts';

	/** @type {{ uid: string, label?: string, ondone?: () => void }} */
	let { uid, label = 'Show', ondone = () => {} } = $props();

	let query = $state('');
	let error = $state('');

	async function choose(event) {
		event.preventDefault();
		const name = query.trim();
		if (!name) return;
		try {
			const place = await findPlace(name);
			if (!place) {
				error = `"${name}" wasn't found`;
				return;
			}
			setPlace(uid, place);
			query = '';
			ondone();
		} catch {
			error = "Couldn't look up the place";
		}
	}
</script>

<form class="mt-auto flex flex-col gap-2" onsubmit={choose}>
	<input
		bind:value={query}
		placeholder="Your city"
		class="h-8 px-2.5 rounded-lg bg-white/10 text-sm outline-none ring-1 ring-white/10 focus:ring-white/30"
	/>
	<button class="h-8 rounded-lg bg-white/15 text-sm font-semibold cursor-pointer hover:bg-white/25"
		>{label}</button
	>
	{#if error}<p class="text-xs text-red-300">{error}</p>{/if}
</form>
