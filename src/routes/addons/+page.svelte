<script>
	// The add-on store: the extras of Stosufy (the DJ mode, Dash, …), each to install and to
	// remove again. What's installed gets its button in the title bar.
	import { ADDONS, ADDON_CATEGORIES } from '#lib/addons/registry.ts';
	import {
		installedAddons,
		installing,
		installAddon,
		uninstallAddon,
		openAddon
	} from '#lib/addons/store.ts';
	import { focusMode } from '#lib/stores/audio.ts';

	let filter = $state(/** @type {'all' | 'installed'} */ ('all'));
	let shown = $derived(
		filter === 'installed' ? ADDONS.filter((addon) => $installedAddons.includes(addon)) : ADDONS
	);
	/** @type {{ id: 'all' | 'installed', label: string, count: number }[]} */
	let filters = $derived([
		{ id: 'all', label: 'All', count: ADDONS.length },
		{ id: 'installed', label: 'Installed', count: $installedAddons.length }
	]);
	const categoryOf = (addon) =>
		ADDON_CATEGORIES.find((category) => category.id === addon.category)?.label;

	function open(addon) {
		focusMode.set(false);
		openAddon(addon);
	}
</script>

<div class="px-6 pt-10 pb-12">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight">Add-ons</h1>
			<p class="mt-1 text-sm text-secondary-600">
				Extras for Stosufy. Install the ones you want; each gets its button in the title bar.
			</p>
		</div>
		<div class="flex p-1 rounded-full bg-white/[0.06]" role="group" aria-label="Show">
			{#each filters as option (option.id)}
				<button
					aria-pressed={filter === option.id}
					class="h-7 px-3 rounded-full text-sm font-semibold cursor-pointer transition {filter ===
					option.id
						? 'bg-white text-black'
						: 'text-white/70 hover:text-white'}"
					onclick={() => (filter = option.id)}
				>
					{option.label}
					<span class="ml-0.5 opacity-60 tabular-nums">{option.count}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if !shown.length}
		<div class="flex flex-col items-center gap-2 py-20 text-center">
			<span class="icon-[mingcute--classify-add-2-line] size-10 text-secondary-600"></span>
			<p class="text-lg font-semibold">No add-ons installed yet</p>
			<p class="text-sm text-secondary-600">Pick the ones you like, they're one click away.</p>
			<button
				class="mt-2 h-9 px-4 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition"
				onclick={() => (filter = 'all')}
			>
				Browse all add-ons
			</button>
		</div>
	{/if}

	<div class="mt-6 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">
		{#each shown as addon (addon.id)}
			{@const installed = $installedAddons.includes(addon)}
			{@const busy = $installing.includes(addon.id)}
			<article
				class="flex flex-col rounded-xl bg-white/[0.04] ring-1 ring-white/5 overflow-hidden"
				aria-label={addon.name}
			>
				<div
					class="relative h-32 overflow-hidden"
					style="background: linear-gradient(135deg, {addon.colors[0]}, {addon.colors[1]})"
					aria-hidden="true"
				>
					<span class="{addon.icon} absolute -right-6 -bottom-10 size-44 text-white/15 -rotate-12"
					></span>
					<span
						class="absolute left-4 bottom-4 size-14 grid place-items-center rounded-2xl bg-black/25 backdrop-blur-sm text-white shadow-lg shadow-black/20"
					>
						<span class="{addon.icon} size-8"></span>
					</span>
					<span
						class="absolute left-4 top-3 px-2 h-5 grid place-items-center rounded-full bg-black/25 text-[11px] font-bold uppercase tracking-wider text-white/90"
					>
						{categoryOf(addon)}
					</span>
				</div>

				<div class="flex-1 flex flex-col p-4">
					<div class="flex items-center gap-2">
						<h2 class="text-lg font-bold text-white">{addon.name}</h2>
						{#if installed}
							<span
								class="flex items-center gap-1 px-2 h-5 rounded-full bg-emerald-400/15 text-[11px] font-bold text-emerald-300"
							>
								<span class="icon-[mingcute--check-line] size-3"></span>
								Installed
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-sm font-medium text-white/80">{addon.summary}</p>
					<p class="mt-2 text-sm text-secondary-600">{addon.description}</p>
					<ul class="mt-3 mb-4 space-y-1.5 text-sm text-white/75">
						{#each addon.highlights as highlight (highlight)}
							<li class="flex gap-2">
								<span class="icon-[mingcute--check-line] size-4 mt-0.5 shrink-0 text-primary-500"
								></span>
								{highlight}
							</li>
						{/each}
					</ul>

					<div class="mt-auto flex gap-2">
						{#if installed}
							<button
								class="flex-1 h-9 rounded-full text-sm font-semibold bg-white text-black hover:bg-white/90 cursor-pointer transition"
								onclick={() => open(addon)}
							>
								Open
							</button>
							<button
								class="h-9 px-4 rounded-full text-sm font-semibold bg-white/[0.08] text-white/80 hover:bg-red-500/20 hover:text-red-200 cursor-pointer transition"
								onclick={() => uninstallAddon(addon.id)}
							>
								Uninstall
							</button>
						{:else}
							<button
								class="flex-1 h-9 flex items-center justify-center gap-2 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition disabled:opacity-60 disabled:cursor-default"
								disabled={busy}
								onclick={() => installAddon(addon.id)}
							>
								{#if busy}
									<span class="icon-[mingcute--loading-line] size-4 animate-spin"></span>
									Installing…
								{:else}
									<span class="icon-[mingcute--download-2-line] size-4"></span>
									Install
								{/if}
							</button>
						{/if}
					</div>
				</div>
			</article>
		{/each}
	</div>

	<p class="mt-6 text-xs text-secondary-600">
		Removing an add-on keeps what it saved (records, settings, placed widgets): it's all back when
		you install it again. Your add-ons follow your account to your other computers.
	</p>
</div>
