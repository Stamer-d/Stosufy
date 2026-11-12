<script>
	// A choice of a few options: a button with what's chosen ("Sort: Relevance"), the options in
	// a list under it (above it, where there's more room there), each maybe with a line under
	// it ("plays everywhere") and something on its right ("≈ 245 MB"). The keyboard stays on
	// the button: the arrow keys go through the options, Enter or Space chooses, Escape closes.
	// The app's one choice of this kind (the add-ons' too).
	import { fly } from 'svelte/transition';
	import { place } from '#lib/popover.ts';

	/**
	 * @typedef {{
	 *   value: any,
	 *   label: string,
	 *   color?: string,
	 *   icon?: string,
	 *   hint?: string,
	 *   side?: string
	 * }} Choice
	 */

	/**
	 * @type {{
	 *   options: Choice[],
	 *   value: any,
	 *   label: string,
	 *   icon?: string,
	 *   hideLabel?: boolean,
	 *   sideOnButton?: boolean,
	 *   disabled?: boolean,
	 *   onchange: (value: any) => void
	 * }}
	 */
	let {
		options,
		value,
		label,
		icon = '',
		hideLabel = false,
		sideOnButton = true,
		disabled = false,
		onchange
	} = $props();

	let open = $state(false);
	/** It opens to the right, where to the left there's no room for it */
	let toRight = $state(false);
	/** It opens above the button (more room there) */
	let up = $state(false);
	/** How high the list can be (px) */
	let max = $state(320);
	let activeIndex = $state(0);
	let container;
	let listbox = $state();
	const id = `select-${Math.random().toString(36).slice(2, 8)}`;

	let selected = $derived(options.find((option) => option.value === value) ?? options[0]);
	let hinted = $derived(options.some((option) => option.hint || option.side));

	function openMenu() {
		if (disabled) return;
		activeIndex = Math.max(
			0,
			options.findIndex((option) => option.value === value)
		);
		toRight = !roomLeft(container.getBoundingClientRect().right - MENU_WIDTH);
		// (about as high as it'll be: its options, at most 320 px)
		const placed = place(container, Math.min(320, options.length * (hinted ? 52 : 36) + 12));
		up = placed.up;
		max = Math.min(320, placed.max);
		open = true;
	}

	/** The menu's least width (min-w-52) */
	const MENU_WIDTH = 208;
	/**
	 * Whether something starting at `left` is still on the page: the scrolling page cuts off
	 * what goes past its left edge (it would go under the library next to it)
	 */
	function roomLeft(left) {
		const page = container?.closest('[data-scroll-container]');
		return left >= (page ? page.getBoundingClientRect().left : 0) + 8;
	}

	function choose(option) {
		open = false;
		if (option.value !== value) onchange(option.value);
	}

	function handleKeydown(event) {
		if (!open) {
			if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
				event.preventDefault();
				openMenu();
			}
			return;
		}
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				activeIndex = (activeIndex + 1) % options.length;
				break;
			case 'ArrowUp':
				event.preventDefault();
				activeIndex = (activeIndex - 1 + options.length) % options.length;
				break;
			case 'Home':
			case 'End':
				event.preventDefault();
				activeIndex = event.key === 'Home' ? 0 : options.length - 1;
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				choose(options[activeIndex]);
				break;
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				open = false;
				break;
			case 'Tab':
				open = false;
				break;
		}
	}

	function handleWindowClick(event) {
		if (open && container && !container.contains(event.target)) open = false;
	}

	// Wider than thought (long options): to the right after all
	$effect(() => {
		if (open && listbox && !toRight && !roomLeft(listbox.getBoundingClientRect().left))
			toRight = true;
	});

	// Keep the highlighted option visible while navigating with the keyboard
	$effect(() => {
		if (open) listbox?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative max-w-full min-w-0" bind:this={container}>
	<button
		type="button"
		role="combobox"
		class="h-10 max-w-full flex items-center gap-2 pl-3 pr-2.5 rounded-lg bg-secondary-300 text-sm font-medium text-white whitespace-nowrap cursor-pointer transition hover:bg-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-40 disabled:cursor-default {open
			? 'bg-secondary-400'
			: ''}"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id}
		aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
		aria-label="{label}: {selected?.label ?? ''}"
		{disabled}
		onclick={() => (open ? (open = false) : openMenu())}
		onkeydown={handleKeydown}
	>
		{#if selected?.color}
			<span class="size-2 rounded-full shrink-0 {selected.color}"></span>
		{:else if icon}
			<span class="{icon} size-4 shrink-0 text-secondary-600"></span>
		{/if}
		{#if !hideLabel}
			<span class="shrink-0 text-secondary-600">{label}:</span>
		{/if}
		<!-- (a long one is cut short where the select has no more room) -->
		<span class="min-w-0 truncate" title={selected?.label}>{selected?.label ?? '—'}</span>
		{#if sideOnButton && selected?.side}
			<span class="shrink-0 text-secondary-600 tabular-nums">{selected.side}</span>
		{/if}
		<span
			class="icon-[fa6-solid--chevron-down] size-3 shrink-0 text-secondary-600 transition-transform duration-150 {open
				? 'rotate-180'
				: ''}"
		></span>
	</button>

	{#if open}
		<ul
			{id}
			bind:this={listbox}
			role="listbox"
			aria-label={label}
			class="absolute {toRight ? 'left-0' : 'right-0'} {up
				? 'bottom-full mb-1.5'
				: 'top-full mt-1.5'} z-40 min-w-52 w-max max-w-[min(24rem,80vw)] overflow-y-auto p-1.5 rounded-lg bg-secondary-300 shadow-xl shadow-black/40 ring-1 ring-white/5"
			style="max-height: {max}px"
			transition:fly={{ y: up ? 4 : -4, duration: 120 }}
		>
			{#each options as option, index (option.value ?? '')}
				{@const isSelected = option.value === value}
				<!-- svelte-ignore a11y_click_events_have_key_events (the trigger button handles the keyboard) -->
				<li
					id="{id}-{index}"
					role="option"
					aria-selected={isSelected}
					data-value={option.value ?? ''}
					class="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm cursor-pointer select-none {index ===
					activeIndex
						? 'bg-secondary-400'
						: ''} {isSelected ? 'text-white font-medium' : 'text-gray-300'}"
					onmouseenter={() => (activeIndex = index)}
					onclick={() => choose(option)}
				>
					{#if option.color}
						<span class="size-2 rounded-full shrink-0 {option.color}"></span>
					{:else if option.icon}
						<span class="{option.icon} size-4 shrink-0 text-secondary-600"></span>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="block truncate">{option.label}</span>
						{#if option.hint}
							<span class="block truncate text-xs font-normal text-secondary-600"
								>{option.hint}</span
							>
						{/if}
					</span>
					{#if option.side}
						<span class="shrink-0 text-xs text-secondary-600 tabular-nums">{option.side}</span>
					{/if}
					<span
						class="icon-[fa6-solid--check] size-3 shrink-0 text-primary-500 {isSelected
							? ''
							: 'invisible'}"
					></span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
