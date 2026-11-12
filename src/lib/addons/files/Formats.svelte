<script>
	// Formats to click (the first few as buttons, the rest in the "More" menu): what a file is
	// to become, for the converter and the editor. Nothing is chosen until one's clicked (or
	// Enter on it): the menu can be gone through with the arrow keys.
	import { tick } from 'svelte';
	import { pastRight, place } from '#lib/popover.ts';

	/**
	 * @type {{
	 *   targets: import('./formats.ts').Target[],
	 *   onpick: (id: string) => void,
	 *   label: string,
	 *   quick?: number,
	 *   disabled?: boolean
	 * }}
	 */
	let { targets, onpick, label, quick = 5, disabled = false } = $props();

	const soundOnly = (target) => target.group === 'Only the sound';
	const same = (target) => target.group === 'Same format';
	const smaller = (target) => target.group === 'Smaller';
	const nameOf = (target) => (smaller(target) ? `Smaller ${target.label}` : target.label);
	const titleOf = (target) =>
		soundOnly(target)
			? `Only the sound, as ${target.label}`
			: same(target)
				? `As ${target.label}, like it was`
				: smaller(target)
					? `A smaller ${target.label}`
					: target.id === 'unzip'
						? 'Unpack the files in it'
						: target.id === 'base64'
							? 'As Base64 text'
							: `As ${target.label}`;

	let open = $state(false);
	let up = $state(false);
	/** Lined up with its right side (no room for it to the right) */
	let right = $state(false);

	/** The formats in "More", by their group (Video, Only the sound, …) */
	let groups = $derived.by(() => {
		const all = [];
		for (const target of targets.slice(quick)) {
			const last = all.at(-1);
			if (last?.name === target.group) last.targets.push(target);
			else all.push({ name: target.group, targets: [target] });
		}
		return all;
	});
	/** How high the menu can be (px) */
	let max = $state(288);
	let box = $state();
	let menu = $state();

	async function toggle() {
		if (open) return close();
		up = false;
		right = false;
		max = 288;
		open = true;
		await tick();
		if (menu) {
			if (pastRight(menu)) right = true;
			// (under it, or above it where there's more room: not cut off by the page's edge)
			const placed = place(box, Math.min(288, menu.scrollHeight));
			up = placed.up;
			max = Math.min(288, placed.max);
		}
		menu?.querySelector('button')?.focus();
	}

	function close(refocus = false) {
		open = false;
		if (refocus) box?.querySelector('button[aria-haspopup]')?.focus();
	}

	function pick(id) {
		close();
		onpick(id);
	}

	function keys(event) {
		const items = [...menu.querySelectorAll('button')];
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

<div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
	{#each targets.slice(0, quick) as target (target.id + target.group)}
		<button
			class="h-8 px-3 flex items-center gap-1.5 rounded-full text-sm font-bold whitespace-nowrap cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-default {same(
				target
			)
				? 'bg-white text-black hover:bg-white/85'
				: 'bg-white/[0.08] hover:bg-white hover:text-black'}"
			title={titleOf(target)}
			data-target={target.id}
			{disabled}
			onclick={() => onpick(target.id)}
		>
			{#if soundOnly(target)}
				<span class="icon-[mingcute--music-2-line] size-3.5 opacity-70"></span>
			{:else if smaller(target)}
				<span class="icon-[mingcute--arrow-down-line] size-3.5 opacity-70"></span>
			{/if}
			{nameOf(target)}
		</button>
	{/each}
	{#if targets.length > quick}
		<div class="relative" bind:this={box}>
			<button
				class="h-8 pl-3 pr-2 flex items-center gap-1 rounded-full text-sm font-semibold whitespace-nowrap cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40 disabled:cursor-default {open
					? 'bg-white/15 text-white'
					: 'text-white/70 hover:text-white hover:bg-white/[0.08]'}"
				aria-label="More formats"
				aria-haspopup="menu"
				aria-expanded={open}
				{disabled}
				onclick={toggle}
			>
				More
				<span
					class="icon-[mingcute--down-line] size-3.5 transition-transform {open
						? 'rotate-180'
						: ''}"
				></span>
			</button>
			{#if open}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					bind:this={menu}
					class="absolute z-30 {right
						? 'right-0'
						: 'left-0'} min-w-52 overflow-y-auto p-1 rounded-xl bg-[#1c1c22] ring-1 ring-white/10 shadow-2xl shadow-black/60 {up
						? 'bottom-full mb-1.5'
						: 'top-full mt-1.5'}"
					style="max-height: {max}px"
					role="menu"
					tabindex="-1"
					aria-label="More formats"
					onkeydown={keys}
				>
					{#each groups as group (group.name)}
						<div role="group" aria-label={group.name}>
							<p
								class="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-white/55"
								aria-hidden="true"
							>
								{group.name}
							</p>
							{#each group.targets as target (target.id + target.group)}
								<button
									class="w-full h-8 px-3 flex items-center gap-2 rounded-lg text-left text-sm font-semibold cursor-pointer outline-none hover:bg-white/10 focus:bg-white/10"
									role="menuitem"
									data-target={target.id}
									title={titleOf(target)}
									onclick={() => pick(target.id)}
								>
									{#if soundOnly(target)}
										<span class="icon-[mingcute--music-2-line] size-3.5 opacity-60"></span>
									{/if}
									{nameOf(target)}
								</button>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
