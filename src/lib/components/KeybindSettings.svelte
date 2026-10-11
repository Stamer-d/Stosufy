<script>
	import Button from './Button.svelte';
	import {
		KEYBIND_ACTIONS,
		currentKeybinds,
		keybindFromEvent,
		keybindLabel,
		setKeybind,
		resetKeybinds,
		recordingKeybind,
		keybindErrors
	} from '#lib/stores/keybinds.ts';

	let binds = $derived($currentKeybinds);
	let groups = $derived([...new Set(KEYBIND_ACTIONS.map((action) => action.group))]);
	/** The shortcut being recorded: { action, scope } */
	let recording = $state(null);
	/** Says which action lost its shortcut to the new one */
	let notice = $state('');

	function record(action, scope) {
		recording = { action, scope };
		notice = '';
		recordingKeybind.set(true);
	}

	function stop() {
		recording = null;
		recordingKeybind.set(false);
	}

	function onKeydown(event) {
		if (!recording) return;
		// Before the settings window sees it (Escape would close it)
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.code === 'Escape') return stop();
		const bind =
			['Backspace', 'Delete'].includes(event.code) && !event.ctrlKey && !event.altKey
				? null
				: keybindFromEvent(event);
		if (bind === null && !['Backspace', 'Delete'].includes(event.code)) return;
		const taken = setKeybind(recording.scope, recording.action, bind);
		if (taken) {
			const label = KEYBIND_ACTIONS.find((action) => action.id === taken)?.label;
			notice = `${keybindLabel(bind).join(' + ')} was used for “${label}”, which now has no shortcut.`;
		}
		stop();
	}

	// Stop recording when the settings close
	$effect(() => () => recordingKeybind.set(false));
</script>

<svelte:window onkeydowncapture={onKeydown} />

{#snippet keys(bind)}
	{#each keybindLabel(bind) as key, index (index)}
		{#if index}<span class="text-secondary-600">+</span>{/if}
		<kbd
			class="min-w-6 h-6 px-1.5 grid font-sans place-items-center rounded bg-white/10 text-xs font-semibold text-white shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]"
			>{key}</kbd
		>
	{/each}
{/snippet}

{#snippet cell(action, scope)}
	{@const bind = binds[scope][action.id]}
	{@const active = recording?.action === action.id && recording?.scope === scope}
	{@const error = scope === 'global' && $keybindErrors[action.id]}
	<button
		class="h-9 w-full px-2 flex items-center justify-center gap-1 rounded-md ring-1 cursor-pointer transition {active
			? 'ring-primary-500 bg-primary-500/10'
			: error
				? 'ring-red-500/50 hover:bg-white/5'
				: 'ring-white/10 hover:bg-white/5'}"
		title={error ? `Couldn't set it: another app may use it` : 'Click to change'}
		aria-label="{action.label} ({scope === 'app' ? 'in Stosufy' : 'everywhere'})"
		onclick={() => (active ? stop() : record(action.id, scope))}
	>
		{#if active}
			<span class="text-xs text-primary-500 animate-pulse">Press keys…</span>
		{:else if bind}
			{@render keys(bind)}
			{#if error}<span class="icon-[mingcute--warning-line] size-4 text-red-400"></span>{/if}
		{:else}
			<span class="text-xs text-secondary-600">—</span>
		{/if}
	</button>
{/snippet}

<div class="flex flex-col gap-5">
	<p class="text-xs text-secondary-600">
		Click a shortcut and press the new keys. <kbd class="font-sans text-white/80">Backspace</kbd>
		removes it,
		<kbd class="font-sans text-white/80">Esc</kbd> cancels. Shortcuts under “Everywhere” also work while
		Stosufy is in the background, e.g. in osu!.
	</p>

	{#if notice}
		<p class="-mt-2 text-xs text-yellow-300" aria-live="polite">{notice}</p>
	{/if}

	{#each groups as group (group)}
		<section>
			<div
				class="grid grid-cols-[1fr_9.5rem_9.5rem] gap-2 items-end mb-2 text-xs font-bold uppercase tracking-wider text-secondary-600"
			>
				<h3>{group}</h3>
				<span class="text-center">In Stosufy</span>
				<span class="text-center">Everywhere</span>
			</div>
			<ul class="flex flex-col gap-1">
				{#each KEYBIND_ACTIONS.filter((action) => action.group === group) as action (action.id)}
					<li class="grid grid-cols-[1fr_9.5rem_9.5rem] gap-2 items-center">
						<span class="text-sm text-white">{action.label}</span>
						{@render cell(action, 'app')}
						{@render cell(action, 'global')}
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<div>
		<Button
			type="ghost"
			icon="icon-[mingcute--refresh-2-line]"
			on:click={() => {
				resetKeybinds();
				notice = '';
			}}
		>
			Reset to defaults
		</Button>
	</div>
</div>
