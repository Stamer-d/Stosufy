<script>
	const base = __WEB_BASE__;
	// Settings, as in the desktop app (the same ones: they're the account's, a change here is
	// there too): how it looks, how it plays, hitsounds, friends; and the phone's own: its
	// downloads, the app itself
	import { onMount } from 'svelte';
	import { goBack } from '../../navigation';
	import { userSettings, updateUserSettings } from '../../shims/user';
	import { logOut } from '../../shims/auth';
	import { webUser } from '../../library';
	import { autoplay, toggleAutoplay, wakeAudio } from '../../player';
	import { MODS, setMod } from '../../hitsounds';
	import { VISIBILITY, setVisibility, visibility } from '../../friends';
	import { downloadedSongs, removeAllDownloads } from '../../downloads';
	import { showToast } from '../../../lib/stores/toast';

	const ACCENTS = [
		{ value: 'violet', label: 'Violet', color: 'oklch(0.57 0.21 295)' },
		{ value: 'pink', label: 'osu! pink', color: 'oklch(0.66 0.2 355)' },
		{ value: 'blue', label: 'Blue', color: 'oklch(0.6 0.16 240)' },
		{ value: 'teal', label: 'Teal', color: 'oklch(0.6 0.12 185)' },
		{ value: 'orange', label: 'Orange', color: 'oklch(0.66 0.17 50)' }
	];
	const MOD_COLOR = {
		HT: 'oklch(0.85 0.17 135)',
		DC: 'oklch(0.85 0.17 135)',
		DT: 'oklch(0.7 0.19 20)',
		NC: 'oklch(0.7 0.19 20)'
	};
	const PARTS = [
		['whistle', 'Whistle'],
		['finish', 'Finish'],
		['clap', 'Clap'],
		['slidertick', 'Slider ticks']
	];

	let settings = $derived($userSettings.settings ?? {});
	let appearance = $derived({
		accent: 'violet',
		background: true,
		dim: 75,
		...settings.appearance
	});
	let mod = $derived(settings.mod ?? 'NM');
	let hitsoundsOn = $derived(settings.hitsounds ?? false);
	let shown = $derived.by(() => {
		void $userSettings;
		return visibility();
	});

	const updateAppearance = (change) =>
		updateUserSettings({ appearance: { ...appearance, ...change } });

	// How much the phone keeps for the app (the downloads, mostly)
	let storage = $state(null);
	onMount(() => {
		navigator.storage
			?.estimate?.()
			.then((estimate) => (storage = estimate))
			.catch(() => {});
	});
	const megabytes = (bytes) =>
		bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

	let confirmRemove = $state(false);
	async function removeAll() {
		if (!confirmRemove) {
			confirmRemove = true;
			setTimeout(() => (confirmRemove = false), 3000);
			return;
		}
		confirmRemove = false;
		await removeAllDownloads();
		storage = await navigator.storage?.estimate?.().catch(() => storage);
		showToast('All downloads removed from the phone', 'icon-[mingcute--delete-2-line]');
	}
</script>

