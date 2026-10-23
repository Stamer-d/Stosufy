<script>
	// Wrapped: the user's listening, for the last week, month, this year or all of it
	import { history } from '#lib/stores/history.ts';
	import { recap, PERIODS } from '#lib/wrapped.ts';
	import { setSongQueue, currentSong } from '#lib/stores/audio.ts';
	import { librarySong } from '#lib/stores/radio.ts';
	import { showToast } from '#lib/stores/toast.ts';
	import SongCover from '#lib/components/SongCover.svelte';
	import BeatmapBackground from '#lib/components/BeatmapBackground.svelte';
	import MapperLink from '#lib/components/MapperLink.svelte';
	import Triangles from '#lib/components/Triangles.svelte';

	const PERIOD_KEY = 'wrappedPeriod';
	let period = $state(readPeriod());
	/** @returns {import('#lib/wrapped.ts').Period} */
	function readPeriod() {
		try {
			const saved = localStorage.getItem(PERIOD_KEY);
			const known = PERIODS.find((p) => p.id === saved);
			if (known) return known.id;
		} catch {
			// (no storage: the default)
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
	let top = $derived(data.topSongs[0] ?? null);
	let periodLabel = $derived(PERIODS.find((p) => p.id === period)?.label ?? '');

	/** The songs of the library behind history songs (only downloaded ones can play from here) */
	const playable = (list) =>
		list
			.map(({ song }) => librarySong({ id: song.setId, track: song.track, beatmaps: [] }))
			.filter(Boolean);

	async function playTop() {
		const songs = playable(data.topSongs);
		if (!songs.length) {
			showToast('Your top songs aren’t downloaded', 'icon-[mingcute--download-2-line]');
			return;
		}
		await setSongQueue(0, songs, 'playlist');
	}
	async function playSong(song) {
		const entry = librarySong({ id: song.setId, track: song.track, beatmaps: [] });
		if (!entry) {
			showToast(`"${song.title}" isn’t downloaded`, 'icon-[mingcute--download-2-line]');
			return;
		}
		await setSongQueue(0, [entry], 'playlist');
	}

	const minutes = (seconds) => Math.round(seconds / 60).toLocaleString();
	const duration = (seconds) => {
		const h = Math.floor(seconds / 3600);
		const m = Math.round((seconds % 3600) / 60);
		return h ? `${h} h ${m} min` : `${m} min`;
	};
	const day = (date, withYear = false) =>
		date.toLocaleDateString(undefined, {
			weekday: withYear ? undefined : 'long',
			month: 'long',
			day: 'numeric',
			year: withYear ? 'numeric' : undefined
		});
	const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
	const isCurrent = (song) =>
		$currentSong.song?.id == song.setId && ($currentSong.song?.track ?? 0) == song.track;

	// The hours and the weekdays: one bar each, the hovered one read out above
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
	let hoveredHour = $state(null);
	let hoveredDay = $state(null);
	let busiestHour = $derived(data.hours.indexOf(Math.max(...data.hours)));
	const tallest = (list) => Math.max(1, ...list);
	const widest = (list) => Math.max(1, ...list.map((entry) => entry.plays));
	/** What the time of day says about the listener */
	const listener = (hour) =>
		hour < 5
			? 'a night owl'
			: hour < 11
				? 'an early bird'
				: hour < 17
					? 'an afternoon listener'
					: hour < 22
						? 'an evening listener'
						: 'a night owl';
</script>

<div class="pb-12">
	<!-- Header: the period and the time listened -->
	<div class="relative overflow-hidden">
		<div
			class="absolute inset-0 bg-gradient-to-br from-primary-400/70 via-primary-700/40 to-secondary-200"
		></div>
		<Triangles count={22} seed={7} />
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/40 to-transparent"></div>
		<div class="relative px-8 pt-10 pb-8 flex flex-col gap-6">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p class="text-sm font-bold uppercase tracking-wide text-white/70">Your Wrapped</p>
					<h1 class="text-5xl font-extrabold tracking-tight">{periodLabel}</h1>
				</div>
				<div
					class="flex gap-1 p-1 rounded-full bg-black/30 backdrop-blur ring-1 ring-white/10"
					role="tablist"
				>
					{#each PERIODS as option (option.id)}
						<button
							role="tab"
							aria-selected={period === option.id}
							class="px-3 h-8 rounded-full text-sm font-semibold cursor-pointer transition {period ===
							option.id
								? 'bg-white text-black'
								: 'text-white/80 hover:text-white hover:bg-white/10'}"
							onclick={() => choose(option.id)}>{option.label}</button
						>
					{/each}
				</div>
			</div>
			{#if data.plays}
				<div class="flex flex-wrap items-end gap-x-10 gap-y-4">
					<div>
						<p class="text-7xl font-extrabold tabular-nums leading-none">
							{minutes(data.seconds)}
						</p>
						<p class="mt-2 text-white/80 font-semibold">minutes of music</p>
					</div>
					{#each [['Plays', data.plays], ['Songs', data.songs], ['Artists', data.artists], ['Days with music', data.days]] as [label, value] (label)}
						<div>
							<p class="text-3xl font-extrabold tabular-nums">{value.toLocaleString()}</p>
							<p class="text-sm text-white/70">{label}</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	{#if !data.plays}
		<div class="px-8 py-16 flex flex-col items-center text-center gap-3">
			<span class="icon-[mingcute--music-2-line] size-12 text-secondary-600"></span>
			<p class="text-xl font-bold">Nothing here yet</p>
			<p class="text-secondary-600 max-w-md">
				{#if data.since}
					You haven't listened to anything in this time. Pick a longer one above.
				{:else}
					Stosufy counts what you listen to from now on: every song you hear for 30 seconds. Come
					back after a few songs.
				{/if}
			</p>
		</div>
	{:else}
		<div class="px-8 flex flex-col gap-10">
			<!-- The top song -->
			{#if top}
				<section class="relative h-56 rounded-xl overflow-hidden">
					<BeatmapBackground
						setId={top.song.setId}
						mapId={top.song.mapId}
						title={top.song.title}
						class="absolute inset-0"
					/>
					<div
						class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/10"
					></div>
					<div class="relative h-full flex items-end justify-between gap-6 p-6">
						<div class="min-w-0">
							<p class="text-xs font-bold uppercase tracking-wide text-primary-400">
								Your top song
							</p>
							<p class="mt-1 text-3xl font-extrabold leading-tight truncate">{top.song.title}</p>
							<p class="text-white/80 truncate">{top.song.artist}</p>
							<p class="mt-2 text-sm text-white/70">
								Played {times(top.plays)} · {duration(top.seconds)}
							</p>
						</div>
						<button
							class="shrink-0 flex items-center gap-2 px-5 h-11 rounded-full bg-primary-300 hover:bg-primary-400 font-semibold cursor-pointer transition shadow-lg shadow-black/40"
							onclick={playTop}
						>
							<span class="icon-[mingcute--play-fill] size-5"></span>
							Play your top songs
						</button>
					</div>
				</section>
			{/if}

			<div class="grid gap-10 xl:grid-cols-[1fr_24rem]">
				<!-- Top songs -->
				<section>
					<h2 class="text-xl font-bold tracking-tight mb-3">Top songs</h2>
					<ol class="flex flex-col">
						{#each data.topSongs as entry, i (entry.key)}
							<li>
								<button
									class="w-full flex items-center gap-3 p-2 rounded-md text-start hover:bg-white/5 cursor-pointer transition"
									onclick={() => playSong(entry.song)}
									title="Play {entry.song.title}"
								>
									<span class="w-6 text-end text-secondary-600 tabular-nums">{i + 1}</span>
									<SongCover
										setId={entry.song.setId}
										track={entry.song.track}
										title={entry.song.title}
										class="size-10 rounded"
										lazy
									/>
									<span class="min-w-0 flex-1">
										<span
											class="block truncate font-semibold {isCurrent(entry.song)
												? 'text-primary-400'
												: ''}">{entry.song.title}</span
										>
										<span class="block truncate text-sm text-secondary-600"
											>{entry.song.artist}</span
										>
									</span>
									<span class="text-sm text-secondary-600 tabular-nums">
										{entry.plays}
										{entry.plays === 1 ? 'play' : 'plays'}
									</span>
								</button>
							</li>
						{/each}
					</ol>
				</section>

				<!-- Facts -->
				<section class="flex flex-col gap-3">
					<h2 class="text-xl font-bold tracking-tight">Facts</h2>
					{#each [data.onRepeat && { icon: 'icon-[mingcute--repeat-line]', colour: 'text-pink-300', title: 'On repeat', text: `"${data.onRepeat.song.title}", ${times(data.onRepeat.plays)} on ${day(data.onRepeat.date)}` }, data.streak > 1 && { icon: 'icon-[mingcute--fire-line]', colour: 'text-orange-300', title: `${data.streak} days in a row`, text: 'Your longest streak with music every day' }, data.busiestDay && { icon: 'icon-[mingcute--calendar-line]', colour: 'text-sky-300', title: 'Your biggest day', text: `${duration(data.busiestDay.seconds)} on ${day(data.busiestDay.date)}` }, { icon: 'icon-[mingcute--time-line]', colour: 'text-violet-300', title: `You're ${listener(busiestHour)}`, text: `You listen most around ${hourLabel(busiestHour)}` }, data.bpm && { icon: 'icon-[mingcute--heartbeat-line]', colour: 'text-rose-300', title: `${data.bpm} BPM`, text: 'The tempo of most of your songs' }, data.bestFind && { icon: 'icon-[mingcute--sparkles-line]', colour: 'text-lime-300', title: `${data.newSongs} new ${data.newSongs === 1 ? 'song' : 'songs'}`, text: `Your best find: "${data.bestFind.song.title}"` }, data.skips > 0 && { icon: 'icon-[mingcute--skip-forward-line]', colour: 'text-amber-300', title: `${data.skips} skipped`, text: 'Songs you left in their first seconds' }].filter(Boolean) as fact (fact.title)}
						<div class="flex items-center gap-4 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
							<span class="{fact.icon} {fact.colour} size-6 shrink-0"></span>
							<div class="min-w-0">
								<p class="font-bold">{fact.title}</p>
								<p class="text-sm text-secondary-600">{fact.text}</p>
							</div>
						</div>
					{/each}
				</section>
			</div>

			<!-- Top artists, mappers, genres… -->
			<section class="grid gap-8 md:grid-cols-2 xl:grid-cols-3">
				{#each [{ title: 'Top artists', list: data.topArtists, colour: '#38bdf8' }, { title: 'Top mappers', list: data.topMappers, colour: '#a3e635' }, { title: 'Top genres', list: data.topGenres, colour: '#f472b6' }, { title: 'Languages', list: data.topLanguages, colour: '#fbbf24' }, { title: 'From', list: data.topSources, colour: '#a78bfa' }].filter(({ list }) => list.length) as { title, list, colour } (title)}
					<div>
						<h3 class="text-sm font-bold uppercase tracking-wide text-secondary-600 mb-3">
							{title}
						</h3>
						<div class="flex flex-col gap-2.5">
							{#each list as entry (entry.name)}
								<div class="flex items-center gap-3 text-sm">
									{#if title === 'Top artists'}
										<SongCover
											setId={entry.top.setId}
											track={entry.top.track}
											title={entry.top.title}
											class="size-7 rounded-full shrink-0"
											lazy
										/>
									{/if}
									{#if title === 'Top mappers'}
										<MapperLink name={entry.name} class="w-32 shrink-0 truncate font-normal" />
									{:else}
										<span class="w-32 shrink-0 truncate" title={entry.name}>{entry.name}</span>
									{/if}
									<span class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
										<span
											class="block h-full rounded-full"
											style="width: {(entry.plays / widest(list)) * 100}%; background: {colour}"
										></span>
									</span>
									<span class="w-16 text-end tabular-nums text-secondary-600"
										>{entry.plays} {entry.plays === 1 ? 'play' : 'plays'}</span
									>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</section>

			<!-- When: the hours of the day and the days of the week -->
			<section class="grid gap-8 lg:grid-cols-[2fr_1fr]">
				<div>
					<div class="flex items-baseline justify-between mb-3">
						<h3 class="text-sm font-bold uppercase tracking-wide text-secondary-600">
							Time of day
						</h3>
						<p class="text-sm text-secondary-600 tabular-nums">
							{#if hoveredHour != null}
								{hourLabel(hoveredHour)}–{hourLabel((hoveredHour + 1) % 24)} · {Math.round(
									data.hours[hoveredHour]
								)} min
							{:else}
								Minutes per hour
							{/if}
						</p>
					</div>
					<div
						class="h-40 flex items-end gap-0.5"
						role="list"
						onmouseleave={() => (hoveredHour = null)}
					>
						{#each data.hours as value, hour (hour)}
							<div
								role="listitem"
								aria-label="{hourLabel(hour)}: {Math.round(value)} minutes"
								class="flex-1 h-full flex items-end"
								onmouseenter={() => (hoveredHour = hour)}
							>
								<span
									class="block w-full rounded-t transition-colors {hoveredHour === hour
										? 'bg-primary-300'
										: 'bg-primary-500/80'}"
									style="height: {value ? Math.max(2, (value / tallest(data.hours)) * 100) : 0}%"
								></span>
							</div>
						{/each}
					</div>
					<div class="relative mt-1.5 h-4 text-xs text-secondary-600 tabular-nums">
						{#each [0, 6, 12, 18] as hour (hour)}
							<span class="absolute" style="left: {(hour / 24) * 100}%">{hourLabel(hour)}</span>
						{/each}
					</div>
				</div>
				<div>
					<div class="flex items-baseline justify-between mb-3">
						<h3 class="text-sm font-bold uppercase tracking-wide text-secondary-600">Weekdays</h3>
						<p class="text-sm text-secondary-600 tabular-nums">
							{#if hoveredDay != null}
								{WEEKDAYS[hoveredDay]} · {Math.round(data.weekdays[hoveredDay])} min
							{:else}
								Minutes per day
							{/if}
						</p>
					</div>
					<div
						class="h-40 flex items-end gap-1.5"
						role="list"
						onmouseleave={() => (hoveredDay = null)}
					>
						{#each data.weekdays as value, i (i)}
							<div
								role="listitem"
								aria-label="{WEEKDAYS[i]}: {Math.round(value)} minutes"
								class="flex-1 h-full flex items-end"
								onmouseenter={() => (hoveredDay = i)}
							>
								<span
									class="block w-full rounded-t transition-colors {hoveredDay === i
										? 'bg-primary-300'
										: 'bg-primary-500/80'}"
									style="height: {value ? Math.max(2, (value / tallest(data.weekdays)) * 100) : 0}%"
								></span>
							</div>
						{/each}
					</div>
					<div class="mt-1.5 flex text-xs text-secondary-600">
						{#each WEEKDAYS as name (name)}
							<span class="flex-1 text-center">{name}</span>
						{/each}
					</div>
				</div>
			</section>

			{#if data.since}
				<p class="text-xs text-secondary-600">
					Counted on this device since {day(new Date(data.since * 1000), true)}. A song counts once
					you've heard it for 30 seconds.
				</p>
			{/if}
		</div>
	{/if}
</div>
