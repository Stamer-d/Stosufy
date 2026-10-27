<script>
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Range from './Range.svelte';
	import { refresh as refreshVolume } from '#lib/stores/mixer.ts';
	import { settingsTab } from '#lib/stores/settings.ts';
	import { setPlaybackMod } from '#lib/stores/audio.ts';
	import { MODS } from '#lib/stores/mods.ts';
	import {
		userSettings,
		updateUserSettings,
		updateHomeSettings,
		updateAppearance,
		homeSettings,
		DEFAULT_APPEARANCE
	} from '#lib/stores/user.ts';
	import { mapDataStore, videoFetch, fetchMissingVideos } from '#lib/stores/data.ts';
	import {
		osuImport,
		importOsuFolder,
		pickOsuSongsFolder,
		defaultOsuSongsFolder
	} from '#lib/stores/osuImport.ts';
	import { osuFolder as findOsuFolder } from '#lib/stores/osuFolder.ts';
	import { profileImportOpen } from '#lib/stores/osuProfile.ts';
	import { keyStore, sessionKeyNeeded } from '#lib/stores/auth.ts';
	import VisibilityPicker from './VisibilityPicker.svelte';
	import KeybindSettings from './KeybindSettings.svelte';
	import HitsoundSettings from './HitsoundSettings.svelte';
	import EqualizerSettings from './EqualizerSettings.svelte';

	// The osu! folder (chosen, or found where osu! usually is): its songs and skins
	let osuRoot = $state(null);
	let osuFolder = $state(null);
	$effect(() => {
		void $userSettings.settings?.osuFolder;
		findOsuFolder().then((folder) => (osuRoot = folder));
		defaultOsuSongsFolder().then((folder) => (osuFolder = folder));
	});

	async function chooseOsuFolder() {
		const folder = await pickOsuSongsFolder();
		if (folder) {
			osuFolder = folder;
			importOsuFolder(folder);
		}
	}
	/** @type {import('#lib/types.ts').PlaybackMod[]} */
	const MOD_OPTIONS = ['NM', 'HT', 'DC', 'DT', 'NC'];
	let crossfade = $derived($userSettings.settings?.crossfade ?? 0);
	let importing = $derived(['scanning', 'details'].includes($osuImport.state));

	/** @type {{ id: import('#lib/stores/settings.ts').SettingsTab, label: string, icon: string }[]} */
	const TABS = [
		{ id: 'home', label: 'Home', icon: 'icon-[mingcute--home-4-line]' },
		{ id: 'appearance', label: 'Appearance', icon: 'icon-[mingcute--palette-line]' },
		{ id: 'playback', label: 'Playback', icon: 'icon-[mingcute--play-circle-line]' },
		{ id: 'library', label: 'Library', icon: 'icon-[mingcute--folder-open-line]' },
		{ id: 'shortcuts', label: 'Shortcuts', icon: 'icon-[mingcute--keyboard-line]' }
	];

	const SECTION_LABELS = {
		hero: 'Featured banner (classic)',
		playlists: 'Your playlists',
		recent: 'Recently played',
		mixes: 'Made for you',
		discover: 'Discover beatmaps'
	};
	/** @type {{ value: import('#lib/types.ts').HomeSettings['layout'], label: string, description: string, icon: string }[]} */
	const LAYOUTS = [
		{
			value: 'desktop',
			label: 'Desktop',
			description: 'Beatmap wallpaper with widgets',
			icon: 'icon-[mingcute--computer-line]'
		},
		{
			value: 'classic',
			label: 'Classic',
			description: 'Banner and lists',
			icon: 'icon-[mingcute--layout-line]'
		}
	];

	/** @type {{ value: import('#lib/types.ts').HomeSettings['heroBackground'], label: string }[]} */
	const HERO_OPTIONS = [
		{ value: 'current', label: 'Current song' },
		{ value: 'random', label: 'Random' },
		{ value: 'pinned', label: 'Pinned' }
	];
	/** @type {{ value: import('#lib/types.ts').AccentColor, label: string, color: string }[]} */
	const ACCENTS = [
		{ value: 'violet', label: 'Violet', color: 'oklch(0.57 0.21 295)' },
		{ value: 'pink', label: 'osu! pink', color: 'oklch(0.66 0.2 355)' },
		{ value: 'blue', label: 'Blue', color: 'oklch(0.6 0.16 240)' },
		{ value: 'teal', label: 'Teal', color: 'oklch(0.6 0.12 185)' },
		{ value: 'orange', label: 'Orange', color: 'oklch(0.66 0.17 50)' }
	];

	let home = $derived(homeSettings($userSettings.settings?.home));
	let appearance = $derived({ ...DEFAULT_APPEARANCE, ...$userSettings.settings?.appearance });
	let pinnedSong = $derived(home.pinnedSetId ? $mapDataStore[home.pinnedSetId] : null);

	function moveSection(index, direction) {
		const sections = [...home.sections];
		const [section] = sections.splice(index, 1);
		sections.splice(index + direction, 0, section);
		updateHomeSettings({ sections });
	}

	function toggleSection(index) {
		updateHomeSettings({
			sections: home.sections.map((section, i) =>
				i === index ? { ...section, visible: !section.visible } : section
			)
		});
	}
