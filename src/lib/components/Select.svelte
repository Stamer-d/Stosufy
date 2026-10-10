<script>
	import { fly } from 'svelte/transition';

	/**
	 * @type {{
	 *   options: { value: string, label: string, color?: string, icon?: string }[],
	 *   value: string,
	 *   label: string,
	 *   icon?: string,
	 *   onchange: (value: string) => void
	 * }}
	 */
	let { options, value, label, icon = '', onchange } = $props();

	let open = $state(false);
	let activeIndex = $state(0);
	let container;
	let listbox = $state();
	const id = `select-${Math.random().toString(36).slice(2, 8)}`;

	let selected = $derived(options.find((option) => option.value === value) ?? options[0]);

	function openMenu() {
		activeIndex = Math.max(
			0,
			options.findIndex((option) => option.value === value)
		);
		open = true;
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
			case 'Enter':
			case ' ':
				event.preventDefault();
				choose(options[activeIndex]);
				break;
			case 'Escape':
			case 'Tab':
				open = false;
				break;
		}
	}

	function handleWindowClick(event) {
		if (open && container && !container.contains(event.target)) open = false;
	}

	// Keep the highlighted option visible while navigating with the keyboard
	$effect(() => {
		if (open) listbox?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
	});
</script>

<svelte:window onclick={handleWindowClick} />

<div class="relative" bind:this={container}>
	<button
		type="button"
		role="combobox"
		class="h-10 flex items-center gap-2 pl-3 pr-2.5 rounded-lg bg-secondary-300 text-sm font-medium text-white whitespace-nowrap cursor-pointer transition hover:bg-secondary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 {open
			? 'bg-secondary-400'
			: ''}"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={id}
		aria-activedescendant={open ? `${id}-${activeIndex}` : undefined}
		aria-label="{label}: {selected.label}"
		onclick={() => (open ? (open = false) : openMenu())}
		onkeydown={handleKeydown}
	>
		{#if selected.color}
			<span class="size-2 rounded-full shrink-0 {selected.color}"></span>
		{:else if icon}
			<span class="{icon} size-4 shrink-0 text-secondary-600"></span>
		{/if}
		<span class="text-secondary-600">{label}:</span>
		<span>{selected.label}</span>
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
			class="absolute right-0 top-full mt-1.5 z-40 min-w-52 max-h-80 overflow-y-auto p-1.5 rounded-lg bg-secondary-300 shadow-xl shadow-black/40 ring-1 ring-white/5"
			transition:fly={{ y: -4, duration: 120 }}
		>
			{#each options as option, index (option.value)}
				{@const isSelected = option.value === value}
				<!-- svelte-ignore a11y_click_events_have_key_events (the trigger button handles the keyboard) -->
				<li
					id="{id}-{index}"
					role="option"
					aria-selected={isSelected}
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
					<span class="flex-1">{option.label}</span>
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
