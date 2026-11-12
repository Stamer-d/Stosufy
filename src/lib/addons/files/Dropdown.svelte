<script>
	// A choice of a few options, as a button with what's chosen, and the options in a list
	// under it (with a line of their own under each, like "plays everywhere" or "≈ 245 MB").
	// Arrow keys go through them, Enter or a click chooses, Escape closes.
	import { tick } from 'svelte';
	import { pastRight, place } from './popover.ts';

	/** @typedef {{ value: any, label: string, hint?: string, side?: string }} Choice */

	/**
	 * @type {{
	 *   options: Choice[],
	 *   value: any,
	 *   onchange: (value: any) => void,
	 *   label: string,
	 *   icon?: string,
	 *   prefix?: string,
	 *   disabled?: boolean,
	 *   sideOnButton?: boolean
	 * }}
	 */
	let {
		options,
		value,
		onchange,
		label,
		icon = '',
		prefix = '',
		disabled = false,
		sideOnButton = true
	} = $props();

	let open = $state(false);
	let up = $state(false);
	/** Lined up with its right side (no room for it to the right) */
	let right = $state(false);
	/** How high the list can be (px) */
	let max = $state(320);
	let box = $state();
	let list = $state();

	let chosen = $derived(options.find((option) => option.value === value) ?? options[0]);

	async function toggle() {
		if (open) return close();
		right = false;
		up = false;
		max = 320;
		open = true;
		await tick();
		if (list) {
			// (under it, or above it where there's more room: not cut off by the page's edge)
			const placed = place(box, Math.min(320, list.scrollHeight));
			up = placed.up;
			max = Math.min(320, placed.max);
			if (pastRight(list)) right = true;
		}
		(list?.querySelector('[aria-selected="true"]') ?? list?.querySelector('button'))?.focus();
	}

	function close(refocus = false) {
		open = false;
		if (refocus) box?.querySelector('button')?.focus();
	}

	function choose(option) {
		close(true);
		if (option.value !== value) onchange(option.value);
	}

	function keys(event) {
		const items = [...list.querySelectorAll('button')];
		const at = items.indexOf(document.activeElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const by = event.key === 'ArrowDown' ? 1 : -1;
			items[(at + by + items.length) % items.length]?.focus();
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
		} else if (event.key === 'Tab') close();
	}

	$effect(() => {
		if (!open) return;
		const outside = (event) => {
			if (!box?.contains(event.target)) close();
		};
		window.addEventListener('pointerdown', outside, true);
		return () => window.removeEventListener('pointerdown', outside, true);
	});
</script>

<div class="relative min-w-0" bind:this={box}>
	<button
		class="h-10 max-w-full pl-3 pr-2.5 flex items-center gap-2 rounded-xl text-sm cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-default {open
			? 'bg-white/15'
			: 'bg-white/[0.07] hover:bg-white/[0.12]'}"
		aria-label={label}
		aria-haspopup="listbox"
		aria-expanded={open}
		{disabled}
		onclick={toggle}
	>
		{#if icon}
			<span class="{icon} size-4 shrink-0 text-white/55"></span>
		{/if}
		{#if prefix}
			<span class="shrink-0 text-white/60">{prefix}</span>
		{/if}
		<span class="min-w-0 truncate font-semibold">{chosen?.label ?? '—'}</span>
		{#if sideOnButton && chosen?.side}
			<span class="shrink-0 text-white/55 tabular-nums">{chosen.side}</span>
		{/if}
		<span
			class="icon-[mingcute--down-line] size-4 shrink-0 text-white/55 transition-transform {open
				? 'rotate-180'
				: ''}"
		></span>
	</button>
	{#if open}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={list}
			class="absolute z-30 {right
				? 'right-0'
				: 'left-0'} min-w-full w-max max-w-[min(22rem,80vw)] overflow-y-auto p-1 rounded-xl bg-[#1c1c22] ring-1 ring-white/10 shadow-2xl shadow-black/60 {up
				? 'bottom-full mb-1.5'
				: 'top-full mt-1.5'}"
			style="max-height: {max}px"
			role="listbox"
			tabindex="-1"
			aria-label={label}
			onkeydown={keys}
		>
			{#each options as option (option.value ?? 'none')}
				{@const selected = option.value === chosen?.value}
				<button
					class="w-full px-3 py-2 flex items-center gap-3 rounded-lg text-left cursor-pointer outline-none hover:bg-white/10 focus:bg-white/10"
					role="option"
					aria-selected={selected}
					data-value={option.value ?? ''}
					onclick={() => choose(option)}
				>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold truncate">{option.label}</span>
						{#if option.hint}
							<span class="block text-xs text-white/60 truncate">{option.hint}</span>
						{/if}
					</span>
					{#if option.side}
						<span class="shrink-0 text-xs text-white/60 tabular-nums">{option.side}</span>
					{/if}
					<span
						class="icon-[mingcute--check-line] size-4 shrink-0 {selected
							? 'text-white'
							: 'invisible'}"
					></span>
				</button>
			{/each}
		</div>
	{/if}
</div>
