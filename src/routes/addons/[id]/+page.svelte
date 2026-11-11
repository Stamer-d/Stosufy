<script>
	// The page of an add-on (the puzzle, the world center). Its code is loaded when the page
	// is first opened; an add-on that isn't installed can be installed from here.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { addonById } from '#lib/addons/registry.ts';
	import { installedAddons, installing, installAddon } from '#lib/addons/store.ts';

	let addon = $derived(addonById(page.params.id));
	let installed = $derived(!!addon && $installedAddons.includes(addon));
	let busy = $derived(!!addon && $installing.includes(addon.id));

	let View = $state(null);
	let failed = $state(false);
	let attempt = $state(0);
	$effect(() => {
		void attempt;
		View = null;
		failed = false;
		if (!addon?.page || !installed) return;
		let current = true;
		addon
			.page()
			.then((module) => {
				if (current) View = module.default;
			})
			.catch((error) => {
				console.error(`Could not open ${addon.id}:`, error);
				if (current) failed = true;
			});
		return () => {
			current = false;
		};
	});
</script>

{#if View}
	<View />
{:else if !addon?.page || !installed || failed}
	<div class="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
		{#if !addon?.page}
			<span class="icon-[mingcute--classify-add-2-line] size-10 text-secondary-600"></span>
			<p class="text-lg font-semibold">This add-on doesn't exist</p>
		{:else}
			<span
				class="size-16 mb-2 grid place-items-center rounded-2xl text-white shadow-lg shadow-black/30"
				style="background: linear-gradient(135deg, {addon.colors[0]}, {addon.colors[1]})"
			>
				<span class="{addon.icon} size-9"></span>
			</span>
			{#if failed}
				<p class="text-lg font-semibold">{addon.name} couldn't be opened</p>
				<p class="text-sm text-secondary-600">Something went wrong loading it.</p>
			{:else}
				<p class="text-lg font-semibold">{addon.name} isn't installed</p>
				<p class="max-w-md text-sm text-secondary-600">{addon.summary}</p>
			{/if}
		{/if}
		<div class="mt-3 flex gap-2">
			{#if addon?.page && failed}
				<button
					class="h-9 px-4 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition"
					onclick={() => attempt++}
				>
					Try again
				</button>
			{:else if addon?.page}
				<button
					class="h-9 px-4 flex items-center gap-2 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition disabled:opacity-60 disabled:cursor-default"
					disabled={busy}
					onclick={() => installAddon(addon.id)}
				>
					<span
						class="{busy
							? 'icon-[mingcute--loading-line] animate-spin'
							: 'icon-[mingcute--download-2-line]'} size-4"
					></span>
					{busy ? 'Installing…' : 'Install'}
				</button>
			{/if}
			<button
				class="h-9 px-4 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/[0.14] text-white cursor-pointer transition"
				onclick={() => goto('/addons')}
			>
				All add-ons
			</button>
		</div>
	</div>
{/if}
