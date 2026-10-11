<script>
	import { open } from '@tauri-apps/plugin-dialog';
	import { open as openUrl } from '@tauri-apps/plugin-shell';
	import Range from './Range.svelte';
	import Select from './Select.svelte';
	import Button from './Button.svelte';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { hitsoundStatus } from '#lib/hitsounds/player.ts';
	import {
		listSkins,
		osuSkinsDir,
		importSkin,
		removeSkin,
		skinsChanged,
		skinTask,
		DEFAULT_SKIN,
		BUILTIN
	} from '#lib/hitsounds/skins.ts';

	let settings = $derived($userSettings.settings ?? {});
	let on = $derived(settings.hitsounds ?? false);
	let skins = $state([]);
	let osuFolder = $state(null);

	$effect(() => {
		settings.skinsFolder;
		$skinsChanged;
		osuSkinsDir().then((dir) => (osuFolder = dir));
		listSkins().then((list) => (skins = list));
	});

	let skinOptions = $derived([
		{ value: '', label: DEFAULT_SKIN },
		...skins
			.filter((skin) => !(skin.source === 'stosufy' && skin.name === DEFAULT_SKIN))
			.map((skin) => ({
				value: skin.id,
				label: skin.source === 'osu' ? `${skin.name} (osu!)` : skin.name
			})),
		{ value: BUILTIN, label: 'Simple (built-in)' }
	]);
	/** Older settings saved osu! skins by their name alone */
	let selected = $derived(
		!settings.hitsoundSkin ||
			settings.hitsoundSkin === BUILTIN ||
			settings.hitsoundSkin.includes(':')
			? (settings.hitsoundSkin ?? '')
			: `osu:${settings.hitsoundSkin}`
	);

	async function importOsk() {
		const skin = await importSkin();
		if (skin) updateUserSettings({ hitsoundSkin: skin.id });
	}

	async function removeSelected() {
		const id = selected;
		updateUserSettings({ hitsoundSkin: null });
		await removeSkin(id);
	}

	async function chooseFolder() {
		const picked = await open({
			title: 'Select your osu! Skins folder',
			directory: true,
			defaultPath: osuFolder ?? undefined
		});
		if (typeof picked !== 'string') return;
		updateUserSettings({ skinsFolder: picked });
		skinsChanged.update((n) => n + 1);
	}

	const STATUS = {
		loading: 'Loading the hitsounds…',
		ready: 'Playing with the music.',
		unavailable: null,
		error: "Couldn't load the hitsounds of this song."
	};
</script>

{#snippet row(label, description, control)}
	<div class="flex items-center justify-between gap-4 mt-3">
		<span class="min-w-0">
			<span class="block font-semibold text-white">{label}</span>
			{#if description}<span class="block text-xs text-secondary-600">{description}</span>{/if}
		</span>
		{@render control()}
	</div>
{/snippet}

{#snippet switchControl(checked, onchange, label)}
	<label class="shrink-0 cursor-pointer">
		<input
			type="checkbox"
			class="peer sr-only"
			aria-label={label}
			{checked}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		<span
			class="relative block w-10 h-6 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
		></span>
	</label>
{/snippet}

<div>
	{#snippet mainSwitch()}
		{@render switchControl(
			on,
			(checked) => updateUserSettings({ hitsounds: checked }),
			'Hitsounds'
		)}
	{/snippet}
	{@render row(
		'Hitsounds',
		on && $hitsoundStatus.state !== 'off'
			? $hitsoundStatus.state === 'unavailable'
				? `Not for this song: ${$hitsoundStatus.message?.toLowerCase()}`
				: STATUS[$hitsoundStatus.state]
			: 'Plays the beatmap’s hitsounds with the music, like watching autoplay in osu!',
		mainSwitch
	)}

	{#if on}
		<div class="mt-4">
			<div class="flex justify-between text-sm mb-2">
				<span class="font-semibold text-white">Hitsound volume</span>
				<span class="tabular-nums text-secondary-600">
					{Math.round((settings.hitsoundVolume ?? 0.8) * 100)} %
				</span>
			</div>
			<Range
				value={settings.hitsoundVolume ?? 0.8}
				min={0}
				max={1}
				step={0.05}
				on:change={(e) => updateUserSettings({ hitsoundVolume: e.detail })}
			/>
		</div>

		{#snippet skinSelect()}
			<div class="w-56 shrink-0">
				<Select
					label="Skin"
					icon="icon-[mingcute--palette-line]"
					options={skinOptions}
					value={selected}
					onchange={(value) => updateUserSettings({ hitsoundSkin: value || null })}
				/>
			</div>
		{/snippet}
		{@render row(
			'Skin',
			$skinTask.state === 'working'
				? $skinTask.message
				: 'Import any osu! skin (.osk) to hear its hitsounds',
			skinSelect
		)}
		{#if $skinTask.state === 'error'}
			<p class="mt-1.5 text-xs text-red-400">{$skinTask.message}</p>
		{/if}
		<div class="mt-2 flex flex-wrap justify-end gap-2">
			{#if selected.startsWith('stosufy:')}
				<Button type="ghost" class="text-xs h-7!" on:click={removeSelected}>Remove skin</Button>
			{/if}
			<Button
				type="ghost"
				class="text-xs h-7!"
				icon="icon-[mingcute--search-line]"
				on:click={() => openUrl('https://skins.osuck.net/')}
			>
				Find skins
			</Button>
			<Button
				type="ghost"
				class="text-xs h-7!"
				icon="icon-[mingcute--folder-open-line]"
				on:click={chooseFolder}
			>
				{osuFolder ? 'Other osu! Skins folder' : 'osu! Skins folder'}
			</Button>
			<Button
				type="normal"
				class="text-xs h-7!"
				icon="icon-[mingcute--download-2-line]"
				disabled={$skinTask.state === 'working'}
				on:click={importOsk}
			>
				Import skin (.osk)
			</Button>
		</div>

		{#snippet beatmapSwitch()}
			{@render switchControl(
				settings.beatmapHitsounds ?? true,
				(checked) => updateUserSettings({ beatmapHitsounds: checked }),
				'Beatmap hitsounds'
			)}
		{/snippet}
		{@render row(
			'Beatmap hitsounds',
			'Use the beatmap’s own samples where it has them, like osu! does',
			beatmapSwitch
		)}

		<div class="mt-4">
			<div class="flex justify-between text-sm mb-2">
				<span class="font-semibold text-white">Hitsound offset</span>
				<span class="tabular-nums text-secondary-600">
					{settings.hitsoundOffset
						? `${settings.hitsoundOffset > 0 ? '+' : ''}${settings.hitsoundOffset} ms`
						: 'In sync'}
				</span>
			</div>
			<Range
				value={settings.hitsoundOffset ?? 0}
				min={-100}
				max={100}
				step={5}
				on:change={(e) => updateUserSettings({ hitsoundOffset: e.detail })}
			/>
			<p class="mt-1.5 text-xs text-secondary-600">
				If the hitsounds come early or late, move them here.
			</p>
		</div>
		<p class="mt-4 text-[11px] text-secondary-600">
			The osu! default sounds are from ppy/osu-resources (CC BY-NC 4.0).
		</p>
	{/if}
</div>
