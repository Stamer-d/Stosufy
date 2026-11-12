<script>
	// The add-on store: the extras of Stosufy (the DJ mode, Dash, …) by category, each to
	// install and to remove again, its details a click away. What's installed is in the title
	// bar's add-ons menu (the first ones with a button of their own).
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
	/** The ones shown, by category (in the store's order) */
	let sections = $derived(
		ADDON_CATEGORIES.map((category) => ({
			...category,
			addons: shown.filter((addon) => addon.category === category.id)
		})).filter((section) => section.addons.length)
	);
	/** The add-on whose details are shown */
	let expanded = $state(/** @type {string | null} */ (null));

	function open(addon) {
		focusMode.set(false);
		openAddon(addon);
	}
</script>

<div class="px-6 pt-8 pb-12">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-extrabold tracking-tight">Add-ons</h1>
			<p class="mt-1 text-sm text-secondary-600">Extras for Stosufy, one click to install.</p>
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

	{#each sections as section (section.id)}
		<section class="mt-7" aria-labelledby="category-{section.id}">
			<h2
				id="category-{section.id}"
				class="mb-3 text-xs font-bold uppercase tracking-wider text-secondary-600"
			>
				{section.label}
			</h2>
			<div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
				{#each section.addons as addon (addon.id)}
					{@const installed = $installedAddons.includes(addon)}
					{@const busy = $installing.includes(addon.id)}
					{@const more = expanded === addon.id}
					<article
						class="flex flex-col p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5 transition hover:bg-white/[0.06]"
						aria-label={addon.name}
					>
						<div class="flex gap-3 min-w-0">
							<span
								class="size-12 shrink-0 grid place-items-center rounded-xl text-white shadow-md shadow-black/30"
								style="background: linear-gradient(135deg, {addon.colors[0]}, {addon.colors[1]})"
								aria-hidden="true"
							>
								<span class="{addon.icon} size-6"></span>
							</span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2 min-w-0">
									<h3 class="truncate font-bold text-white">{addon.name}</h3>
									{#if installed}
										<span
											class="shrink-0 flex items-center gap-1 px-1.5 h-5 rounded-full bg-emerald-400/15 text-[11px] font-bold text-emerald-300"
										>
											<span class="icon-[mingcute--check-line] size-3"></span>
											Installed
										</span>
									{/if}
								</div>
								<p class="mt-0.5 text-sm text-white/70 line-clamp-2">{addon.summary}</p>
							</div>
						</div>

						{#if more}
							<div id="details-{addon.id}" class="mt-3 text-sm">
								<p class="text-secondary-600">{addon.description}</p>
								<ul class="mt-2 space-y-1 text-white/75">
									{#each addon.highlights as highlight (highlight)}
										<li class="flex gap-2">
											<span
												class="icon-[mingcute--check-line] size-4 mt-0.5 shrink-0 text-primary-500"
											></span>
											{highlight}
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						<div class="mt-3 flex items-center gap-2">
							{#if installed}
								<button
									class="h-8 px-4 rounded-full text-sm font-semibold bg-white text-black hover:bg-white/90 cursor-pointer transition"
									onclick={() => open(addon)}
								>
									Open
								</button>
							{:else}
								<button
									class="h-8 px-4 flex items-center gap-1.5 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition disabled:opacity-60 disabled:cursor-default"
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
							<button
								class="h-8 px-3 flex items-center gap-1 rounded-full text-sm font-semibold text-white/70 hover:text-white hover:bg-white/[0.08] cursor-pointer transition"
								aria-expanded={more}
								aria-controls="details-{addon.id}"
								onclick={() => (expanded = more ? null : addon.id)}
							>
								{more ? 'Less' : 'More'}
								<span
									class="icon-[mingcute--down-line] size-4 transition-transform {more
										? 'rotate-180'
										: ''}"
								></span>
							</button>
							{#if installed}
								<button
									class="ml-auto size-8 grid place-items-center rounded-full text-white/55 hover:text-red-200 hover:bg-red-500/20 cursor-pointer transition"
									title="Uninstall (what it saved stays)"
									onclick={() => uninstallAddon(addon.id)}
								>
									<span class="icon-[mingcute--delete-2-line] size-4"></span>
									<span class="sr-only">Uninstall {addon.name}</span>
								</button>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		</section>
	{/each}

	<p class="mt-8 text-xs text-secondary-600">
		Removing an add-on keeps what it saved. Your add-ons follow your account to your other
		computers.
	</p>
</div>
