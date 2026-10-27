<script>
	const base = __WEB_BASE__;
	import { goBack } from '../../navigation';
	// Wrapped, as in the desktop app: what you listened to in the last week, month, this year
	// or ever (here and on the desktop: the history is the account's). Watch it as a story.
	import { history, deleteHistory } from '../../../lib/stores/history';
	import { recap, PERIODS } from '../../../lib/wrapped';
	import { showToast } from '../../../lib/stores/toast';
	import { known } from '../../listening';
	import { play } from '../../player';
	import { webUser } from '../../library';
	import SongRow from '../../SongRow.svelte';
	import SongCover from '../../../lib/components/SongCover.svelte';
	import Triangles from '../../../lib/components/Triangles.svelte';
	import WrappedStory from '../../WrappedStory.svelte';

	const PERIOD_KEY = 'stosufy-web-wrapped-period';
	let period = $state(readPeriod());
	function readPeriod() {
		try {
			const saved = localStorage.getItem(PERIOD_KEY);
			const found = PERIODS.find((p) => p.id === saved);
			if (found) return found.id;
		} catch {
			// (the default)
		}
		return 'month';
	}
	function choose(id) {
		period = id;
		try {
			localStorage.setItem(PERIOD_KEY, id);
		} catch {
			// (not remembered)
		}
	}

	let data = $derived(recap($history, period));
	let periodLabel = $derived(PERIODS.find((p) => p.id === period)?.label ?? '');
	let watching = $state(false);
	let topSongs = $derived(data.topSongs.slice(0, 10).map(({ song }) => known(song)));

	let confirmDelete = $state(false);
	async function removeHistory() {
		if (!confirmDelete) {
			confirmDelete = true;
			setTimeout(() => (confirmDelete = false), 3000);
			return;
		}
		confirmDelete = false;
		try {
			await deleteHistory();
			showToast('Your listening history is deleted', 'icon-[mingcute--delete-2-line]');
		} catch (error) {
			console.error('Could not delete the listening history:', error);
			showToast("Couldn't delete your listening history", 'icon-[mingcute--warning-line]');
		}
	}

	const busiest = (hours) => hours.indexOf(Math.max(...hours));
	const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
</script>

<div class="relative -mt-[env(safe-area-inset-top)] pt-[env(safe-area-inset-top)] overflow-hidden">
	<div
		class="absolute inset-0 bg-gradient-to-br from-primary-400/70 via-primary-700/40 to-secondary-200"
	></div>
	<Triangles count={14} seed={7} />
	<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent"></div>
	<div class="relative px-4 pt-2 pb-6">
		<a
		href="{base}/"
		onclick={(e) => {
			e.preventDefault();
			goBack(`${base}/`);
		}}
		aria-label="Back" class="-ml-3 size-12 grid place-items-center">
			<span class="icon-[mingcute--left-line] size-7"></span>
		</a>
		<p class="mt-2 text-sm font-bold uppercase tracking-wide text-white/70">Your Wrapped</p>
		<h1 class="text-4xl font-extrabold tracking-tight">{periodLabel}</h1>
		<div class="-mx-4 mt-4 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none]" data-no-swipe>
			{#each PERIODS as option (option.id)}
				<button
					aria-pressed={period === option.id}
					class="shrink-0 h-9 px-4 rounded-full text-sm font-semibold transition {period ===
					option.id
						? 'bg-white text-black'
						: 'bg-black/30 text-white/80'}"
					onclick={() => choose(option.id)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		{#if data.plays}
			<button
				class="mt-5 w-full h-14 flex items-center justify-center gap-3 rounded-full bg-white text-black text-lg font-bold shadow-xl shadow-black/30 active:scale-[0.98] transition"
				onclick={() => (watching = true)}
			>
				<span class="icon-[mingcute--play-circle-fill] size-7"></span>
				Watch your story
			</button>
		{/if}
	</div>
</div>

{#if !data.plays}
	<div class="px-8 py-14 flex flex-col items-center text-center gap-2">
		<span class="icon-[mingcute--chart-bar-line] size-12 text-secondary-600"></span>
		<p class="text-lg font-semibold">Nothing heard in this time yet</p>
		<p class="text-sm text-secondary-600">Listen to some songs: your Wrapped fills up as you do.</p>
	</div>
{:else}
	<div class="px-4 grid grid-cols-2 gap-2">
		{#each [[Math.round(data.seconds / 60).toLocaleString(), 'minutes'], [data.songs, 'songs'], [data.artists, 'artists'], [data.days, data.days === 1 ? 'day with music' : 'days with music']] as [value, label] (label)}
			<div class="p-4 rounded-xl bg-white/[0.05]">
				<p class="text-3xl font-extrabold tabular-nums">{value}</p>
				<p class="text-sm text-secondary-600">{label}</p>
			</div>
		{/each}
	</div>

	{#if topSongs.length}
		<div class="px-4 pt-7 pb-1 flex items-center justify-between">
			<h2 class="text-xl font-bold tracking-tight">Top songs</h2>
			<button
				class="h-9 px-4 rounded-full bg-primary-300 text-sm font-semibold"
				onclick={() => play(topSongs, 0)}
			>
				Play them
			</button>
		</div>
		<ol class="px-2">
			{#each topSongs as song, i (`${song.id}:${song.track ?? 0}`)}
				<SongRow {song} index={i} onplay={() => play(topSongs, i)} />
			{/each}
		</ol>
	{/if}

	{#if data.topArtists.length}
		<h2 class="px-4 pt-7 pb-2 text-xl font-bold tracking-tight">Top artists</h2>
		<ol class="px-4 flex flex-col gap-3">
			{#each data.topArtists.slice(0, 5) as artist, i (artist.name)}
				<li class="flex items-center gap-3">
					<span class="w-5 text-lg font-extrabold text-secondary-600">{i + 1}</span>
					<SongCover
						setId={artist.top.setId}
						track={artist.top.track}
						title={artist.top.title}
						class="size-12 rounded-full"
					/>
					<span class="min-w-0">
						<span class="block font-semibold truncate">{artist.name}</span>
						<span class="block text-sm text-secondary-600">{artist.plays} plays</span>
					</span>
				</li>
			{/each}
		</ol>
	{/if}

	<h2 class="px-4 pt-7 pb-1 text-xl font-bold tracking-tight">When you listen</h2>
	<p class="px-4 text-sm text-secondary-600">Most around {hourLabel(busiest(data.hours))}</p>
	<div class="mx-4 mt-3 h-28 flex items-end gap-0.5" aria-hidden="true">
		{#each data.hours as value, hour (hour)}
			<span
				class="flex-1 rounded-t {hour === busiest(data.hours) ? 'bg-primary-400' : 'bg-white/20'}"
				style="height: {value ? Math.max(3, (value / Math.max(...data.hours)) * 100) : 0}%"
			></span>
		{/each}
	</div>
	<div class="mx-4 mt-1 flex justify-between text-[10px] text-secondary-600 tabular-nums">
		<span>0:00</span><span>6:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
	</div>
{/if}

<div class="px-4 pt-8 pb-6 flex justify-center">
	<button
		class="h-9 px-4 rounded-full bg-white/[0.06] text-sm {confirmDelete
			? 'text-red-400'
			: 'text-secondary-600'}"
		onclick={removeHistory}
	>
		{confirmDelete ? 'Tap again to delete your history' : 'Delete my listening history'}
	</button>
</div>

{#if watching}
	<WrappedStory
		recap={data}
		period={periodLabel}
		username={$webUser?.username ?? ''}
		onclose={() => (watching = false)}
	/>
{/if}
