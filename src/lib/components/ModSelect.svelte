<script>
	import { fly } from 'svelte/transition';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { setPlaybackMod } from '#lib/stores/audio.ts';
	import { MODS } from '#lib/stores/mods.ts';

	/** Speed mods, grouped and colored like in osu!'s mod select */
	const GROUPS = [
		{ label: 'Difficulty Reduction', color: 'oklch(0.85 0.17 135)', mods: ['HT', 'DC'] },
		{ label: 'Difficulty Increase', color: 'oklch(0.7 0.19 20)', mods: ['DT', 'NC'] }
	];
	const colorOf = (mod) => GROUPS.find((group) => group.mods.includes(mod))?.color;

	let open = $state(false);
	let root = $state(null);
	let mod = $derived($userSettings.settings?.mod ?? 'NM');
	let beatOn = $derived($userSettings.settings?.nightcoreBeat ?? true);

	function select(choice) {
		setPlaybackMod(mod === choice ? 'NM' : choice);
	}

	function closeOnOutsideClick(event) {
		if (open && !root?.contains(event.target)) open = false;
	}
</script>

<svelte:window
	onclick={closeOnOutsideClick}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

<div class="relative" bind:this={root}>
	<button
		title={mod === 'NM' ? 'Mods' : `${MODS[mod].name} (${MODS[mod].rate}×)`}
		aria-label="Mods"
		aria-expanded={open}
		class="h-8 min-w-8 px-1.5 grid place-items-center rounded-full cursor-pointer transition {mod ===
		'NM'
			? 'text-white/60 hover:text-white'
			: ''}"
		onclick={() => (open = !open)}
	>
		{#if mod === 'NM'}
			<span class="icon-[mingcute--dashboard-3-line] size-5"></span>
		{:else}
			<span
				class="px-1.5 rounded-md text-xs font-black tracking-wide text-black"
				style="background-color: {colorOf(mod)}"
			>
				{mod}
			</span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute bottom-full right-0 mb-3 w-80 p-3 rounded-xl bg-secondary-300 ring-1 ring-white/5 shadow-xl shadow-black/40 z-50"
			transition:fly={{ y: 6, duration: 150 }}
		>
			{#each GROUPS as group (group.label)}
				<h3
					class="px-1 mb-1.5 text-xs font-bold uppercase tracking-wider"
					style="color: {group.color}"
				>
					{group.label}
				</h3>
				<div class="grid grid-cols-2 gap-1.5 mb-3 last:mb-0">
					{#each group.mods as option (option)}
						{@const active = mod === option}
						<button
							aria-pressed={active}
							class="flex flex-col items-start gap-1 p-2 rounded-lg text-start cursor-pointer transition ring-1 {active
								? 'bg-white/10'
								: 'ring-transparent hover:bg-white/[0.06]'}"
							style={active ? `--tw-ring-color: ${group.color}` : ''}
							onclick={() => select(option)}
						>
							<span
								class="px-1.5 rounded-md text-xs font-black tracking-wide text-black"
								style="background-color: {group.color}"
							>
								{option}
							</span>
							<span class="text-sm font-semibold text-white leading-tight">
								{MODS[option].name}
							</span>
							<span class="text-xs text-secondary-600">
								{MODS[option].rate}× · {MODS[option].description}
							</span>
						</button>
					{/each}
				</div>
			{/each}
			{#if mod === 'NC'}
				<!-- Nightcore's drum beat can be turned off (it stays faster and higher) -->
				<label
					class="mt-1 flex items-center justify-between gap-3 px-1 py-1.5 text-sm cursor-pointer"
				>
					<span>
						<span class="block font-semibold text-white">Nightcore beat</span>
						<span class="block text-xs text-secondary-600">The drums under the song</span>
					</span>
					<input
						type="checkbox"
						class="peer sr-only"
						checked={beatOn}
						onchange={(e) => updateUserSettings({ nightcoreBeat: e.currentTarget.checked })}
					/>
					<span
						class="relative w-9 h-5 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
					></span>
				</label>
			{/if}
		</div>
	{/if}
</div>
