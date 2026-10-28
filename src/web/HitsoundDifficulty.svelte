<script>
	// Which difficulty's hitsounds play, for the song's beatmap set: its difficulties, the easy
	// ones first (the hard ones have far more sounds). The choice is the account's, the desktop
	// app's gameplay and hitsounds use it too; without one, the hardest (as the desktop's).
	import { offline } from '../lib/stores/network';
	import { userSettings } from './shims/user';
	import { difficultyColor } from '../lib/beatmapStatus';
	import { haptic } from './haptics';
	import {
		setDifficulties,
		hitsoundChoices,
		hardest,
		learnHardest,
		chooseDifficulty
	} from './difficulties';

	let { song, disabled = false } = $props();

	let all = $state(null);
	let failed = $state(false);
	$effect(() => {
		const id = String(song.id);
		all = null;
		failed = false;
		if (!(Number(id) > 0)) return void (failed = true);
		learnHardest(song);
		setDifficulties(id)
			.then((maps) => id === String(song.id) && (all = maps))
			.catch(() => id === String(song.id) && (failed = true));
	});

	let own = $derived(String(song.beatmaps?.[0]?.id ?? ''));
	let difficulties = $derived(hitsoundChoices(song, all ?? []));
	let chosen = $derived(
		String(
			$userSettings.settings?.gameplayDifficulty?.[String(song.id)] ??
				$hardest[String(song.id)] ??
				own
		)
	);

	function choose(mapId) {
		haptic();
		chooseDifficulty(song, mapId);
	}
</script>

<div class="px-5 pt-4 {disabled ? 'opacity-40 pointer-events-none' : ''}">
	<p class="font-semibold">Difficulty</p>
	<p class="text-sm text-white/60">Whose hitsounds play: an easier one has fewer</p>
	{#if difficulties.length}
		<div class="-mx-5 mt-1 px-5 py-1 flex gap-2 overflow-x-auto overscroll-contain" data-no-swipe>
			{#each difficulties as map (map.id)}
				{@const on = String(map.id) === chosen}
				<button
					class="shrink-0 max-w-48 h-10 px-3 flex items-center gap-2 rounded-full ring-1 transition {on
						? 'ring-2 ring-white bg-white/10'
						: 'ring-white/10 bg-white/[0.04]'}"
					aria-pressed={on}
					onclick={() => choose(map.id)}
				>
					<span
						class="size-2.5 shrink-0 rounded-full"
						style="background-color: {difficultyColor(map.difficulty_rating)}"
					></span>
					<span class="truncate text-sm font-semibold">{map.version}</span>
					<span class="text-xs text-white/50 tabular-nums">
						{map.difficulty_rating?.toFixed(1)}★{map.mode && map.mode !== 'osu'
							? ` ${map.mode}`
							: ''}
					</span>
				</button>
			{/each}
		</div>
	{:else if failed || $offline}
		<p class="mt-2 text-sm text-white/50">
			{$offline
				? 'The difficulties show up once you are connected.'
				: "The difficulties couldn't be loaded."}
		</p>
	{:else}
		<div class="mt-2 flex gap-2" aria-busy="true" aria-label="Loading">
			{#each [0, 1, 2] as i (i)}
				<span class="h-10 w-28 rounded-full bg-white/[0.06]"></span>
			{/each}
		</div>
	{/if}
</div>