{#snippet section(title)}
	<h2 class="px-4 pt-7 pb-2 text-xs font-bold uppercase tracking-wide text-secondary-600">
		{title}
	</h2>
{/snippet}

{#snippet toggle(label, detail, on, onclick)}
	<button
		class="w-full px-4 py-3 flex items-center justify-between gap-4 text-start active:bg-white/[0.04]"
		role="switch"
		aria-checked={on}
		{onclick}
	>
		<span class="min-w-0">
			<span class="block font-semibold">{label}</span>
			{#if detail}<span class="block text-sm text-secondary-600">{detail}</span>{/if}
		</span>
		<span
			class="relative w-11 h-6 shrink-0 rounded-full transition {on
				? 'bg-primary-400'
				: 'bg-white/20'}"
		>
			<span
				class="absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform {on
					? 'translate-x-5'
					: ''}"
			></span>
		</span>
	</button>
{/snippet}

{#snippet slider(label, value, min, max, step, unit, onchange, disabled = false)}
	<label class="block px-4 py-3 {disabled ? 'opacity-40' : ''}">
		<span class="flex justify-between">
			<span class="font-semibold">{label}</span>
			<span class="text-sm text-secondary-600 tabular-nums">{value}{unit}</span>
		</span>
		<input
			type="range"
			{min}
			{max}
			{step}
			{value}
			{disabled}
			onchange={(e) => onchange(Number(e.currentTarget.value))}
			class="mt-2 w-full accent-[var(--color-primary-400)]"
		/>
	</label>
{/snippet}

<header class="px-4 pt-3 pb-1 flex items-center gap-1">
	<a
		href="{base}/"
		onclick={(e) => {
			e.preventDefault();
			goBack(`${base}/`);
		}}
		aria-label="Back"
		class="-ml-3 size-11 grid place-items-center"
	>
		<span class="icon-[mingcute--left-line] size-7"></span>
	</a>
	<h1 class="text-2xl font-bold tracking-tight">Settings</h1>
</header>

<!-- Account -->
<div class="mx-4 mt-3 p-3 flex items-center gap-3 rounded-xl bg-white/[0.04]">
	<img
		src={$webUser?.avatar_url ?? `${base}/logo.png`}
		alt=""
		class="size-12 rounded-full object-cover bg-secondary-300"
	/>
	<div class="min-w-0 flex-1">
		<p class="font-semibold truncate">{$webUser?.username ?? 'Logged in'}</p>
		<p class="text-sm text-secondary-600">osu! account · settings synced with the desktop app</p>
	</div>
	<button class="h-10 px-3 rounded-full bg-white/[0.08] text-sm font-semibold" onclick={logOut}>
		Log out
	</button>
</div>

{@render section('Appearance')}
<div class="px-4 py-2">
	<p class="font-semibold">Accent color</p>
	<div class="mt-3 flex gap-3">
		{#each ACCENTS as accent (accent.value)}
			{@const active = appearance.accent === accent.value}
			<button
				aria-label={accent.label}
				aria-pressed={active}
				class="size-11 rounded-full grid place-items-center ring-2 transition {active
					? 'ring-white'
					: 'ring-transparent'}"
				style="background-color: {accent.color}"
				onclick={() => updateAppearance({ accent: accent.value })}
			>
				{#if active}<span class="icon-[mingcute--check-line] size-5"></span>{/if}
			</button>
		{/each}
	</div>
</div>
{@render toggle(
	"The song's background",
	'Behind the app, blurred, like the desktop app',
	appearance.background,
	() => updateAppearance({ background: !appearance.background })
)}
{@render slider(
	'Background dim',
	appearance.dim,
	0,
	100,
	5,
	'%',
	(dim) => updateAppearance({ dim }),
	!appearance.background
)}

{@render section('Playback')}
{@render toggle(
	'Autoplay',
	'Songs like these play on when the queue ends',
	$autoplay,
	toggleAutoplay
)}
{@render toggle(
	'Same loudness',
	'Every song as loud as the others (a quieter one stays as it is)',
	settings.normalize ?? true,
	() => {
		updateUserSettings({ normalize: !(settings.normalize ?? true) });
		wakeAudio();
	}
)}
{@render slider(
	'Crossfade',
	settings.crossfade ?? 0,
	0,
	12,
	1,
	(settings.crossfade ?? 0) ? ' s' : ' (off)',
	(seconds) => {
		updateUserSettings({ crossfade: seconds });
		wakeAudio();
	}
)}
<div class="px-4 py-3">
	<p class="font-semibold">Speed</p>
	<div class="mt-3 grid grid-cols-5 gap-2">
		{#each ['NM', 'HT', 'DC', 'DT', 'NC'] as option (option)}
			<button
				class="h-14 flex flex-col items-center justify-center gap-0.5 rounded-xl ring-1 {mod ===
				option
					? 'ring-2 ring-white bg-white/10'
					: 'ring-white/10 bg-white/[0.04]'}"
				aria-pressed={mod === option}
				onclick={() => setMod(option)}
			>
				<span
					class="px-1.5 rounded-md text-xs font-black {option === 'NM'
						? 'bg-white/15'
						: 'text-black'}"
					style={option === 'NM' ? '' : `background-color: ${MOD_COLOR[option]}`}>{option}</span
				>
				<span class="text-[11px] text-white/60">{MODS[option].rate}×</span>
			</button>
		{/each}
	</div>
</div>
{#if mod === 'NC'}
	{@render toggle(
		'Nightcore beat',
		'Its drums, on the beat of the song',
		settings.nightcoreBeat ?? true,
		() => updateUserSettings({ nightcoreBeat: !(settings.nightcoreBeat ?? true) })
	)}
{/if}

{@render section('Hitsounds')}
{@render toggle('Play the hitsounds', 'Like watching osu! autoplay', hitsoundsOn, () =>
	updateUserSettings({ hitsounds: !hitsoundsOn })
)}
{@render slider(
	'Volume',
	Math.round((settings.hitsoundVolume ?? 0.8) * 100),
	0,
	100,
	5,
	'%',
	(volume) => updateUserSettings({ hitsoundVolume: volume / 100 }),
	!hitsoundsOn
)}
{@render slider(
	'Offset',
	settings.hitsoundOffset ?? 0,
	-150,
	150,
	5,
	' ms',
	(offset) => updateUserSettings({ hitsoundOffset: offset }),
	!hitsoundsOn
)}
<p class="px-4 -mt-1 text-xs text-secondary-600">
	Hitsounds early? Move it up (later). Late? Down (earlier).
</p>
<div class="px-4 pt-3 flex flex-wrap gap-2 {hitsoundsOn ? '' : 'opacity-40'}">
	{#each PARTS as [part, label] (part)}
		{@const on = settings.hitsoundParts?.[part] !== false}
		<button
			class="h-9 px-4 rounded-full text-sm font-semibold {on
				? 'bg-white/15 text-white'
				: 'bg-white/[0.04] text-secondary-600 line-through'}"
			aria-pressed={on}
			disabled={!hitsoundsOn}
			onclick={() =>
				updateUserSettings({ hitsoundParts: { ...settings.hitsoundParts, [part]: !on } })}
		>
			{label}
		</button>
	{/each}
</div>

{@render section('Friends')}
<div class="flex flex-col" role="radiogroup" aria-label="What your friends see">
	{#each Object.entries(VISIBILITY) as [value, { label, description }] (value)}
		<button
			role="radio"
			aria-checked={shown === value}
			class="px-4 py-3 flex items-center gap-3 text-start active:bg-white/[0.04]"
			onclick={() => setVisibility(value)}
		>
			<span
				class="size-5 shrink-0 rounded-full ring-2 grid place-items-center {shown === value
					? 'ring-primary-400'
					: 'ring-white/30'}"
			>
				{#if shown === value}<span class="size-2.5 rounded-full bg-primary-400"></span>{/if}
			</span>
			<span>
				<span class="block font-semibold">{label}</span>
				<span class="block text-sm text-secondary-600">{description}</span>
			</span>
		</button>
	{/each}
</div>

{@render section('Downloads')}
<div class="px-4 py-3">
	<p class="font-semibold">{$downloadedSongs.length} songs on the phone</p>
	{#if storage?.usage != null}
		<p class="text-sm text-secondary-600">
			{megabytes(storage.usage)} used{storage.quota
				? ` of up to ${megabytes(storage.quota)} the phone allows`
				: ''}
		</p>
	{/if}
</div>
<div class="px-4 pb-2 flex gap-2">
	<a
		href="{base}/library/downloads"
		class="h-10 px-4 grid place-items-center rounded-full bg-white/[0.08] text-sm font-semibold"
		>Show them</a
	>
	<button
		class="h-10 px-4 rounded-full text-sm font-semibold {confirmRemove
			? 'bg-red-500/20 text-red-300'
			: 'bg-white/[0.08] text-red-300'} disabled:opacity-40"
		disabled={!$downloadedSongs.length}
		onclick={removeAll}
	>
		{confirmRemove ? 'Tap again to remove all' : 'Remove all'}
	</button>
</div>

{@render section('App')}
<a href="{base}/check" class="px-4 py-3 flex items-center justify-between active:bg-white/[0.04]">
	<span>
		<span class="block font-semibold">Checks and player log</span>
		<span class="block text-sm text-secondary-600"
			>What the player did (when a song stopped by itself, it says why)</span
		>
	</span>
	<span class="icon-[mingcute--right-line] size-5 text-secondary-600"></span>
</a>
<button
	class="w-full px-4 py-3 flex items-center justify-between text-start active:bg-white/[0.04]"
	onclick={() => location.reload()}
>
	<span>
		<span class="block font-semibold">Reload the app</span>
		<span class="block text-sm text-secondary-600">Gets the newest version</span>
	</span>
	<span class="icon-[mingcute--refresh-2-line] size-5 text-secondary-600"></span>
</button>
<p class="px-4 pt-6 pb-8 text-xs text-secondary-600">Stosufy web · {__WEB_VERSION__}</p>
