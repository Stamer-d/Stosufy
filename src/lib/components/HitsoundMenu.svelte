<script>
	import { fly } from 'svelte/transition';
	import Range from './Range.svelte';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { openSettings } from '#lib/stores/settings.ts';
	import { hitsoundStatus } from '#lib/hitsounds/player.ts';
	import {
		listSkins,
		skinsChanged,
		skinTask,
		DEFAULT_SKIN,
		BUILTIN
	} from '#lib/hitsounds/skins.ts';

	let open = $state(false);
	let root = $state(null);
	let settings = $derived($userSettings.settings ?? {});
	let on = $derived(settings.hitsounds ?? false);
	let beatmapSounds = $derived(settings.beatmapHitsounds ?? true);
	let skins = $state([]);

	$effect(() => {
		$skinsChanged;
		if (open) listSkins().then((list) => (skins = list));
	});

	let selected = $derived(
		!settings.hitsoundSkin ||
			settings.hitsoundSkin === BUILTIN ||
			settings.hitsoundSkin.includes(':')
			? (settings.hitsoundSkin ?? '')
			: `osu:${settings.hitsoundSkin}`
	);
	let skinOptions = $derived([
		{ value: '', label: DEFAULT_SKIN },
		...skins
			.filter((skin) => !(skin.source === 'stosufy' && skin.name === DEFAULT_SKIN))
			.map((skin) => ({
				value: skin.id,
				label: skin.source === 'osu' ? `${skin.name} (osu!)` : skin.name
			})),
		{ value: BUILTIN, label: 'Simple (built-in)' }
	]);
</script>

<svelte:window
	onclick={(e) => open && !root?.contains(e.target) && (open = false)}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

{#snippet toggle(label, checked, onchange)}
	<label
		class="flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg hover:bg-white/5 cursor-pointer"
	>
		<span class="text-sm">{label}</span>
		<input
			type="checkbox"
			class="peer sr-only"
			{checked}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		<span
			class="relative w-9 h-5 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
		></span>
	</label>
{/snippet}

<div class="relative" bind:this={root}>
	<button
		title="Hitsounds"
		aria-label="Hitsounds"
		aria-expanded={open}
		class="size-8 grid place-items-center rounded-full cursor-pointer transition {on
			? 'text-primary-500'
			: 'text-white/60 hover:text-white'}"
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--drum-line] size-5"></span>
	</button>

	{#if open}
		<div
			class="absolute bottom-full right-0 mb-3 w-72 p-1.5 rounded-xl bg-secondary-300 ring-1 ring-white/5 shadow-xl shadow-black/40 z-50"
			transition:fly={{ y: 6, duration: 150 }}
		>
			{@render toggle('Hitsounds', on, (checked) => updateUserSettings({ hitsounds: checked }))}
			{#if on}
				{@render toggle('Beatmap hitsounds', beatmapSounds, (checked) =>
					updateUserSettings({ beatmapHitsounds: checked })
				)}
				<div class="px-2.5 pt-2 pb-1">
					<p class="text-xs font-bold uppercase tracking-wider text-secondary-600 mb-1.5">Skin</p>
					<ul class="max-h-44 overflow-y-auto flex flex-col" role="listbox" aria-label="Skin">
						{#each skinOptions as option (option.value)}
							<li>
								<button
									role="option"
									aria-selected={selected === option.value}
									class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-start truncate cursor-pointer hover:bg-white/5 {selected ===
									option.value
										? 'text-primary-500'
										: ''}"
									onclick={() => updateUserSettings({ hitsoundSkin: option.value || null })}
								>
									<span
										class="icon-[mingcute--check-line] size-4 shrink-0 {selected === option.value
											? ''
											: 'invisible'}"
									></span>
									<span class="truncate">{option.label}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
				<div class="px-2.5 py-2">
					<div class="flex justify-between text-xs mb-2 text-secondary-600">
						<span class="font-bold uppercase tracking-wider">Volume</span>
						<span class="tabular-nums">{Math.round((settings.hitsoundVolume ?? 0.8) * 100)} %</span>
					</div>
					<Range
						value={settings.hitsoundVolume ?? 0.8}
						min={0}
						max={1}
						step={0.05}
						on:change={(e) => updateUserSettings({ hitsoundVolume: e.detail })}
					/>
				</div>
				{#if $skinTask.state !== 'idle' || ['loading', 'unavailable', 'error'].includes($hitsoundStatus.state)}
					<p
						class="px-2.5 pb-1 text-xs {$skinTask.state === 'error' ||
						$hitsoundStatus.state === 'error'
							? 'text-red-400'
							: 'text-secondary-600'}"
					>
						{$skinTask.state !== 'idle'
							? $skinTask.message
							: $hitsoundStatus.state === 'loading'
								? 'Loading…'
								: $hitsoundStatus.state === 'unavailable'
									? `Not for this song: ${$hitsoundStatus.message?.toLowerCase()}`
									: "Couldn't load the hitsounds of this song."}
					</p>
				{/if}
			{/if}
			<button
				class="w-full mt-1 px-2.5 py-2 rounded-lg text-sm text-start text-secondary-600 hover:text-white hover:bg-white/5 cursor-pointer"
				onclick={() => {
					open = false;
					openSettings('playback');
				}}
			>
				Import skins and more…
			</button>
		</div>
	{/if}
</div>
