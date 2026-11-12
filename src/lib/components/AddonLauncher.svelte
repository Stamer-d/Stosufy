<script>
	// The add-ons in the title bar: one button, and the installed ones in a grid under it (each
	// opened from there, or pinned to a button of its own in the title bar), with the way to the
	// add-on store. With none installed, it goes straight to the store.
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { installedAddons, openAddon, pinnedAddons, togglePin } from '#lib/addons/store.ts';
	import { openOverlay } from '#lib/addons/overlay.ts';
	import { focusMode } from '#lib/stores/audio.ts';
	import { ms } from '#lib/addons/files/motion.ts';

	/** @type {{ go: (path: string) => void }} */
	let { go } = $props();

	let open = $state(false);
	let box = $state();
	let panel = $state();

	const active = (addon) =>
		addon.overlay ? $openOverlay === addon.id : page.url.pathname === `/addons/${addon.id}`;
	let inStore = $derived(page.url.pathname === '/addons');

	async function toggle() {
		if (!$installedAddons.length) return go('/addons');
		open = !open;
		if (!open) return;
		await tick();
		panel?.querySelector('button')?.focus();
	}

	function close(refocus = false) {
		open = false;
		if (refocus) box?.querySelector('button')?.focus();
	}

	function launch(addon) {
		close();
		focusMode.set(false);
		openAddon(addon);
	}

	$effect(() => {
		if (!open) return;
		const outside = (event) => {
			if (!box?.contains(event.target)) close();
		};
		const keys = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close(true);
			}
		};
		window.addEventListener('pointerdown', outside, true);
		window.addEventListener('keydown', keys);
		return () => {
			window.removeEventListener('pointerdown', outside, true);
			window.removeEventListener('keydown', keys);
		};
	});
</script>

<div class="relative" bind:this={box}>
	<button
		title="Add-ons"
		aria-label="Add-ons"
		aria-haspopup={$installedAddons.length ? 'dialog' : undefined}
		aria-expanded={$installedAddons.length ? open : undefined}
		class="size-8 grid place-items-center rounded-full hover:bg-secondary-300 cursor-pointer transition {open ||
		inStore
			? 'text-primary-500'
			: 'text-secondary-600 hover:text-white'}"
		onclick={toggle}
	>
		<span class="icon-[mingcute--classify-add-2-line] size-[18px]"></span>
	</button>
	{#if open}
		<div
			bind:this={panel}
			class="absolute left-0 top-full mt-2 z-50 w-80 p-2 rounded-xl bg-secondary-200 ring-1 ring-white/10 shadow-2xl shadow-black/50"
			role="dialog"
			aria-label="Add-ons"
			transition:fly={{ y: -4, duration: ms(120) }}
		>
			<ul class="grid grid-cols-3 gap-1">
				{#each $installedAddons as addon (addon.id)}
					{@const pinned = $pinnedAddons.includes(addon)}
					<li class="relative group">
						<button
							class="w-full flex flex-col items-center gap-1.5 px-1 pt-2.5 pb-2 rounded-lg cursor-pointer transition outline-none hover:bg-white/[0.08] focus-visible:bg-white/[0.08] {active(
								addon
							)
								? 'bg-white/[0.08]'
								: ''}"
							title={addon.summary}
							onclick={() => launch(addon)}
						>
							<span
								class="size-10 grid place-items-center rounded-xl text-white shadow-md shadow-black/30"
								style="background: linear-gradient(135deg, {addon.colors[0]}, {addon.colors[1]})"
							>
								<span class="{addon.icon} size-5"></span>
							</span>
							<span class="w-full truncate text-center text-xs font-semibold">{addon.name}</span>
						</button>
						<button
							class="absolute top-1 right-1 size-6 grid place-items-center rounded-full cursor-pointer transition outline-none focus-visible:ring-2 focus-visible:ring-white/70 {pinned
								? 'text-primary-400 bg-black/30'
								: 'text-white/60 bg-black/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'} hover:text-white"
							aria-label="{pinned ? 'Unpin' : 'Pin'} {addon.name}"
							aria-pressed={pinned}
							title={pinned ? 'Take it off the title bar' : 'Put it in the title bar'}
							onclick={() => togglePin(addon.id)}
						>
							<span
								class="{pinned
									? 'icon-[mingcute--pin-fill]'
									: 'icon-[mingcute--pin-line]'} size-3.5"
							></span>
						</button>
					</li>
				{/each}
			</ul>
			<button
				class="mt-1 w-full h-9 flex items-center justify-center gap-2 rounded-lg text-sm font-semibold text-white/80 hover:text-white hover:bg-white/[0.08] cursor-pointer transition outline-none focus-visible:bg-white/[0.08]"
				onclick={() => {
					close();
					go('/addons');
				}}
			>
				<span class="icon-[mingcute--store-2-line] size-4"></span>
				Add-on store
			</button>
		</div>
	{/if}
</div>
