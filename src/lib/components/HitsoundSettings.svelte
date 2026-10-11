<script>
	import { open } from '@tauri-apps/plugin-dialog';
	import Range from './Range.svelte';
	import Select from './Select.svelte';
	import Button from './Button.svelte';
	import { userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import {
		hitsoundStatus,
		listSkins,
		skinsFolder,
		forgetSkinFolders
	} from '#lib/hitsounds/player.ts';

	let settings = $derived($userSettings.settings ?? {});
	let on = $derived(settings.hitsounds ?? false);
	let skins = $state([]);
	let folder = $state(null);

	async function loadSkins() {
		folder = await skinsFolder();
		skins = await listSkins();
	}
	$effect(() => {
		settings.skinsFolder;
		loadSkins();
	});

	let skinOptions = $derived([
		{ value: '', label: 'Built-in' },
		...skins.map((skin) => ({ value: skin, label: skin }))
	]);

	async function chooseFolder() {
		const picked = await open({
			title: 'Select your osu! Skins folder',
			directory: true,
			defaultPath: folder ?? undefined
		});
		if (typeof picked !== 'string') return;
		updateUserSettings({ skinsFolder: picked });
		forgetSkinFolders();
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
			<div class="w-52 shrink-0">
				<Select
					label="Skin"
					icon="icon-[mingcute--palette-line]"
					options={skinOptions}
					value={settings.hitsoundSkin ?? ''}
					onchange={(value) => updateUserSettings({ hitsoundSkin: value || null })}
				/>
			</div>
		{/snippet}
		{@render row(
			'Skin',
			folder
				? `${skins.length} ${skins.length === 1 ? 'skin' : 'skins'} in your osu! Skins folder`
				: 'No osu! Skins folder found',
			skinSelect
		)}
		<div class="mt-1.5 flex justify-end">
			<Button type="ghost" class="text-xs h-7!" on:click={chooseFolder}>
				{folder ? 'Other Skins folder' : 'Choose Skins folder'}
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
	{/if}
</div>
