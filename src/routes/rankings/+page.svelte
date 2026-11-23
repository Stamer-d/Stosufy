<script module>
	/** What was chosen last (the page is opened again where it was left) */
	let last = { mode: 'osu', board: 'performance', scope: 'global', country: null };
</script>

<script>
	// osu!'s rankings: the players by performance (pp) or ranked score, worldwide, in a country
	// or among the user's friends, and the countries. A player opens their profile, a country
	// its players.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { user } from '#lib/stores/user.ts';
	import { keyStore } from '#lib/stores/auth.ts';
	import { offline } from '#lib/stores/network.ts';
	import {
		playerRanking,
		countryRanking,
		osuProfile,
		flag,
		shortNumber,
		RANKING_MODES,
		RANKING_PAGE
	} from '#lib/stores/profile.ts';
	import Button from '#lib/components/Button.svelte';

	/** @type {[string, string][]} */
	const BOARDS = [
		['performance', 'Performance'],
		['score', 'Score'],
		['country', 'Countries']
	];
	const MEDALS = { 1: 'text-amber-300', 2: 'text-slate-300', 3: 'text-orange-400' };

	// (opened for a country, or for the friends: from a profile, the friends page)
	const asked = page.url.searchParams;
	if (asked.get('country'))
		last = {
			...last,
			board: 'performance',
			scope: 'country',
			country: { code: asked.get('country').toUpperCase(), name: asked.get('name') ?? '' }
		};
	else if (asked.has('friends')) last = { ...last, board: 'performance', scope: 'friends' };

	let mode = $state(/** @type {import('#lib/stores/profile.ts').RankingMode} */ (last.mode));
	let board = $state(last.board);
	/** Whose: everyone's, a country's (performance only) or the friends' */
	let scope = $state(last.scope);
	let country = $state(last.country);
	$effect(() => {
		last = { mode, board, scope, country };
	});

	/** The user on osu! in this mode: their rank, pp and country */
	let me = $state(null);
	$effect(() => {
		const id = Number($user?.id);
		const of = mode;
		me = null;
		if (!id || $offline) return;
		osuProfile(id, of)
			.then((profile) => {
				if (of === mode) me = profile;
			})
			.catch(() => {});
	});

	let rows = $state(/** @type {any[]} */ ([]));
	/** What the rows are: players or countries (the board they were asked for: a moment after
	 * another one is chosen, the rows are still the ones of before) */
	let rowsOf = $state(last.board);
	/** The page the list starts at (after "Show my place": not the first) and the next one */
	let firstPage = $state(1);
	let nextPage = $state(1);
	let more = $state(false);
	let loading = $state(false);
	let error = $state('');
	let request = 0;

	let asking = $derived(
		`${mode}|${board}|${board === 'country' ? '' : scope}|${scope === 'country' ? (country?.code ?? '') : ''}`
	);

	/** @returns {Promise<{ rows: any[], more: boolean }>} */
	async function fetchPage(number) {
		if (board === 'country') {
			const result = await countryRanking(mode, number);
			return { rows: result.countries, more: result.more };
		}
		const result = await playerRanking(mode, /** @type {any} */ (board), {
			page: number,
			country: scope === 'country' ? country?.code : '',
			friends: scope === 'friends'
		});
		return { rows: result.players, more: result.more && scope !== 'friends' };
	}

	async function load(from = 1) {
		const id = ++request;
		rows = [];
		rowsOf = board;
		more = false;
		firstPage = from;
		nextPage = from + 1;
		loading = true;
		error = '';
		try {
			const result = await fetchPage(from);
			if (id !== request) return;
			rows = result.rows;
			more = result.more;
		} catch (e) {
			if (id === request) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (id === request) loading = false;
		}
	}

	async function loadMore() {
		if (loading || !more) return;
		const id = ++request;
		loading = true;
		try {
			const result = await fetchPage(nextPage);
			if (id !== request) return;
			// (a player may move a place between two pages: each once)
			const seen = new Set(rows.map((row) => row.id ?? row.code));
			rows = [...rows, ...result.rows.filter((row) => !seen.has(row.id ?? row.code))];
			more = result.more;
			nextPage++;
		} catch (e) {
			if (id === request) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (id === request) loading = false;
		}
	}

	$effect(() => {
		void asking;
		if ($keyStore.access_token && !$offline) load(1);
	});

	function openCountry(entry) {
		country = { code: entry.code, name: entry.name };
		scope = 'country';
		board = 'performance';
	}

	/** The user's place in the ranking shown (null: not in it, or not known) */
	let myPlace = $derived(
		!me || board !== 'performance' || scope === 'friends'
			? null
			: scope === 'country'
				? me.country?.code === country?.code
					? me.countryRank
					: null
				: me.globalRank
	);
	/** (the rankings go down to place 10 000) */
	let canShowMe = $derived(!!myPlace && myPlace <= 10000);
	let showsMe = $derived(rows.some((row) => row.id === me?.id));
	async function showMe() {
		await load(Math.ceil(myPlace / RANKING_PAGE));
		requestAnimationFrame(() =>
			document.querySelector('[data-me]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		);
	}

	/** More as the end of the list comes near */
	function nearEnd(node) {
		const observer = new IntersectionObserver(
			(entries) => entries.some((entry) => entry.isIntersecting) && loadMore(),
			{ rootMargin: '600px 0px' }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	const chip = (on) =>
		`h-8 px-3.5 rounded-full text-sm font-semibold cursor-pointer transition ${
			on ? 'bg-white text-black' : 'bg-secondary-200 text-secondary-600 hover:text-white'
		}`;
</script>

<div class="px-6 pt-6 pb-10 flex flex-col gap-5">
	<div class="flex flex-wrap items-center gap-3">
		<h1 class="flex-1 text-3xl font-extrabold tracking-tight">Rankings</h1>
		<div class="flex gap-1 p-1 rounded-full bg-secondary-200" role="tablist" aria-label="Ranking">
			{#each BOARDS as [value, label] (value)}
				<button
					role="tab"
					aria-selected={board === value}
					class="h-7 px-3 rounded-full text-sm font-semibold cursor-pointer transition {board ===
					value
						? 'bg-white text-black'
						: 'text-secondary-600 hover:text-white'}"
					onclick={() => (board = value)}
				>
					{label}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		{#each RANKING_MODES as option (option.id)}
			<button
				aria-pressed={mode === option.id}
				class="h-8 px-3.5 rounded-full text-sm font-semibold cursor-pointer transition {mode ===
				option.id
					? 'bg-primary-300 text-white'
					: 'bg-secondary-200 text-secondary-600 hover:text-white'}"
				onclick={() => (mode = option.id)}
			>
				{option.label}
			</button>
		{/each}
		{#if board !== 'country'}
			<span class="w-px h-5 mx-1 bg-white/15"></span>
			<button
				aria-pressed={scope === 'global'}
				class={chip(scope === 'global')}
				onclick={() => (scope = 'global')}
			>
				Worldwide
			</button>
			{#if board === 'performance'}
				{#if me?.country && me.country.code !== country?.code}
					<button
						class={chip(false)}
						onclick={() => {
							country = me.country;
							scope = 'country';
						}}
					>
						{flag(me.country.code)}
						{me.country.name}
					</button>
				{/if}
				{#if country}
					<button
						aria-pressed={scope === 'country'}
						class={chip(scope === 'country')}
						onclick={() => (scope = 'country')}
					>
						{flag(country.code)}
						{country.name || country.code}
					</button>
				{/if}
			{/if}
			<button
				aria-pressed={scope === 'friends'}
				class={chip(scope === 'friends')}
				onclick={() => (scope = 'friends')}
			>
				Friends
			</button>
		{/if}
		{#if me && board !== 'country'}
			<span class="flex-1"></span>
			<button
				class="flex items-center gap-2 h-9 pl-1 pr-3 rounded-full bg-white/[0.05] hover:bg-white/[0.1] cursor-pointer transition text-sm"
				title="Your profile"
				onclick={() => goto('/profile/me')}
			>
				{#if me.avatarUrl}
					<img src={me.avatarUrl} alt="" class="size-7 rounded-full object-cover" />
				{/if}
				<span class="font-semibold">You</span>
				<span class="text-secondary-600 tabular-nums">
					{me.globalRank ? `#${me.globalRank.toLocaleString()}` : 'unranked'}
					{#if me.countryRank}· {flag(me.country?.code)} #{me.countryRank.toLocaleString()}{/if}
				</span>
			</button>
			{#if canShowMe && !showsMe}
				<Button type="normal" size="sm" onclick={showMe}>Show my place</Button>
			{/if}
		{/if}
	</div>

	{#if $offline && !rows.length}
		<div class="flex flex-col items-center gap-2 mt-16 text-secondary-600">
			<span class="icon-[mingcute--wifi-off-line] size-10 text-amber-300"></span>
			<p class="text-xl">You're offline</p>
			<p class="text-sm">The rankings show up again once you're connected.</p>
		</div>
	{:else if error && !rows.length}
		<div class="flex flex-col items-center gap-3 mt-16 text-secondary-600">
			<span class="icon-[fa6-solid--triangle-exclamation] size-10 text-red-400"></span>
			<p class="text-xl">Couldn't load the ranking</p>
			<p class="text-sm">{error}</p>
			<Button type="primary" onclick={() => load(1)}>Try again</Button>
		</div>
	{:else if loading && !rows.length}
		<div class="grid place-items-center py-16">
			<span class="icon-[svg-spinners--ring-resize] size-10 text-primary-300"></span>
		</div>
	{:else if !rows.length}
		<div class="flex flex-col items-center gap-2 mt-16 text-center text-secondary-600">
			<span class="icon-[mingcute--trophy-line] size-10"></span>
			<p class="text-xl">
				{scope === 'friends' ? 'None of your friends are ranked in this mode' : 'Nobody here yet'}
			</p>
		</div>
	{:else}
		{#if firstPage > 1}
			<div>
				<Button type="normal" size="sm" icon="icon-[mingcute--up-line]" onclick={() => load(1)}>
					From the top
				</Button>
			</div>
		{/if}
		<div class="rounded-2xl bg-white/[0.03] ring-1 ring-white/5 overflow-hidden">
			<div
				class="grid {board === 'country'
					? 'grid-cols-[4rem_1fr_8rem_8rem_8rem]'
					: 'grid-cols-[4rem_1fr_7rem_8rem_8rem]'} gap-3 px-4 py-2 text-xs font-bold uppercase tracking-wide text-secondary-600"
			>
				<span class="text-end">#</span>
				<span>{board === 'country' ? 'Country' : 'Player'}</span>
				<span class="text-end">{board === 'country' ? 'Players' : 'Accuracy'}</span>
				<span class="text-end">Play count</span>
				<span class="text-end">{board === 'score' ? 'Ranked score' : 'Performance'}</span>
			</div>
			{#if rowsOf === 'country'}
				{#each rows as entry (entry.code)}
					<button
						class="w-full grid grid-cols-[4rem_1fr_8rem_8rem_8rem] gap-3 items-center px-4 py-2 text-start hover:bg-white/[0.06] cursor-pointer transition-colors border-t border-white/5"
						title="The players of {entry.name}"
						onclick={() => openCountry(entry)}
					>
						<span class="text-end font-bold tabular-nums text-secondary-600">#{entry.place}</span>
						<span class="flex items-center gap-3 min-w-0">
							<span class="text-2xl">{flag(entry.code)}</span>
							<span class="font-semibold truncate">{entry.name}</span>
						</span>
						<span class="text-end tabular-nums text-secondary-600">
							{entry.players.toLocaleString()}
						</span>
						<span class="text-end tabular-nums text-secondary-600">
							{shortNumber(entry.playCount)}
						</span>
						<span class="text-end font-semibold tabular-nums">{shortNumber(entry.pp)}pp</span>
					</button>
				{/each}
			{:else}
				{#each rows as player (player.id)}
					{@const mine = player.id === me?.id}
					<button
						data-me={mine ? '' : undefined}
						class="group w-full grid grid-cols-[4rem_1fr_7rem_8rem_8rem] gap-3 items-center px-4 py-2 text-start hover:bg-white/[0.06] cursor-pointer transition-colors border-t border-white/5 {mine
							? 'bg-primary-300/20'
							: ''}"
						title="Profile of {player.username}"
						onclick={() => goto(`/profile/${player.id}`)}
					>
						<span
							class="text-end font-bold tabular-nums {MEDALS[player.place] ?? 'text-secondary-600'}"
						>
							#{player.place.toLocaleString()}
						</span>
						<span class="flex items-center gap-3 min-w-0">
							<span class="relative shrink-0">
								{#if player.avatarUrl}
									<img
										src={player.avatarUrl}
										alt=""
										loading="lazy"
										class="size-9 rounded-full object-cover"
									/>
								{:else}
									<span
										class="size-9 rounded-full grid place-items-center bg-secondary-300 font-bold"
									>
										{player.username[0]}
									</span>
								{/if}
								{#if player.online}
									<span
										class="absolute bottom-0 right-0 size-2.5 rounded-full bg-green-500 ring-2 ring-secondary-100"
										title="Online"
									></span>
								{/if}
							</span>
							<span title={player.countryName ?? ''}>{flag(player.countryCode)}</span>
							<span class="font-semibold truncate group-hover:underline">{player.username}</span>
							{#if (scope !== 'global' || board === 'score') && player.globalRank}
								<span class="text-xs text-secondary-600 tabular-nums">
									#{player.globalRank.toLocaleString()}
								</span>
							{/if}
						</span>
						<span class="text-end tabular-nums text-secondary-600">
							{player.accuracy != null ? `${player.accuracy.toFixed(2)}%` : '–'}
						</span>
						<span class="text-end tabular-nums text-secondary-600">
							{player.playCount != null ? player.playCount.toLocaleString() : '–'}
						</span>
						<span class="text-end font-semibold tabular-nums">
							{board === 'score'
								? shortNumber(player.rankedScore)
								: `${Math.round(player.pp ?? 0).toLocaleString()}pp`}
						</span>
					</button>
				{/each}
			{/if}
		</div>
		{#if more && !loading}
			{#key rows.length}
				<div use:nearEnd class="h-10"></div>
			{/key}
		{:else if loading}
			<div class="grid place-items-center py-6">
				<span class="icon-[svg-spinners--ring-resize] size-7 text-primary-300"></span>
			</div>
		{/if}
	{/if}
</div>
