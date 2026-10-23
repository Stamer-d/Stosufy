<script>
	// A profile like on the osu! website: who the user is, their ranks and stats, their top
	// plays and beatmaps (to preview and download), what they listen to now (friends), their
	// public playlists, and for the user themselves what their library is made of
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { open } from '@tauri-apps/plugin-shell';
	import { user } from '#lib/stores/user.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import { mapDataStore, downloads, downloadBeatmap } from '#lib/stores/data.ts';
	import { setSongQueue, currentSong, togglePlayback } from '#lib/stores/audio.ts';
	import { playlists } from '#lib/stores/playlist.ts';
	import { favourites } from '#lib/stores/favourites.ts';
	import { friendActivity, listenAlong } from '#lib/stores/friends.ts';
	import { noteNetworkError } from '#lib/stores/network.ts';
	import {
		osuProfile,
		userPlaylists,
		userBeatmapsets,
		userScores,
		beatmapset,
		flag,
		libraryStats,
		BEATMAP_LISTS
	} from '#lib/stores/profile.ts';
	import { difficultyColor } from '#lib/beatmapStatus.ts';
	import PlaylistCover from '#lib/components/PlaylistCover.svelte';
	import Beatmap from '#lib/components/Beatmap.svelte';
	import MapperLink from '#lib/components/MapperLink.svelte';
	import Triangles from '#lib/components/Triangles.svelte';

	// 'me', an osu! id or @name
	let key = $derived(
		page.params.id === 'me'
			? Number($user?.id)
			: page.params.id.startsWith('@')
				? decodeURIComponent(page.params.id.slice(1))
				: Number(page.params.id)
	);

	let profile = $state(null);
	let error = $state('');
	let publicPlaylists = $state(null);

	let id = $derived(profile?.id ?? (typeof key === 'number' ? key : 0));
	let mine = $derived(!!$user?.id && id === Number($user.id));
	let accent = $derived(profile?.colour || 'var(--color-primary-400)');

	$effect(() => {
		const wanted = key;
		profile = null;
		error = '';
		publicPlaylists = null;
		scoreLists = {};
		beatmapLists = {};
		if (!wanted || (typeof wanted === 'number' && !(wanted > 0))) return;
		osuProfile(wanted)
			.then((result) => {
				if (wanted !== key) return;
				profile = result;
				userPlaylists(result.id)
					.then((lists) => wanted === key && (publicPlaylists = lists))
					.catch(() => wanted === key && (publicPlaylists = []));
				loadScores('best');
				const first = BEATMAP_LISTS.find((list) => result.counts[list.id] > 0);
				beatmapTab = first?.id ?? 'favourite';
				loadBeatmaps(beatmapTab);
			})
			.catch((e) => wanted === key && (error = e.message ?? String(e)));
	});

	let friend = $derived($friendActivity.friends.find((f) => f.osuId === id) ?? null);
	let stats = $derived(mine ? libraryStats($mapDataStore) : null);
	let ownPlaylists = $derived(mine ? $playlists.filter((p) => Number(p.id) > 0) : []);

	// Top plays and beatmaps, loaded a page at a time
	const SCORE_KINDS = [
		{ id: 'best', label: 'Best performance' },
		{ id: 'firsts', label: 'First places' },
		{ id: 'recent', label: 'Recent' }
	];
	let scoreTab = $state('best');
	let scoreLists = $state({});
	let beatmapTab = $state('ranked');
	let beatmapLists = $state({});

	async function loadScores(kind) {
		// Through the state proxy, so the changes show
		scoreLists[kind] ??= { items: [], loading: false, done: false };
		const list = scoreLists[kind];
		if (list.loading || list.done) return;
		list.loading = true;
		const osuId = id;
		try {
			const items = await userScores(osuId, kind, list.items.length, 10);
			if (osuId !== id) return;
			list.items = [...list.items, ...items];
			list.done = items.length < 10 || (kind === 'best' && list.items.length >= 100);
		} catch (e) {
			noteNetworkError(e);
			list.done = true;
		} finally {
			list.loading = false;
		}
	}

	async function loadBeatmaps(kind) {
		// Through the state proxy, so the changes show
		beatmapLists[kind] ??= { items: [], loading: false, done: false };
		const list = beatmapLists[kind];
		if (list.loading || list.done) return;
		list.loading = true;
		const osuId = id;
		try {
			const items = await userBeatmapsets(osuId, kind, list.items.length, 12);
			if (osuId !== id) return;
			// Most played can have several difficulties of one set
			// (also within one page: two difficulties of a set are one card)
			const known = new Set(list.items.map((set) => set.id));
			const added = items.filter((set) => !known.has(set.id) && known.add(set.id));
			list.items = [...list.items, ...added];
			list.done = items.length < 12;
		} catch (e) {
			noteNetworkError(e);
			list.done = true;
		} finally {
			list.loading = false;
		}
	}

	function showScores(kind) {
		scoreTab = kind;
		loadScores(kind);
	}
	function showBeatmaps(kind) {
		beatmapTab = kind;
		loadBeatmaps(kind);
	}

	// Previews of the beatmaps (like in the search)
	let playMap = $state(null);
	$effect(() => {
		if (playMap === null) return;
		const sets = beatmapLists[beatmapTab]?.items ?? [];
		setSongQueue(
			sets.findIndex((set) => set.id === playMap.id),
			sets,
			'preview'
		);
		playMap = null;
	});

	// A score's beatmap set is loaded whole when it is played or downloaded
	let loadingSet = $state(null);
	async function withSet(score, action) {
		loadingSet = score.id;
		try {
			await action(await beatmapset(score.set.id));
		} catch (e) {
			noteNetworkError(e);
		} finally {
			loadingSet = null;
		}
	}
	const scorePlaying = (score) => $currentSong.song?.id == score.set.id && $currentSong.isPlaying;
	function playScore(score) {
		if ($currentSong.song?.id == score.set.id) return togglePlayback();
		withSet(score, (set) => setSongQueue(0, [set], 'preview'));
	}
	function downloadScore(score) {
		withSet(score, (set) =>
			downloadBeatmap(set, score.beatmap.id, $keyStore.sessionKey, $keyStore.access_token).catch(
				() => {}
			)
		);
	}

	// The rank graph: lower ranks are higher up
	let hovered = $state(null);
	let graph = $derived.by(() => {
		const ranks = (profile?.rankHistory ?? []).filter((rank) => rank > 0);
		if (ranks.length < 2) return null;
		const best = Math.min(...ranks);
		const worst = Math.max(...ranks);
		const span = Math.max(1, worst - best);
		const points = ranks.map((rank, i) => [
			(i / (ranks.length - 1)) * 100,
			8 + ((rank - best) / span) * 84
		]);
		const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
		return { ranks, points, line, area: `${line} L100,100 L0,100 Z` };
	});
	function hoverGraph(event) {
		const box = event.currentTarget.getBoundingClientRect();
		const i = Math.round(((event.clientX - box.left) / box.width) * (graph.ranks.length - 1));
		hovered = Math.max(0, Math.min(graph.ranks.length - 1, i));
	}

	const GRADES = [
		{ key: 'ssh', label: 'SS', silver: true },
		{ key: 'ss', label: 'SS' },
		{ key: 'sh', label: 'S', silver: true },
		{ key: 's', label: 'S' },
		{ key: 'a', label: 'A' }
	];
	const GRADE_COLOURS = {
		XH: '#dfe8ee',
		X: '#ffd75e',
		SH: '#dfe8ee',
		S: '#ffd75e',
		A: '#88da20',
		B: '#3daaf5',
		C: '#d55df5',
		D: '#ff5a5a',
		F: '#8a8a8a'
	};
	const gradeLabel = (rank) => (rank === 'XH' || rank === 'X' ? 'SS' : rank === 'SH' ? 'S' : rank);

	const hours = (seconds) =>
		seconds >= 3600 ? `${Math.round(seconds / 360) / 10} h` : `${Math.round(seconds / 60)} min`;
	const playTime = (seconds) => {
		if (!seconds) return '–';
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
	};
	const number = (value) => (value == null ? '–' : Math.round(value).toLocaleString());
	const date = (value) =>
		value
			? new Date(value).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				})
			: '';
	const ago = (value) => {
		if (!value) return '';
		const s = (Date.now() - new Date(value).getTime()) / 1000;
		if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
		if (s < 86400) return `${Math.round(s / 3600)} h ago`;
		if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
		return date(value);
	};
	const widest = (list) => Math.max(1, ...list.map(([, n]) => n));
	const isDownloaded = (setId) => !!$mapDataStore[String(setId)];
