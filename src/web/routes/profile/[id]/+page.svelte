<script>
	const base = __WEB_BASE__;
	// An osu! player's profile, as in the desktop app: who they are, their ranks and numbers,
	// their best plays and their music (the songs they favourited, play most or mapped), all
	// to listen to, and their public Stosufy playlists. The id is a number, "me" or "@name".
	import { page } from '$app/state';
	import { goBack } from '../../../navigation';
	import { offline } from '../../../../lib/stores/network';
	import { user } from '../../../shims/user';
	import {
		osuProfile,
		userBeatmapsets,
		userScores,
		userPlaylists,
		flag,
		shortNumber,
		BEATMAP_LISTS
	} from '../../../../lib/stores/profile';
	import { otherPlaylists } from '../../../../lib/stores/playlist';
	import { play } from '../../../player';
	import { songOfSet, slim } from '../../../songs';
	import { handleImageError } from '../../../shims/data';
	import SongRow from '../../../SongRow.svelte';
	import Skeleton from '../../../Skeleton.svelte';
	import PlaylistCover from '../../../../lib/components/PlaylistCover.svelte';

	const SCORES = 10;
	const SETS = 20;
	/** The lists of songs, the ones to listen to first */
	const LISTS = ['favourite', 'most_played', 'ranked', 'loved', 'guest', 'pending', 'graveyard'];
	const GRADES = {
		XH: 'text-slate-200',
		X: 'text-amber-300',
		SH: 'text-slate-200',
		S: 'text-amber-300',
		A: 'text-green-400',
		B: 'text-sky-400',
		C: 'text-fuchsia-400',
		D: 'text-red-400'
	};
	const GRADE_NAMES = { XH: 'SS', X: 'SS', SH: 'S' };
	const gradeName = (rank) => GRADE_NAMES[rank] ?? rank;

	let asked = $derived(decodeURIComponent(page.params.id ?? ''));
	// What osu! is asked for: an id, or a name (the part after the at sign)
	let key = $derived(
		asked === 'me' ? ($user?.id ?? null) : asked.startsWith('@') ? asked.slice(1) : asked
	);

	let profile = $state(null);
	let error = $state('');
	let scores = $state([]);
	let moreScores = $state(false);
	let loadingScores = $state(false);
	let list = $state(
		/** @type {import('../../../../lib/stores/profile').BeatmapList} */ ('favourite')
	);
	let sets = $state([]);
	let moreSets = $state(false);
	let loadingSets = $state(false);
	let playlists = $state([]);

	$effect(() => {
		const which = key;
		profile = null;
		error = '';
		scores = [];
		sets = [];
		playlists = [];
		if (!which || $offline) return;
		osuProfile(which)
			.then((found) => {
				if (which !== key) return;
				profile = found;
				list = /** @type {any} */ (LISTS.find((name) => found.counts[name] > 0) ?? 'favourite');
				loadScores(found.id, true);
				userPlaylists(found.id)
					.then((all) => {
						if (which !== key) return;
						playlists = all;
						otherPlaylists.update((known) => {
							const next = { ...known };
							for (const playlist of all) next[playlist.id] = playlist;
							return next;
						});
					})
					.catch(() => {});
			})
			.catch((e) => {
				if (which === key) error = e instanceof Error ? e.message : String(e);
			});
	});

	async function loadScores(id, reset = false) {
		loadingScores = true;
		try {
			const found = await userScores(id, 'best', reset ? 0 : scores.length, SCORES);
			if (id !== profile?.id) return;
			scores = reset ? found : [...scores, ...found];
			moreScores = found.length === SCORES && scores.length < (profile.counts.best || 100);
		} catch {
			// (the profile shows without them)
		} finally {
			loadingScores = false;
		}
	}

	let setsRequest = 0;
	async function loadSets(reset = false) {
		const id = profile?.id;
		if (!id) return;
		const request = ++setsRequest;
		const which = list;
		if (reset) sets = [];
		loadingSets = true;
		try {
			const found = await userBeatmapsets(id, which, reset ? 0 : sets.length, SETS);
			if (request !== setsRequest) return;
			const songs = found.map((set) => ({ ...songOfSet(set), playcount: set.playcount }));
			sets = reset ? songs : [...sets, ...songs];
			moreSets = found.length === SETS && sets.length < profile.counts[which];
		} catch {
			if (request === setsRequest) moreSets = false;
		} finally {
			if (request === setsRequest) loadingSets = false;
		}
	}
	$effect(() => {
		void list;
		if (profile) loadSets(true);
	});

	let lists = $derived(
		profile
			? BEATMAP_LISTS.filter((entry) => LISTS.includes(entry.id) && profile.counts[entry.id] > 0)
			: []
	);
	/** The best plays as songs (the difficulty that was played) */
	let scoreSongs = $derived(
		scores.map((score) =>
			slim({
				id: score.set.id,
				title: score.set.title,
				artist: score.set.artist,
				creator: score.set.creator,
				beatmaps: [{ id: score.beatmap.id, version: score.beatmap.version }]
			})
		)
	);

	let stats = $derived(
		profile
			? [
					['Accuracy', profile.accuracy != null ? `${profile.accuracy.toFixed(2)}%` : '–'],
					['Play count', profile.playCount != null ? profile.playCount.toLocaleString() : '–'],
					[
						'Play time',
						profile.playTime != null
							? `${Math.round(profile.playTime / 3600).toLocaleString()} h`
							: '–'
					],
					['Level', profile.level ? String(profile.level.current) : '–'],
					['Ranked score', shortNumber(profile.rankedScore)],
					['Max combo', profile.maxCombo != null ? profile.maxCombo.toLocaleString() : '–'],
					['Medals', String(profile.medals)],
					['Followers', profile.followers.toLocaleString()]
				]
			: []
	);

	/** The rank of the last 90 days as a line (the best at the top) */
	let rankLine = $derived.by(() => {
		const ranks = (profile?.rankHistory ?? []).filter((rank) => rank > 0);
		if (ranks.length < 2) return '';
		const low = Math.min(...ranks);
		const high = Math.max(...ranks);
		const span = Math.max(1, high - low);
		return ranks
			.map(
				(rank, i) =>
					`${i ? 'L' : 'M'}${((i / (ranks.length - 1)) * 100).toFixed(1)} ${(2 + ((rank - low) / span) * 26).toFixed(1)}`
			)
			.join(' ');
	});
	let rankChange = $derived.by(() => {
		const ranks = (profile?.rankHistory ?? []).filter((rank) => rank > 0);
		return ranks.length < 2 ? 0 : ranks[0] - ranks[ranks.length - 1];
	});

	const joined = (date) =>
		date ? new Date(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';
</script>

<div class="relative">
	<div
		class="-mt-[env(safe-area-inset-top)] h-[calc(9rem+env(safe-area-inset-top))] bg-white/[0.04]"
	>
		{#if profile?.coverUrl}
			<img
				src={profile.coverUrl}
				alt=""
				class="w-full h-full object-cover"
				onerror={(e) => /** @type {HTMLElement} */ (e.currentTarget).classList.add('hidden')}
			/>
		{/if}
		<div class="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-panel"></div>
	</div>
	<a
		href="{base}/"
		onclick={(e) => {
			e.preventDefault();
			goBack(`${base}/`);
		}}
		aria-label="Back"
		class="absolute top-2 left-1 size-11 grid place-items-center rounded-full bg-black/40"
	>
		<span class="icon-[mingcute--left-line] size-7"></span>
	</a>
</div>

{#if $offline && !profile}
	<p class="px-4 py-10 text-center text-secondary-600">Profiles show up once you're connected.</p>
{:else if error}
	<div class="px-8 py-12 flex flex-col items-center gap-2 text-center">
		<span class="icon-[mingcute--user-x-line] size-10 text-secondary-600"></span>
		<p class="font-semibold">This player couldn't be found</p>
		<p class="text-sm text-secondary-600">{error}</p>
	</div>
{:else if !profile}
	<div class="-mt-10 px-4">
		<div class="size-24 rounded-full bg-white/[0.08] ring-4 ring-panel"></div>
	</div>
	<div class="mt-6"><Skeleton rows={6} /></div>
{:else}
	<header class="relative -mt-12 px-4">
		<div class="flex items-end gap-4">
			<span class="relative shrink-0">
				<img
					src={profile.avatarUrl ?? `https://a.ppy.sh/${profile.id}`}
					alt=""
					class="size-24 rounded-full object-cover bg-secondary-300 ring-4 ring-panel"
					onerror={handleImageError}
				/>
				{#if profile.online}
					<span
						class="absolute bottom-1 right-1 size-4 rounded-full bg-green-400 ring-[3px] ring-panel"
						title="Online"
					></span>
				{/if}
			</span>
			<a
				href="https://osu.ppy.sh/users/{profile.id}"
				target="_blank"
				rel="noopener"
				class="mb-2 ml-auto h-10 px-4 flex items-center gap-1.5 rounded-full bg-white/10 text-sm font-semibold active:bg-white/20"
			>
				<span class="icon-[mingcute--external-link-line] size-4"></span> osu!
			</a>
		</div>
		<h1
			class="mt-3 text-3xl font-extrabold tracking-tight break-words"
			style={profile.colour ? `color: ${profile.colour}` : ''}
		>
			{profile.username}
		</h1>
		<p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-secondary-600">
			{#if profile.country}
				<span>{flag(profile.country.code)} {profile.country.name}</span>
			{/if}
			{#if profile.title}<span class="text-white/80">{profile.title}</span>{/if}
			{#each profile.groups as group (group.short)}
				<span
					class="px-2 py-0.5 rounded-full bg-white/10 text-xs font-bold"
					style={group.colour ? `color: ${group.colour}` : ''}
					title={group.name}>{group.short}</span
				>
			{/each}
			{#if profile.supporter}
				<span class="icon-[mingcute--heart-fill] size-4 text-pink-400" title="osu! supporter"
				></span>
			{/if}
		</p>
		{#if profile.joined}
			<p class="mt-1 text-xs text-secondary-600">
				Plays osu! since {joined(profile.joined)}{profile.previousNames.length
					? ` · formerly ${profile.previousNames.slice(-2).join(', ')}`
					: ''}
			</p>
		{/if}
	</header>

	<section class="mt-4 px-3 grid grid-cols-3 gap-2" aria-label="Ranks">
		<a
			href="{base}/rankings"
			class="p-3 rounded-xl bg-white/[0.06] active:bg-white/10"
			aria-label="Global rank: open the rankings"
		>
			<span class="block text-xs text-secondary-600">Global</span>
			<span class="block text-lg font-extrabold tabular-nums truncate">
				{profile.globalRank ? `#${profile.globalRank.toLocaleString()}` : '–'}
			</span>
		</a>
		<a
			href={profile.country
				? `${base}/rankings?country=${profile.country.code}&name=${encodeURIComponent(profile.country.name)}`
				: `${base}/rankings`}
			class="p-3 rounded-xl bg-white/[0.06] active:bg-white/10"
			aria-label="Country rank: open the country's ranking"
		>
			<span class="block text-xs text-secondary-600">
				{profile.country ? flag(profile.country.code) : ''} Country
			</span>
			<span class="block text-lg font-extrabold tabular-nums truncate">
				{profile.countryRank ? `#${profile.countryRank.toLocaleString()}` : '–'}
			</span>
		</a>
		<div class="p-3 rounded-xl bg-white/[0.06]">
			<span class="block text-xs text-secondary-600">Performance</span>
			<span class="block text-lg font-extrabold tabular-nums truncate">
				{profile.pp != null ? `${Math.round(profile.pp).toLocaleString()}pp` : '–'}
			</span>
		</div>
	</section>

	{#if rankLine}
		<section class="mt-2 mx-3 p-3 rounded-xl bg-white/[0.04]">
			<div class="flex items-baseline justify-between text-xs text-secondary-600">
				<span>Global rank, last 90 days</span>
				{#if rankChange}
					<span class={rankChange > 0 ? 'text-green-400' : 'text-red-400'}>
						{rankChange > 0 ? '▲' : '▼'}
						{Math.abs(rankChange).toLocaleString()}
					</span>
				{/if}
			</div>
			<svg
				viewBox="0 0 100 30"
				preserveAspectRatio="none"
				class="mt-2 w-full h-12"
				aria-hidden="true"
			>
				<path
					d={rankLine}
					fill="none"
					stroke="var(--color-primary-400)"
					stroke-width="1.5"
					vector-effect="non-scaling-stroke"
					stroke-linejoin="round"
				/>
			</svg>
			{#if profile.highestRank}
				<p class="mt-1 text-xs text-secondary-600">
					Best ever: #{profile.highestRank.rank.toLocaleString()} ({joined(profile.highestRank.at)})
				</p>
			{/if}
		</section>
	{/if}

	<dl class="mt-2 px-3 grid grid-cols-4 gap-2">
		{#each stats as [label, value] (label)}
			<div class="p-2 rounded-lg bg-white/[0.04] text-center min-w-0">
				<dd class="text-sm font-bold tabular-nums truncate">{value}</dd>
				<dt class="text-[0.65rem] leading-tight text-secondary-600">{label}</dt>
			</div>
		{/each}
	</dl>

	{#if scores.length || loadingScores}
		<section class="mt-6">
			<div class="px-4 flex items-center justify-between">
				<h2 class="text-lg font-bold">Best plays</h2>
				{#if scoreSongs.length}
					<button
						class="h-10 px-3 flex items-center gap-1.5 rounded-full bg-white/[0.08] text-sm font-semibold"
						onclick={() => play(scoreSongs, 0)}
					>
						<span class="icon-[mingcute--play-fill] size-4"></span> Play all
					</button>
				{/if}
			</div>
			<ul class="px-2 mt-1">
				{#each scores as score, i (score.id)}
					<SongRow song={scoreSongs[i]} onplay={() => play(scoreSongs, i)}>
						{#snippet extra()}
							<span class="shrink-0 pl-2 text-end leading-tight">
								<span class="block text-sm font-bold tabular-nums">
									{score.pp != null ? `${Math.round(score.pp)}pp` : '–'}
								</span>
								<span class="block text-xs tabular-nums text-secondary-600">
									<span class="font-bold {GRADES[score.rank] ?? ''}">{gradeName(score.rank)}</span>
									{(score.accuracy * 100).toFixed(1)}%{score.mods.length
										? ` +${score.mods.join('')}`
										: ''}
								</span>
							</span>
						{/snippet}
					</SongRow>
				{/each}
			</ul>
			{#if !scores.length}
				<Skeleton rows={4} />
			{:else if moreScores}
				<div class="px-4 pt-1">
					<button
						class="h-10 px-5 rounded-full bg-white/10 text-sm font-semibold disabled:opacity-40"
						disabled={loadingScores}
						onclick={() => loadScores(profile.id)}
					>
						More plays
					</button>
				</div>
			{/if}
		</section>
	{/if}

	{#if lists.length}
		<section class="mt-6">
			<h2 class="px-4 text-lg font-bold">Their music</h2>
			<div
				class="mt-2 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none]"
				data-no-swipe
				role="tablist"
				aria-label="Songs"
			>
				{#each lists as entry (entry.id)}
					<button
						role="tab"
						aria-selected={list === entry.id}
						class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold transition {list ===
						entry.id
							? 'bg-white text-black'
							: 'bg-white/[0.08] text-white/80'}"
						onclick={() => (list = entry.id)}
					>
						{entry.label}
						<span class="opacity-60">{profile.counts[entry.id].toLocaleString()}</span>
					</button>
				{/each}
			</div>
			{#if loadingSets && !sets.length}
				<div class="mt-2"><Skeleton rows={5} /></div>
			{/if}
			<ul class="px-2 mt-2">
				{#each sets as song, i (`${song.id}:${i}`)}
					<SongRow {song} onplay={() => play(sets, i)}>
						{#snippet extra()}
							{#if song.playcount}
								<span class="shrink-0 pl-2 text-xs tabular-nums text-secondary-600">
									{song.playcount.toLocaleString()}×
								</span>
							{/if}
						{/snippet}
					</SongRow>
				{/each}
			</ul>
			{#if moreSets && sets.length}
				<div class="px-4 pt-1">
					<button
						class="h-10 px-5 rounded-full bg-white/10 text-sm font-semibold disabled:opacity-40"
						disabled={loadingSets}
						onclick={() => loadSets(false)}
					>
						More songs
					</button>
				</div>
			{/if}
		</section>
	{/if}

	{#if playlists.length}
		<section class="mt-6">
			<h2 class="px-4 text-lg font-bold">Public playlists</h2>
			<ul class="px-2 mt-1 grid grid-cols-2 gap-1">
				{#each playlists as playlist (playlist.id)}
					<li>
						<a
							href="{base}/playlist/{playlist.id}"
							class="block p-2 rounded-lg active:bg-white/[0.06]"
						>
							<PlaylistCover
								{playlist}
								class="w-full aspect-square rounded-md shadow-lg shadow-black/40"
								iconClass="size-12"
							/>
							<p class="mt-2 font-semibold truncate">{playlist.title}</p>
							<p class="text-sm text-secondary-600">
								{playlist.song_amount}
								{playlist.song_amount === 1 ? 'song' : 'songs'}
							</p>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	<div class="h-6"></div>
{/if}
