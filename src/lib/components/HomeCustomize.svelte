<script>
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Range from './Range.svelte';
	import {
		userSettings,
		updateHomeSettings,
		updateAppearance,
		DEFAULT_HOME,
		DEFAULT_APPEARANCE
	} from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';

	/** @type {{ open: boolean }} */
	let { open = $bindable(false) } = $props();

	const SECTION_LABELS = {
		hero: 'Featured banner',
		playlists: 'Your playlists',
		recent: 'Recently downloaded',
		discover: 'Discover beatmaps'
	};
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

	let home = $derived({ ...DEFAULT_HOME, ...$userSettings.settings?.home });
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

{#snippet heading(text)}
	<h3 class="text-xs font-bold uppercase tracking-wider text-secondary-600 mb-2">{text}</h3>
{/snippet}

<Modal title="Customize" width="480px" bind:open>
	<div class="flex flex-col gap-6 py-2">
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
			{@render heading('Featured banner')}
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
			<label class="flex items-center justify-between gap-4 cursor-pointer">
				<span>
					<span class="block font-semibold text-white">Show beatmap background</span>
					<span class="block text-xs text-secondary-600">
						The background of the current song behind the app
					</span>
				</span>
				<input
					type="checkbox"
					class="peer sr-only"
					checked={appearance.background}
					onchange={(e) => updateAppearance({ background: e.currentTarget.checked })}
				/>
				<span
					class="relative w-10 h-6 shrink-0 rounded-full bg-secondary-500 transition peer-checked:bg-primary-300 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-400 after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
				></span>
			</label>
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
					on:change={(e) => updateAppearance({ dim: e.detail })}
				/>
			</div>
		</section>
	</div>

	<svelte:fragment slot="footer">
		<Button type="primary" on:click={() => (open = false)}>Done</Button>
	</svelte:fragment>
</Modal>