</script>

<div class="pb-12" style="--accent: {accent}">
	<!-- Header: the osu! cover, avatar and name -->
	<div class="relative h-80 overflow-hidden">
		{#if profile?.coverUrl}
			<img src={profile.coverUrl} alt="" class="absolute inset-0 size-full object-cover" />
		{:else}
			<div
				class="absolute inset-0 bg-gradient-to-br from-[var(--accent)] via-primary-700/60 to-secondary-200 opacity-70"
			></div>
			<Triangles count={18} seed={id || 1} />
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/50 to-black/10"></div>
		<div
			class="absolute inset-x-0 bottom-0 h-1"
			style="background: linear-gradient(90deg, var(--accent), transparent)"
		></div>
		<div class="absolute bottom-6 left-6 right-6 flex items-end gap-6">
			<div class="relative shrink-0">
				<img
					src={profile?.avatarUrl ?? friend?.avatarUrl ?? '/logo.png'}
					alt=""
					class="size-36 rounded-[28px] object-cover shadow-2xl shadow-black/50 ring-4"
					style="--tw-ring-color: color-mix(in srgb, var(--accent) 60%, transparent)"
				/>
				{#if profile?.online || friend?.online}
					<span
						class="absolute -bottom-1 -right-1 size-6 rounded-full bg-green-400 ring-4 ring-panel"
						title="Online"
					></span>
				{/if}
			</div>
			<div class="min-w-0 flex-1 pb-1">
				<div class="flex flex-wrap items-center gap-2">
					{#if profile?.supporter}
						<span
							class="flex items-center gap-0.5 px-2 h-6 rounded-full bg-pink-500 text-xs font-bold"
							title="osu!supporter"
						>
							{#each Array(Math.min(3, profile.supporter)) as _, i (i)}
								<span class="icon-[mingcute--heart-fill] size-3.5"></span>
							{/each}
						</span>
					{/if}
					{#each profile?.groups ?? [] as group (group.short)}
						<span
							class="px-2 h-6 grid place-items-center rounded-full text-xs font-extrabold bg-black/40 backdrop-blur"
							style="color: {group.colour ?? 'white'}"
							title={group.name}>{group.short}</span
						>
					{/each}
					{#if !profile}
						<span class="text-sm font-semibold text-white/70"
							>{mine ? 'Your profile' : 'Profile'}</span
						>
					{/if}
				</div>
				<h1 class="mt-1 text-5xl font-extrabold tracking-tight truncate drop-shadow-lg">
					{profile?.username ?? friend?.username ?? (error ? 'Unknown user' : '…')}
				</h1>
				{#if profile}
					{#if profile.title}
						<p class="font-bold" style="color: {accent}">{profile.title}</p>
					{/if}
					<p class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
						{#if profile.country}
							<span>{flag(profile.country.code)} {profile.country.name}</span>
						{/if}
						<span class="flex items-center gap-1">
							<span class="icon-[mingcute--user-follow-line] size-4"></span>
							{number(profile.followers)} followers
						</span>
						{#if profile.mappingFollowers}
							<span class="flex items-center gap-1">
								<span class="icon-[mingcute--notification-line] size-4"></span>
								{number(profile.mappingFollowers)} mapping subscribers
							</span>
						{/if}
						{#if profile.joined}<span>Joined {date(profile.joined)}</span>{/if}
						{#if !profile.online && profile.lastVisit}<span>Last seen {ago(profile.lastVisit)}</span
							>{/if}
					</p>
				{/if}
			</div>
			<button
				class="mb-2 flex items-center gap-2 h-9 px-4 rounded-full bg-black/40 backdrop-blur ring-1 ring-white/15 text-sm font-semibold hover:bg-black/60 cursor-pointer transition"
				onclick={() => open(`https://osu.ppy.sh/users/${id}`)}
			>
				<span class="icon-[mingcute--external-link-line] size-4"></span>
				osu! website
			</button>
		</div>
	</div>

	<div class="px-6 flex flex-col gap-10">
		{#if error && !profile}
			<p class="text-secondary-600">Couldn't load the osu! profile: {error}</p>
		{/if}

		<!-- What a friend listens to now -->
		{#if friend?.playback}
			<section
				class="flex items-center gap-4 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5 max-w-xl"
			>
				<span
					class="grid place-items-center size-11 rounded-full {friend.online
						? 'bg-green-500/15 text-green-400'
						: 'bg-white/5 text-secondary-600'}"
				>
					<span class="icon-[mingcute--headphone-line] size-6"></span>
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold uppercase tracking-wide text-secondary-600">
						{friend.online && friend.playback.playing ? 'Listening now' : 'Last played'}
					</p>
					<p class="font-semibold truncate">{friend.playback.title}</p>
					<p class="text-sm text-secondary-600 truncate">{friend.playback.artist}</p>
				</div>
				{#if friend.online}
					<button
						class="h-9 px-4 rounded-full bg-white text-black text-sm font-semibold hover:scale-[1.03] cursor-pointer transition"
						onclick={() => listenAlong(friend)}
					>
						Listen along
					</button>
				{/if}
			</section>
		{/if}

		{#if profile}
			<!-- Ranks and the rank graph -->
			<section class="grid gap-4 xl:grid-cols-[1fr_22rem]">
				<div class="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 p-5 overflow-hidden">
					<div class="flex flex-wrap items-end gap-x-10 gap-y-3">
						<div>
							<p class="text-xs font-bold uppercase tracking-wide text-secondary-600">
								Global ranking
							</p>
							<p class="text-4xl font-extrabold tabular-nums" style="color: {accent}">
								{profile.globalRank ? `#${number(profile.globalRank)}` : '–'}
							</p>
						</div>
						<div>
							<p class="text-xs font-bold uppercase tracking-wide text-secondary-600">
								Country ranking
							</p>
							<p class="text-2xl font-extrabold tabular-nums">
								{profile.countryRank ? `#${number(profile.countryRank)}` : '–'}
							</p>
						</div>
						<div>
							<p class="text-xs font-bold uppercase tracking-wide text-secondary-600">pp</p>
							<p class="text-2xl font-extrabold tabular-nums text-pink-300">{number(profile.pp)}</p>
						</div>
						{#if profile.highestRank}
							<p class="ms-auto text-sm text-secondary-600">
								Highest rank <span class="font-bold text-white"
									>#{number(profile.highestRank.rank)}</span
								>
								on {date(profile.highestRank.at)}
							</p>
						{/if}
					</div>
					{#if graph}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="relative mt-4 h-28"
							onmousemove={hoverGraph}
							onmouseleave={() => (hovered = null)}
						>
							<svg
								viewBox="0 0 100 100"
								preserveAspectRatio="none"
								class="size-full overflow-visible"
							>
								<defs>
									<linearGradient id="rank-fill" x1="0" x2="0" y1="0" y2="1">
										<stop offset="0" stop-color={accent} stop-opacity="0.35" />
										<stop offset="1" stop-color={accent} stop-opacity="0" />
									</linearGradient>
								</defs>
								<path d={graph.area} fill="url(#rank-fill)" />
								<path
									d={graph.line}
									fill="none"
									stroke={accent}
									stroke-width="2.5"
									vector-effect="non-scaling-stroke"
									stroke-linejoin="round"
								/>
							</svg>
							{#if hovered !== null}
								{@const [x, y] = graph.points[hovered]}
								<span
									class="absolute size-3 -ml-1.5 -mt-1.5 rounded-full bg-white ring-4"
									style="left: {x}%; top: {y}%; --tw-ring-color: {accent}"
								></span>
								<span
									class="absolute -translate-x-1/2 -translate-y-full -mt-3 px-2 py-1 rounded-md bg-black/80 text-xs font-semibold whitespace-nowrap pointer-events-none"
									style="left: clamp(3rem, {x}%, calc(100% - 3rem)); top: {y}%"
								>
									#{number(graph.ranks[hovered])} · {graph.ranks.length - 1 - hovered
										? `${graph.ranks.length - 1 - hovered} days ago`
										: 'now'}
								</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Level, grades and medals -->
				<div class="rounded-2xl bg-white/[0.04] ring-1 ring-white/5 p-5 flex flex-col gap-4">
					{#if profile.level}
						<div class="flex items-center gap-3">
							<span
								class="grid place-items-center size-12 shrink-0 rotate-45 rounded-xl ring-2 font-extrabold"
								style="--tw-ring-color: {accent}"
							>
								<span class="-rotate-45">{profile.level.current}</span>
							</span>
							<div class="flex-1">
								<div class="h-2 rounded-full bg-white/10 overflow-hidden">
									<div
										class="h-full rounded-full"
										style="width: {profile.level.progress}%; background: {accent}"
									></div>
								</div>
								<p class="mt-1 text-xs text-secondary-600">
									Level {profile.level.current} · {profile.level.progress}%
								</p>
							</div>
						</div>
					{/if}
					<div class="grid grid-cols-5 gap-2">
						{#each GRADES as grade (grade.key)}
							<div class="flex flex-col items-center gap-1">
								<span
									class="w-full h-9 grid place-items-center rounded-full text-lg font-black italic"
									style="background: {grade.silver
										? 'linear-gradient(135deg,#f0f4f8,#9aa7b2)'
										: grade.label === 'A'
											? 'linear-gradient(135deg,#a7f04a,#4f9a10)'
											: 'linear-gradient(135deg,#ffe58a,#e6a522)'}; color: {grade.silver
										? '#33424e'
										: grade.label === 'A'
											? '#1d3a05'
											: '#6b3d00'}">{grade.label}</span
								>
								<span class="text-sm font-semibold tabular-nums"
									>{number(profile.grades[grade.key])}</span
								>
							</div>
						{/each}
					</div>
					<div class="flex items-center gap-4 text-sm text-secondary-600">
						<span class="flex items-center gap-1.5">
							<span class="icon-[mingcute--medal-line] size-4 text-amber-300"></span>
							<span class="font-bold text-white">{profile.medals}</span> medals
						</span>
						{#if profile.kudosu}
							<span class="flex items-center gap-1.5">
								<span class="icon-[mingcute--star-line] size-4 text-sky-300"></span>
								<span class="font-bold text-white">{number(profile.kudosu)}</span> kudosu
							</span>
						{/if}
					</div>
				</div>
			</section>

			<!-- Stats -->
			<section class="grid grid-cols-2 md:grid-cols-4 gap-3">
				{#each [['icon-[mingcute--target-line]', 'text-lime-300', 'Accuracy', profile.accuracy != null ? `${profile.accuracy.toFixed(2)}%` : '–'], ['icon-[mingcute--play-circle-line]', 'text-sky-300', 'Play count', number(profile.playCount)], ['icon-[mingcute--time-line]', 'text-violet-300', 'Play time', playTime(profile.playTime)], ['icon-[mingcute--fire-line]', 'text-orange-300', 'Max combo', `${number(profile.maxCombo)}x`], ['icon-[mingcute--trophy-line]', 'text-amber-300', 'Ranked score', number(profile.rankedScore)], ['icon-[mingcute--chart-bar-line]', 'text-pink-300', 'Total score', number(profile.totalScore)], ['icon-[mingcute--cursor-2-line]', 'text-teal-300', 'Total hits', number(profile.totalHits)], ['icon-[mingcute--eye-2-line]', 'text-rose-300', 'Replays watched by others', number(profile.replaysWatched)]] as [icon, colour, label, value] (label)}
					<div class="p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
						<span class="{icon} {colour} size-5"></span>
						<p class="mt-2 text-xl font-extrabold tabular-nums truncate">{value}</p>
						<p class="text-sm text-secondary-600 truncate">{label}</p>
					</div>
				{/each}
			</section>

			<!-- Badges and about -->
			{#if profile.badges.length || profile.location || profile.interests || profile.occupation || profile.website || profile.twitter || profile.discord || profile.previousNames.length}
				<section class="flex flex-col gap-4">
					{#if profile.badges.length}
						<div class="flex flex-wrap gap-2">
							{#each profile.badges as badge (badge.image + badge.awarded)}
								<img
									src={badge.image}
									alt={badge.description}
									title="{badge.description} ({date(badge.awarded)})"
									class="h-10 rounded"
								/>
							{/each}
						</div>
					{/if}
					<div class="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/80">
						{#if profile.previousNames.length}
							<span title="Previously known as">
								<span class="icon-[mingcute--history-line] size-4 align-[-3px] text-secondary-600"
								></span>
								{profile.previousNames.join(', ')}
							</span>
						{/if}
						{#if profile.location}
							<span>
								<span class="icon-[mingcute--location-line] size-4 align-[-3px] text-secondary-600"
								></span>
								{profile.location}
							</span>
						{/if}
						{#if profile.interests}
							<span>
								<span class="icon-[mingcute--heart-line] size-4 align-[-3px] text-secondary-600"
								></span>
								{profile.interests}
							</span>
						{/if}
						{#if profile.occupation}
							<span>
								<span class="icon-[mingcute--briefcase-line] size-4 align-[-3px] text-secondary-600"
								></span>
								{profile.occupation}
							</span>
						{/if}
						{#if profile.discord}
							<span>
								<span class="icon-[mingcute--discord-line] size-4 align-[-3px] text-indigo-300"
								></span>
								{profile.discord}
							</span>
						{/if}
						{#if profile.twitter}
							<button
								class="hover:underline cursor-pointer"
								onclick={() => open(`https://twitter.com/${profile.twitter}`)}
							>
								<span class="icon-[mingcute--twitter-line] size-4 align-[-3px] text-sky-300"></span>
								@{profile.twitter}
							</button>
						{/if}
						{#if profile.website}
							<button class="hover:underline cursor-pointer" onclick={() => open(profile.website)}>
								<span class="icon-[mingcute--link-line] size-4 align-[-3px] text-secondary-600"
								></span>
								{profile.website.replace(/^https?:\/\//, '')}
							</button>
						{/if}
					</div>
				</section>
			{/if}

			<!-- Top plays -->
			<section>
				<div class="flex flex-wrap items-center gap-2 mb-4">
					<h2 class="text-xl font-bold tracking-tight me-3">Ranks</h2>
					{#each SCORE_KINDS as kind (kind.id)}
						<button
							class="h-8 px-3.5 rounded-full text-sm font-semibold cursor-pointer transition {scoreTab ===
							kind.id
								? 'text-black'
								: 'bg-white/[0.06] hover:bg-white/10'}"
							style={scoreTab === kind.id ? `background: ${accent}` : ''}
							onclick={() => showScores(kind.id)}
						>
							{kind.label}
							{#if kind.id === 'firsts' && profile.counts.firsts}
								<span class="opacity-70">{number(profile.counts.firsts)}</span>
							{/if}
						</button>
					{/each}
				</div>
				{#if scoreLists[scoreTab]?.items.length}
					<div class="flex flex-col gap-1.5">
						{#each scoreLists[scoreTab].items as score, i (score.id ?? i)}
							<div
								class="group relative flex items-center gap-4 h-16 pe-3 rounded-xl overflow-hidden bg-white/[0.04] hover:bg-white/[0.08] ring-1 ring-white/5 transition"
							>
								<span
									class="absolute inset-y-0 left-0 w-1"
									style="background: {GRADE_COLOURS[score.rank] ?? '#888'}"
								></span>
								<button
									class="relative h-full aspect-[4/3] shrink-0 overflow-hidden cursor-pointer"
									aria-label="Preview {score.set.title}"
									onclick={() => playScore(score)}
								>
									<img
										src="https://assets.ppy.sh/beatmaps/{score.set.id}/covers/list@2x.jpg"
										alt=""
										loading="lazy"
										class="size-full object-cover"
									/>
									<span
										class="absolute inset-0 grid place-items-center bg-black/50 transition {scorePlaying(
											score
										) || loadingSet === score.id
											? 'opacity-100'
											: 'opacity-0 group-hover:opacity-100'}"
									>
										<span
											class="size-6 {loadingSet === score.id
												? 'icon-[svg-spinners--ring-resize]'
												: scorePlaying(score)
													? 'icon-[mingcute--pause-fill]'
													: 'icon-[mingcute--play-fill]'}"
										></span>
									</span>
								</button>
								<span
									class="w-9 shrink-0 text-center text-2xl font-black italic"
									style="color: {GRADE_COLOURS[score.rank] ?? '#888'}"
									>{gradeLabel(score.rank)}</span
								>
								<div class="min-w-0 flex-1">
									<p class="font-semibold truncate">
										{score.set.title}
										<span class="font-normal text-secondary-600">by {score.set.artist}</span>
									</p>
									<p class="flex items-center gap-2 text-sm text-secondary-600 min-w-0">
										<span
											class="shrink-0 px-1.5 rounded-full text-[11px] font-bold text-black"
											style="background: {difficultyColor(score.beatmap.stars)}"
											>★ {score.beatmap.stars.toFixed(2)}</span
										>
										<span class="truncate">{score.beatmap.version}</span>
										<span class="shrink-0">· <MapperLink name={score.set.creator} /></span>
										<span class="shrink-0">· {ago(score.at)}</span>
									</p>
								</div>
								{#if score.mods.length}
									<div class="hidden md:flex gap-1 shrink-0">
										{#each score.mods as mod (mod)}
											<span
												class="px-1.5 py-0.5 rounded bg-amber-400/90 text-[11px] font-extrabold text-black"
												>{mod}</span
											>
										{/each}
									</div>
								{/if}
								<span
									class="w-16 shrink-0 text-end text-sm font-semibold text-lime-200 tabular-nums"
									>{(score.accuracy * 100).toFixed(2)}%</span
								>
								<span class="w-20 shrink-0 text-end">
									<span class="block font-extrabold tabular-nums text-pink-300"
										>{score.pp != null ? `${Math.round(score.pp)}pp` : '–'}</span
									>
									{#if score.weight != null && score.pp != null}
										<span class="block text-[11px] text-secondary-600 tabular-nums"
											>{Math.round(score.weight)}% · {Math.round(
												(score.pp * score.weight) / 100
											)}pp</span
										>
									{/if}
								</span>
								{#if isDownloaded(score.set.id)}
									<span class="size-8 grid place-items-center text-primary-500" title="Downloaded">
										<span class="icon-[mingcute--check-circle-fill] size-5"></span>
									</span>
								{:else if $downloads[score.set.id]?.isDownloading}
									<span
										class="size-8 grid place-items-center text-xs font-semibold text-primary-500"
										>{Math.round($downloads[score.set.id].progress || 0)}%</span
									>
								{:else}
									<button
										title="Download"
										aria-label="Download {score.set.title}"
										class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 cursor-pointer transition"
										onclick={() => downloadScore(score)}
									>
										<span class="icon-[mingcute--download-2-line] size-5"></span>
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{:else if scoreLists[scoreTab]?.done}
					<p class="text-sm text-secondary-600">No plays here.</p>
				{/if}
				{#if scoreLists[scoreTab]?.loading}
					<span class="mt-3 block size-6 icon-[svg-spinners--ring-resize]" style="color: {accent}"
					></span>
				{:else if scoreLists[scoreTab] && !scoreLists[scoreTab].done}
					<button
						class="mt-3 h-9 px-4 rounded-full bg-white/[0.06] hover:bg-white/10 text-sm font-semibold cursor-pointer transition"
						onclick={() => loadScores(scoreTab)}>Show more</button
					>
				{/if}
			</section>

			<!-- Beatmaps -->
			<section>
				<div class="flex flex-wrap items-center gap-2 mb-4">
					<h2 class="text-xl font-bold tracking-tight me-3">Beatmaps</h2>
					{#each BEATMAP_LISTS.filter((list) => profile.counts[list.id] > 0 || list.id === 'favourite') as list (list.id)}
						<button
							class="h-8 px-3.5 rounded-full text-sm font-semibold cursor-pointer transition {beatmapTab ===
							list.id
								? 'text-black'
								: 'bg-white/[0.06] hover:bg-white/10'}"
							style={beatmapTab === list.id ? `background: ${accent}` : ''}
							onclick={() => showBeatmaps(list.id)}
						>
							{list.label} <span class="opacity-70">{number(profile.counts[list.id])}</span>
						</button>
					{/each}
				</div>
				{#if beatmapLists[beatmapTab]?.items.length}
					<div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-x-5 gap-y-7">
						{#each beatmapLists[beatmapTab].items as set (set.id)}
							<Beatmap bind:playMap map={set} isDownloaded={isDownloaded(set.id)} />
						{/each}
					</div>
				{:else if beatmapLists[beatmapTab]?.done}
					<p class="text-sm text-secondary-600">No beatmaps here.</p>
				{/if}
				{#if beatmapLists[beatmapTab]?.loading}
					<span class="mt-3 block size-6 icon-[svg-spinners--ring-resize]" style="color: {accent}"
					></span>
				{:else if beatmapLists[beatmapTab] && !beatmapLists[beatmapTab].done}
					<button
						class="mt-3 h-9 px-4 rounded-full bg-white/[0.06] hover:bg-white/10 text-sm font-semibold cursor-pointer transition"
						onclick={() => loadBeatmaps(beatmapTab)}>Show more</button
					>
				{/if}
			</section>
		{/if}

		<!-- The user's own library -->
		{#if stats}
			<section>
				<h2 class="text-xl font-bold tracking-tight mb-4">Your library</h2>
				<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
					{#each [['icon-[mingcute--download-2-line]', 'text-sky-300', 'Downloaded songs', number(stats.songs)], ['icon-[mingcute--time-line]', 'text-violet-300', 'Of music', hours(stats.seconds)], ['icon-[mingcute--heart-line]', 'text-pink-300', 'Liked songs', number($favourites.length)], ['icon-[mingcute--playlist-line]', 'text-lime-300', 'Playlists', number(ownPlaylists.length)]] as [icon, colour, label, value] (label)}
						<div class="p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
							<span class="{icon} {colour} size-5"></span>
							<p class="mt-2 text-2xl font-extrabold tabular-nums">{value}</p>
							<p class="text-sm text-secondary-600">{label}</p>
						</div>
					{/each}
				</div>
				<div class="mt-6 grid gap-6 lg:grid-cols-3">
					{#each [{ title: 'Top genres', list: stats.genres, colour: '#f472b6' }, { title: 'Top artists', list: stats.artists, colour: '#38bdf8' }, { title: 'Top mappers', list: stats.mappers, colour: '#a3e635' }] as { title, list, colour } (title)}
						<div>
							<h3 class="text-sm font-bold uppercase tracking-wide text-secondary-600 mb-3">
								{title}
							</h3>
							{#if list.length}
								<div class="flex flex-col gap-2">
									{#each list as [name, count] (name)}
										<div class="flex items-center gap-3 text-sm">
											{#if title === 'Top mappers'}
												<MapperLink {name} class="w-32 shrink-0 truncate font-normal" />
											{:else}
												<span class="w-32 shrink-0 truncate" title={name}>{name}</span>
											{/if}
											<span class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
												<span
													class="block h-full rounded-full"
													style="width: {(count / widest(list)) * 100}%; background: {colour}"
												></span>
											</span>
											<span class="w-8 text-end tabular-nums text-secondary-600">{count}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-sm text-secondary-600">
									{title === 'Top genres'
										? 'Genres show up once your songs are looked up (a few seconds each).'
										: 'Download songs to see this.'}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Public playlists -->
		<section>
			<h2 class="text-xl font-bold tracking-tight mb-4">Public playlists</h2>
			{#if publicPlaylists === null}
				<span class="size-6 icon-[svg-spinners--ring-resize] text-primary-400"></span>
			{:else if !publicPlaylists.length}
				<p class="text-sm text-secondary-600">
					{mine
						? 'None yet. Make a playlist public in its details to share it.'
						: 'No public playlists yet.'}
				</p>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
					{#each publicPlaylists as playlist (playlist.id)}
						<button
							class="p-3 rounded-lg hover:bg-white/[0.06] text-start cursor-pointer transition"
							onclick={() => goto(`/playlist/${playlist.id}`)}
						>
							<PlaylistCover
								{playlist}
								class="w-full aspect-square rounded-md shadow-lg shadow-black/40"
								iconClass="size-12"
							/>
							<h3 class="mt-3 font-semibold truncate">{playlist.title}</h3>
							<p class="text-sm text-secondary-600 truncate">
								{playlist.song_amount}
								{playlist.song_amount === 1 ? 'song' : 'songs'}{playlist.saves
									? ` · ${playlist.saves} ${playlist.saves === 1 ? 'save' : 'saves'}`
									: ''}
							</p>
						</button>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>
