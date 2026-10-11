<script>
	import { userSettings } from '#lib/stores/user.ts';
	import { VISIBILITY, setVisibility } from '#lib/stores/friends.ts';

	let current = $derived(
		$userSettings.settings?.activityVisibility ??
			($userSettings.settings?.shareActivity === false ? 'hidden' : 'all')
	);
</script>

<div>
	<div
		role="radiogroup"
		aria-label="What your friends see"
		class="grid grid-cols-3 p-0.5 rounded-lg bg-black/30 text-xs font-semibold"
	>
		{#each Object.entries(VISIBILITY) as [value, option] (value)}
			<button
				role="radio"
				aria-checked={current === value}
				class="h-7 rounded-md cursor-pointer transition {current === value
					? 'bg-secondary-400 text-white'
					: 'text-secondary-600 hover:text-white'}"
				onclick={() => setVisibility(/** @type {any} */ (value))}
			>
				{option.label}
			</button>
		{/each}
	</div>
	<p class="mt-1.5 text-xs text-secondary-600">{VISIBILITY[current].description}</p>
</div>
