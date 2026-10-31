<script>
	// The Dash mode's sounds: its own effects (how loud, which) and the beatmap's hitsounds
	import { fly } from 'svelte/transition';
	import Range from '../Range.svelte';
	import { dashSounds } from '#lib/dash/sounds.ts';
	import { playDashSound } from '#lib/dash/sound.ts';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';

	/** @type {{ up?: boolean }} */
	let { up = false } = $props();
	let open = $state(false);
	let root = $state(null);
	let hitsounds = $derived($userSettings.settings?.hitsounds ?? false);
	let hitsoundVolume = $derived($userSettings.settings?.hitsoundVolume ?? 0.8);

	/** @type {['death' | 'checkpoint' | 'complete' | 'click', string][]} */
	const EFFECTS = [
		['death', 'Crash'],
		['checkpoint', 'Checkpoint'],
		['complete', 'Level complete'],
		['click', 'Click on every press']
	];
</script>

<svelte:window onpointerdown={(e) => open && !root?.contains(e.target) && (open = false)} />

<div class="relative" bind:this={root}>
	<button
		class="grid place-items-center size-10 rounded-full bg-white/10 text-white/80 hover:text-white hover:bg-white/15 cursor-pointer transition"
		title="Sounds"
		aria-label="Sounds"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--volume-line] size-5"></span>
	</button>
	{#if open}
		<div
			class="absolute right-0 {up
				? 'bottom-12'
				: 'top-12'} z-20 w-72 p-3 flex flex-col gap-3 rounded-2xl bg-secondary-200/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl text-left"
			transition:fly={{ y: up ? 6 : -6, duration: 150 }}
		>
			<div>
				<div class="flex justify-between text-xs mb-2 text-white/55">
					<span class="font-bold uppercase tracking-wider">Effects</span>
					<span class="tabular-nums">{Math.round($dashSounds.volume * 100)} %</span>
				</div>
				<Range
					value={$dashSounds.volume}
					min={0}
					max={1}
					step={0.05}
					onchange={(value) => {
						dashSounds.update((s) => ({ ...s, volume: value }));
					}}
				/>
			</div>
			<div class="flex flex-col">
				{#each EFFECTS as [key, label] (key)}
					<button
						class="flex items-center justify-between h-9 px-1 text-sm cursor-pointer"
						role="switch"
						aria-checked={$dashSounds[key]}
						onclick={() => {
							dashSounds.update((s) => ({ ...s, [key]: !s[key] }));
							if ($dashSounds[key]) playDashSound(key, key === 'complete' ? 0.35 : 0.5);
						}}
					>
						<span class="text-white/85">{label}</span>
						<span
							class="relative w-9 h-5 rounded-full transition {$dashSounds[key]
								? 'bg-primary-400'
								: 'bg-white/15'}"
						>
							<span
								class="absolute top-0.5 size-4 rounded-full bg-white transition-all {$dashSounds[
									key
								]
									? 'left-[18px]'
									: 'left-0.5'}"
							></span>
						</span>
					</button>
				{/each}
			</div>
			<div class="pt-2 border-t border-white/10">
				<button
					class="w-full flex items-center justify-between h-9 px-1 text-sm cursor-pointer"
					role="switch"
					aria-checked={hitsounds}
					onclick={() => updateUserSettings({ hitsounds: !hitsounds })}
				>
					<span class="text-white/85">Beatmap hitsounds</span>
					<span
						class="relative w-9 h-5 rounded-full transition {hitsounds
							? 'bg-primary-400'
							: 'bg-white/15'}"
					>
						<span
							class="absolute top-0.5 size-4 rounded-full bg-white transition-all {hitsounds
								? 'left-[18px]'
								: 'left-0.5'}"
						></span>
					</span>
				</button>
				{#if hitsounds}
					<div class="px-1 pt-1">
						<div class="flex justify-between text-xs mb-2 text-white/55">
							<span class="font-bold uppercase tracking-wider">Hitsound volume</span>
							<span class="tabular-nums">{Math.round(hitsoundVolume * 100)} %</span>
						</div>
						<Range
							value={hitsoundVolume}
							min={0}
							max={1}
							step={0.05}
							onchange={(value) => updateUserSettings({ hitsoundVolume: value })}
						/>
					</div>
				{/if}
				<p class="px-1 pt-2 text-xs text-white/40">The music's volume is the player's.</p>
			</div>
		</div>
	{/if}
</div>
