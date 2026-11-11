<script>
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { goto } from '$app/navigation';
	import { widgets, WIDGET_FAMILIES, DEFAULT_WIDGETS } from '#lib/widgets.ts';
	import { ADDONS } from '#lib/addons/registry.ts';
	import { installedAddons } from '#lib/addons/store.ts';
	import { userSettings, updateHomeSettings } from '#lib/stores/user.ts';
	import { showToast } from '#lib/stores/toast.ts';

	/** @type {{ open: boolean }} */
	let { open = $bindable(false) } = $props();

	let family = $state('all');

	let placed = $derived($userSettings.settings?.home?.widgets ?? DEFAULT_WIDGETS);
	let entries = $derived(
		Object.entries($widgets).filter(([, widget]) => family === 'all' || widget.family === family)
	);
	/** Add-ons that would bring more widgets, but aren't installed */
	let more = $derived(ADDONS.filter((addon) => addon.widgets && !$installedAddons.includes(addon)));

	function add(type) {
		// New widgets start near the middle, slightly offset so they don't stack exactly
		const offset = (placed.length % 5) * 0.06;
		updateHomeSettings({
			widgets: [
				...placed,
				{ uid: `${type}-${Date.now()}`, type, x: 0.3 + offset, y: 0.25 + offset }
			]
		});
		showToast(`Added ${$widgets[type].name}`);
	}
</script>

<Modal title="Widgets" width="820px" bind:open>
	<p class="-mt-1 mb-4 text-secondary-600">
		Add widgets to your desktop, then drag them where you want them.
	</p>

	<div class="flex gap-1.5 mb-4" role="tablist" aria-label="Widget style">
		{#each [{ id: 'all', label: 'All' }, ...WIDGET_FAMILIES] as tab (tab.id)}
			<button
				role="tab"
				aria-selected={family === tab.id}
				class="px-3 h-8 rounded-full text-sm font-semibold cursor-pointer transition {family ===
				tab.id
					? 'bg-white text-black'
					: 'bg-white/[0.06] text-white/80 hover:bg-white/[0.12]'}"
				onclick={() => (family = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#each WIDGET_FAMILIES.filter((f) => family === 'all' || f.id === family) as group (group.id)}
		<section class="mb-6 last:mb-0">
			<h3 class="font-bold text-white">{group.label}</h3>
			<p class="text-xs text-secondary-600 mb-3">{group.description}</p>
			<div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
				{#each entries.filter(([, widget]) => widget.family === group.id) as [type, widget] (type)}
					{@const count = placed.filter((p) => p.type === type).length}
					<div class="rounded-xl bg-white/[0.04] ring-1 ring-white/5 overflow-hidden">
						<!-- Live preview, scaled down -->
						<div
							class="h-40 grid place-items-center overflow-hidden bg-gradient-to-br from-primary-200/40 via-secondary-300 to-secondary-200 pointer-events-none"
							aria-hidden="true"
						>
							<div style="zoom: 0.62">
								<widget.component />
							</div>
						</div>
						<div class="flex items-center gap-3 p-3">
							<div class="min-w-0 flex-1">
								<p class="font-semibold text-white truncate">{widget.name}</p>
								<p class="text-xs text-secondary-600 truncate">{widget.description}</p>
							</div>
							<button
								aria-label="Add {widget.name}"
								class="h-8 px-3 rounded-full text-sm font-semibold bg-primary-300 hover:bg-primary-400 text-white cursor-pointer transition shrink-0"
								onclick={() => add(type)}
							>
								{count ? `Add (${count})` : 'Add'}
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/each}

	{#each more as addon (addon.id)}
		<div class="mt-6 flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
			<span
				class="size-10 shrink-0 grid place-items-center rounded-lg text-white"
				style="background: linear-gradient(135deg, {addon.colors[0]}, {addon.colors[1]})"
			>
				<span class="{addon.icon} size-5"></span>
			</span>
			<div class="min-w-0 flex-1">
				<p class="font-semibold text-white">
					{addon.widgets.count} more widgets with the {addon.name} add-on
				</p>
				<p class="text-xs text-secondary-600 truncate">{addon.widgets.summary}</p>
			</div>
			<button
				class="h-8 px-3 rounded-full text-sm font-semibold bg-white/[0.08] hover:bg-white/[0.14] text-white cursor-pointer transition shrink-0"
				onclick={() => {
					open = false;
					goto('/addons');
				}}
			>
				Get it
			</button>
		</div>
	{/each}

	{#snippet footer()}
		<Button
			onclick={() => {
				updateHomeSettings({ widgets: DEFAULT_WIDGETS });
				showToast('Widgets reset');
			}}
		>
			Reset to default
		</Button>
		<Button type="primary" onclick={() => (open = false)}>Done</Button>
	{/snippet}
</Modal>