</script>

{#snippet toggle(label, description, checked, onchange)}
	<label class="flex items-center justify-between gap-4 cursor-pointer mt-3 first-of-type:mt-0">
		<span>
			<span class="block font-semibold text-white">{label}</span>
			<span class="block text-xs text-secondary-600">{description}</span>
		</span>
		<input
			type="checkbox"
			class="peer sr-only"
			{checked}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		<span
			class="relative w-10 h-6 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
		></span>
	</label>
{/snippet}

{#snippet heading(text)}
	<h3 class="text-xs font-bold uppercase tracking-wider text-secondary-600 mb-2">{text}</h3>
{/snippet}

<Modal
	title="Settings"
	width="720px"
	bind:open={() => $settingsTab !== null, (value) => !value && settingsTab.set(null)}
>
	<div class="flex gap-6 min-h-[26rem]">
		<nav class="w-40 shrink-0 flex flex-col gap-1" aria-label="Settings categories">
			{#each TABS as tab (tab.id)}
				{@const active = $settingsTab === tab.id}
				<button
					aria-current={active ? 'page' : undefined}
					class="flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-semibold text-start cursor-pointer transition {active
						? 'bg-white/10 text-white'
						: 'text-secondary-600 hover:text-white hover:bg-white/[0.05]'}"
					onclick={() => settingsTab.set(tab.id)}
				>
					<span class="{tab.icon} size-[18px] {active ? 'text-primary-500' : ''}"></span>
					{tab.label}
				</button>
			{/each}
		</nav>
		<div class="flex-1 min-w-0 flex flex-col gap-6 py-1">
			{#if $settingsTab === 'home'}
				<section>
					{@render heading('Home layout')}
					<div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Home layout">
						{#each LAYOUTS as option (option.value)}
							{@const active = home.layout === option.value}
							<button
								role="radio"
								aria-checked={active}
								class="flex items-start gap-3 p-3 rounded-lg text-start cursor-pointer transition ring-1 {active
									? 'bg-primary-300/15 ring-primary-400'
									: 'bg-white/[0.04] ring-transparent hover:bg-white/[0.08]'}"
								onclick={() => updateHomeSettings({ layout: option.value })}
							>
								<span
									class="{option.icon} size-5 shrink-0 mt-0.5 {active
										? 'text-primary-500'
										: 'text-secondary-600'}"
								></span>
								<span>
									<span class="block font-semibold text-white">{option.label}</span>
									<span class="block text-xs text-secondary-600">{option.description}</span>
								</span>
							</button>
						{/each}
					</div>
				</section>

				<section>
					{@render heading('Home sections')}
					<ul class="flex flex-col gap-1">
						{#each home.sections as section, index (section.id)}
							<li
								class="flex items-center gap-2 h-11 pl-3 pr-1.5 rounded-lg bg-white/[0.04] {section.visible
									? 'text-white'
									: 'text-secondary-600'}"
							>
								<span class="flex-1 font-semibold">{SECTION_LABELS[section.id]}</span>
								<button
									title="Move up"
									aria-label="Move {SECTION_LABELS[section.id]} up"
									disabled={index === 0}
									class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
									onclick={() => moveSection(index, -1)}
								>
									<span class="icon-[mingcute--arrow-up-line] size-4"></span>
								</button>
								<button
									title="Move down"
									aria-label="Move {SECTION_LABELS[section.id]} down"
									disabled={index === home.sections.length - 1}
									class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
									onclick={() => moveSection(index, 1)}
								>
									<span class="icon-[mingcute--arrow-down-line] size-4"></span>
								</button>
								<button
									title={section.visible ? 'Hide' : 'Show'}
									aria-label="{section.visible ? 'Hide' : 'Show'} {SECTION_LABELS[section.id]}"
									aria-pressed={section.visible}
									class="size-8 grid place-items-center rounded-full hover:bg-white/10 cursor-pointer {section.visible
										? 'text-primary-500'
										: 'text-secondary-600 hover:text-white'}"
									onclick={() => toggleSection(index)}
								>
									<span
										class="{section.visible
											? 'icon-[mingcute--eye-line]'
											: 'icon-[mingcute--eye-close-line]'} size-[18px]"
									></span>
								</button>
							</li>
						{/each}
					</ul>
				</section>

				<section>
					{@render heading(home.layout === 'desktop' ? 'Wallpaper' : 'Featured banner')}
					<div class="grid grid-cols-3 p-1 rounded-lg bg-white/[0.04]" role="radiogroup">
						{#each HERO_OPTIONS as option (option.value)}
							{@const active = home.heroBackground === option.value}
							<button
								role="radio"
								aria-checked={active}
								class="h-8 rounded-md text-sm font-semibold cursor-pointer transition {active
									? 'bg-secondary-400 text-white'
									: 'text-secondary-600 hover:text-white'}"
								onclick={() => updateHomeSettings({ heroBackground: option.value })}
							>
								{option.label}
							</button>
						{/each}
					</div>
					{#if home.heroBackground === 'pinned'}
						<p class="mt-2 text-xs text-secondary-600">
							{#if pinnedSong}
								Pinned: <span class="text-white font-semibold">{pinnedSong.title}</span>.
							{/if}
							Right-click a downloaded song and choose "Pin to home" to change it.
						</p>
					{/if}
				</section>
			{:else if $settingsTab === 'appearance'}
				<section>
					{@render heading('Accent color')}
					<div class="flex gap-3" role="radiogroup" aria-label="Accent color">
						{#each ACCENTS as accent (accent.value)}
							{@const active = appearance.accent === accent.value}
							<button
								role="radio"
								aria-checked={active}
								title={accent.label}
								aria-label={accent.label}
								class="size-9 rounded-full cursor-pointer transition hover:scale-110 {active
									? 'ring-2 ring-white ring-offset-2 ring-offset-secondary-200'
									: ''}"
								style="background-color: {accent.color}"
								onclick={() => updateAppearance({ accent: accent.value })}
							></button>
						{/each}
					</div>
				</section>

				<section>
					{@render heading('Background')}
					{@render toggle(
						'Show beatmap background',
						'The background of the current song behind the app',
						appearance.background,
						(checked) => updateAppearance({ background: checked })
					)}
					{@render toggle(
						'Beat effects',
						'The background pulses to the beat and lights up in kiai time, like in osu!',
						appearance.beatEffects,
						(checked) => updateAppearance({ beatEffects: checked })
					)}
					<div class="mt-4 {appearance.background ? '' : 'opacity-40 pointer-events-none'}">
						<div class="flex justify-between text-sm mb-2">
							<span class="font-semibold text-white">Background dim</span>
							<span class="tabular-nums text-secondary-600">{appearance.dim}%</span>
						</div>
						<Range
							value={appearance.dim}
							min={0}
							max={95}
							step={5}
							onchange={(value) => updateAppearance({ dim: value })}
						/>
					</div>
				</section>

				<section>
					{@render heading('Videos')}
					{@render toggle(
						'Play beatmap videos',
						'Maps with a video play it instead of the background',
						appearance.video,
						(checked) => updateAppearance({ video: checked })
					)}
					<div class="flex items-center justify-between gap-4 mt-4 p-3 rounded-lg bg-white/[0.04]">
						<span class="min-w-0">
							<span class="block font-semibold text-white">Videos for downloaded songs</span>
							<span class="block text-xs text-secondary-600" aria-live="polite">
								{#if $videoFetch.state === 'checking'}
									Checking which songs have a video…
								{:else if $videoFetch.state === 'downloading'}
									Adding them: {$videoFetch.done} of {$videoFetch.total} songs. You can close this window.
								{:else if $videoFetch.state === 'done'}
									{$videoFetch.total
										? `Updated ${$videoFetch.done} ${$videoFetch.done === 1 ? 'song' : 'songs'}.`
										: 'All your songs are up to date.'}
								{:else if $videoFetch.state === 'error'}
									<span class="text-red-400">{$videoFetch.message}</span>
								{:else}
									Songs downloaded before these were supported get theirs. Nothing else changes.
								{/if}
							</span>
						</span>
						{#if $videoFetch.state === 'checking' || $videoFetch.state === 'downloading'}
							<span
								class="icon-[mingcute--loading-line] size-5 shrink-0 animate-spin text-primary-500"
							></span>
						{:else}
							<div class="shrink-0 whitespace-nowrap">
								<Button type="normal" onclick={fetchMissingVideos}>
									{$videoFetch.state === 'error' ? 'Retry' : 'Get them'}
								</Button>
							</div>
						{/if}
					</div>
				</section>
			{:else if $settingsTab === 'playback'}
				<section>
					{@render heading('Mods')}
					<div
						class="grid grid-cols-5 p-1 rounded-lg bg-white/[0.04]"
						role="radiogroup"
						aria-label="Mods"
					>
						{#each MOD_OPTIONS as option (option)}
							{@const active = ($userSettings.settings?.mod ?? 'NM') === option}
							<button
								role="radio"
								aria-checked={active}
								title={MODS[option].name}
								class="h-8 rounded-md text-sm font-bold cursor-pointer transition {active
									? 'bg-secondary-400 text-white'
									: 'text-secondary-600 hover:text-white'}"
								onclick={() => setPlaybackMod(option)}
							>
								{option === 'NM' ? 'None' : option}
							</button>
						{/each}
					</div>
					<p class="mt-2 text-xs text-secondary-600">
						{#if ($userSettings.settings?.mod ?? 'NM') === 'NM'}
							Speed up or slow down every song like in osu!. Also in the song bar.
						{:else}
							{MODS[$userSettings.settings.mod].name}: {MODS[$userSettings.settings.mod].rate}×
							speed. Also in the song bar.
						{/if}
					</p>
				</section>

				<section>
					{@render heading('Volume')}
					{@render toggle(
						'Autoplay',
						'When a queue ends, keep playing similar songs from your library',
						$userSettings.settings?.autoplay ?? true,
						(checked) => updateUserSettings({ autoplay: checked })
					)}
					{@render toggle(
						'Normalize volume',
						'Plays every song at the same loudness',
						$userSettings.settings?.normalize ?? true,
						(checked) => {
							updateUserSettings({ normalize: checked });
							refreshVolume();
						}
					)}
					<div class="mt-4">
						<div class="flex justify-between text-sm mb-2">
							<span class="font-semibold text-white">Crossfade</span>
							<span class="tabular-nums text-secondary-600">
								{crossfade ? `${crossfade} s` : 'Off'}
							</span>
						</div>
						<Range
							value={crossfade}
							min={0}
							max={12}
							step={1}
							onchange={(value) => updateUserSettings({ crossfade: value })}
						/>
					</div>
				</section>
				<section>
					{@render heading('Streaming')}
					{@render toggle(
						'Stream songs that aren’t downloaded',
						'In the search and in playlists, songs play in full from the beatmap mirror catboy.best instead of a short preview or a download: only the song, no osu! session key needed. They start while they still load, the next ones load ahead. Gameplay, hitsounds and the beat work too, only without the beatmap video.',
						$userSettings.settings?.stream ?? false,
						(checked) => updateUserSettings({ stream: checked })
					)}
				</section>
				<section>
					{@render heading('Equalizer')}
					<EqualizerSettings />
				</section>
				<section>
					{@render heading('Hitsounds')}
					<HitsoundSettings />
				</section>
				<section>
					{@render heading('Lyrics')}
					{@render toggle(
						'Japanese in romaji',
						'Shows Japanese lyrics in Latin letters. The dictionary for it (about 18 MB) downloads once.',
						$userSettings.settings?.lyricsRomaji ?? false,
						(checked) => updateUserSettings({ lyricsRomaji: checked })
					)}
				</section>
			{:else if $settingsTab === 'library'}
				<section>
					{@render heading('osu!')}
					<div class="flex items-center justify-between gap-4 p-3 rounded-lg bg-white/[0.04]">
						<span class="min-w-0">
							<span class="block font-semibold text-white">Import from osu!</span>
							<span class="block text-xs text-secondary-600 break-words" aria-live="polite">
								{#if $osuImport.state === 'scanning'}
									Reading your songs: {$osuImport.done} of {$osuImport.total} folders,
									{$osuImport.added} new.
								{:else if $osuImport.state === 'details'}
									Added {$osuImport.added} songs. Loading star ratings and lengths…
								{:else if $osuImport.state === 'done'}
									Added {$osuImport.added}
									{$osuImport.added === 1 ? 'song' : 'songs'}{$osuImport.skipped
										? `, skipped ${$osuImport.skipped} (already added or without ID)`
										: ''}.
								{:else if $osuImport.state === 'error'}
									<span class="text-red-400">{$osuImport.message}</span>
								{:else if osuFolder}
									Your osu! folder <span class="text-white/80">{osuRoot}</span>: its songs play from
									there (nothing is copied), its skins are in the hitsound settings.
								{:else}
									Pick your osu! folder (the one with osu!.exe). Its songs play from there, nothing
									is copied, and its skins are there for the hitsounds.
								{/if}
							</span>
						</span>
						{#if importing}
							<span
								class="icon-[mingcute--loading-line] size-5 shrink-0 animate-spin text-primary-500"
							></span>
						{:else}
							<div class="flex gap-2 shrink-0">
								{#if osuFolder}
									<Button type="ghost" onclick={chooseOsuFolder}>Other folder</Button>
									<Button type="normal" onclick={() => importOsuFolder(osuFolder)}>Import</Button>
								{:else}
									<Button type="normal" onclick={chooseOsuFolder}>Choose osu! folder</Button>
								{/if}
							</div>
						{/if}
					</div>
					<div class="mt-2 flex items-center justify-between gap-4 p-3 rounded-lg bg-white/[0.04]">
						<span class="min-w-0">
							<span class="block font-semibold text-white">Playlists from your profile</span>
							<span class="block text-xs text-secondary-600">
								Turn your favourites, most played or top plays into a playlist.
							</span>
						</span>
						<Button
							type="normal"
							onclick={() => {
								settingsTab.set(null);
								profileImportOpen.set(true);
							}}
						>
							Open
						</Button>
					</div>
					<div class="mt-2 flex items-center justify-between gap-4 p-3 rounded-lg bg-white/[0.04]">
						<span class="min-w-0">
							<span class="block font-semibold text-white">osu! session key</span>
							<span class="block text-xs text-secondary-600">
								{$keyStore.sessionKey
									? 'Added: you can download beatmaps.'
									: 'Not added: needed to download beatmaps from osu!.'}
							</span>
						</span>
						<Button
							type="normal"
							onclick={() => {
								settingsTab.set(null);
								sessionKeyNeeded.set(true);
							}}
						>
							{$keyStore.sessionKey ? 'Change' : 'Add key'}
						</Button>
					</div>
				</section>
				<section>
					{@render heading('Friends')}
					<div class="p-3 rounded-lg bg-white/[0.04]">
						<span class="block mb-2 font-semibold text-white">What your friends see</span>
						<VisibilityPicker />
					</div>
				</section>
			{:else if $settingsTab === 'shortcuts'}
				<KeybindSettings />
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<Button type="primary" onclick={() => settingsTab.set(null)}>Done</Button>
	{/snippet}
</Modal>
