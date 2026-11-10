<script>
	// Which kinds of parts the Dash levels have, and in which of them gravity portals come up (the
	// cube and robot: upside down stretches). The cube is always there.
	import { fly } from 'svelte/transition';
	import { ALL_MODES, dashModes } from '#lib/dash/modes.ts';

	/** @type {{ labelled?: boolean }} */
	let { labelled = false } = $props();
	let open = $state(false);
	let root = $state(null);

	const NAMES = {
		cube: 'Cube',
		robot: 'Robot',
		ship: 'Ship',
		ball: 'Ball',
		ufo: 'UFO',
		wave: 'Wave',
		swing: 'Swing',
		spider: 'Spider'
	};

	let changed = $derived(
		$dashModes.off.length > 0 || $dashModes.noGravity.length > 0 || !!$dashModes.classic
	);

	/** Turns a kind of part on or off, or its gravity portals */
	function toggle(list, mode) {
		dashModes.update((s) => ({
			...s,
			[list]: s[list].includes(mode) ? s[list].filter((m) => m !== mode) : [...s[list], mode]
		}));
	}
</script>

<svelte:window onpointerdown={(e) => open && !root?.contains(e.target) && (open = false)} />

<div class="relative" bind:this={root}>
	<button
		class="relative flex items-center justify-center gap-2 h-10 {labelled
			? 'pl-3 pr-4'
			: 'w-10'} rounded-full bg-white/10 text-sm font-semibold text-white/80 hover:text-white hover:bg-white/15 cursor-pointer transition"
		title="Kinds of parts and gravity"
		aria-label="Kinds of parts and gravity"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--settings-3-line] size-5"></span>
		{#if labelled}Parts{/if}
		{#if changed}
			<span class="absolute top-1 right-1 size-2 rounded-full bg-amber-400"></span>
		{/if}
	</button>
	{#if open}
		<div
			class="absolute right-0 top-12 z-20 w-72 p-3 flex flex-col gap-2 rounded-2xl bg-secondary-200/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl text-left"
			transition:fly={{ y: -6, duration: 150 }}
		>
			<div class="flex items-center justify-between px-1 text-xs text-white/55">
				<span class="font-bold uppercase tracking-wider">Levels</span>
			</div>
			<div class="flex p-0.5 rounded-full bg-white/10 text-sm" role="radiogroup">
				{#each [{ classic: false, label: 'Blocks' }, { classic: true, label: 'Classic' }] as { classic, label } (label)}
					<button
						class="flex-1 h-7 rounded-full transition cursor-pointer {!!$dashModes.classic ===
						classic
							? 'bg-primary-400 text-white font-semibold'
							: 'text-white/60 hover:text-white'}"
						role="radio"
						aria-checked={!!$dashModes.classic === classic}
						title={classic
							? 'Cube, robot and ship parts made from the notes, the older way'
							: 'Cube, robot and ship parts built from blocks on the drums'}
						onclick={() => dashModes.update((s) => ({ ...s, classic }))}
					>
						{label}
					</button>
				{/each}
			</div>
			<div class="flex items-center justify-between px-1 pt-1 text-xs text-white/55">
				<span class="font-bold uppercase tracking-wider">Parts</span>
				<span class="flex gap-6 pr-1 font-bold uppercase tracking-wider">
					<span>On</span>
					<span>Gravity</span>
				</span>
			</div>
			{#each ALL_MODES as mode (mode)}
				{@const on = mode === 'cube' || !$dashModes.off.includes(mode)}
				{@const gravity = !$dashModes.noGravity.includes(mode)}
				<div class="flex items-center justify-between h-8 px-1 text-sm">
					<span class={on ? 'text-white/85' : 'text-white/40'}>{NAMES[mode]}</span>
					<span class="flex items-center gap-5">
						<button
							class="relative w-9 h-5 rounded-full transition {on
								? 'bg-primary-400'
								: 'bg-white/15'} {mode === 'cube' ? 'opacity-50 cursor-default' : 'cursor-pointer'}"
							role="switch"
							aria-checked={on}
							aria-label="{NAMES[mode]} parts"
							title={mode === 'cube' ? 'Every level starts and ends with the cube' : ''}
							disabled={mode === 'cube'}
							onclick={() => toggle('off', mode)}
						>
							<span
								class="absolute top-0.5 size-4 rounded-full bg-white transition-all {on
									? 'left-[18px]'
									: 'left-0.5'}"
							></span>
						</button>
						<button
							class="relative w-9 h-5 rounded-full transition cursor-pointer {gravity && on
								? 'bg-amber-400'
								: 'bg-white/15'} {on ? '' : 'opacity-40'}"
							role="switch"
							aria-checked={gravity}
							aria-label="Gravity portals in {NAMES[mode]} parts"
							onclick={() => toggle('noGravity', mode)}
						>
							<span
								class="absolute top-0.5 size-4 rounded-full bg-white transition-all {gravity
									? 'left-[18px]'
									: 'left-0.5'}"
							></span>
						</button>
					</span>
				</div>
			{/each}
			<p class="px-1 pt-1 text-xs text-white/40">
				Blocks: the cube, robot and ship parts are built from known pieces on the drums. Gravity in
				the cube and robot: stretches upside down. Which parts a difficulty has stays its own (easy
				has no wave). Levels with other settings keep their own best.
			</p>
			{#if changed}
				<button
					class="self-start px-1 text-xs font-semibold text-white/60 hover:text-white cursor-pointer"
					onclick={() => dashModes.set({ off: [], noGravity: [], classic: false })}
				>
					Back to all
				</button>
			{/if}
		</div>
	{/if}
</div>
