<script module>
	/** What was chosen last (the page is opened again where it was left) */
	let last = { mode: 'osu', board: 'performance', scope: 'global', country: null };
	/** The first page of each ranking as last shown (right away when opened again) */
	const kept = new Map();
</script>

<script>
	const base = __WEB_BASE__;
	// osu!'s rankings: the players by performance (pp) or ranked score, worldwide, in a country
	// or among your friends, and the countries. Tap a player for their profile, a country for
	// its players.
	import { page } from '$app/state';
	import { goBack } from '../../navigation';
	import { offline } from '../../../lib/stores/network';
	import { user } from '../../shims/user';
	import {
		playerRanking,
		countryRanking,
		osuProfile,
		flag,
		shortNumber,
		RANKING_MODES,
		RANKING_PAGE
	} from '../../../lib/stores/profile';
	import { nearView } from '../../visible';
	import { haptic } from '../../haptics';
	import Skeleton from '../../Skeleton.svelte';
	import PlayerRow from '../../PlayerRow.svelte';
	import { handleImageError } from '../../shims/data';

	const BOARDS = [
		['performance', 'Performance'],
		['score', 'Score'],
		['country', 'Countries']
	];

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

	let mode = $state(/** @type {import('../../../lib/stores/profile').RankingMode} */ (last.mode));
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
		const id = $user?.id;
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
		const wanted = asking;
		const before = from === 1 ? kept.get(wanted) : null;
		rows = before?.rows ?? [];
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
			if (from === 1) kept.set(wanted, result);
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
		if ($offline) return;
		load(1);
	});

	function choose(change) {
		haptic();
		change();
	}
	function openCountry(entry) {
		choose(() => {
			country = { code: entry.code, name: entry.name };
			scope = 'country';
			board = 'performance';
		});
		window.scrollTo({ top: 0 });
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
		haptic();
		await load(Math.ceil(myPlace / RANKING_PAGE));
		requestAnimationFrame(() =>
			document.querySelector('[data-me]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		);
	}

	const detailOf = (player) =>
		[
			player.accuracy != null ? `${player.accuracy.toFixed(2)}%` : '',
			player.playCount ? `${shortNumber(player.playCount)} plays` : '',
			scope !== 'global' || board === 'score'
				? player.globalRank
					? `#${player.globalRank.toLocaleString()} worldwide`
					: ''
				: ''
		]
			.filter(Boolean)
			.join(' · ');
	const valueOf = (player) =>
		board === 'score'
			? shortNumber(player.rankedScore)
			: `${Math.round(player.pp ?? 0).toLocaleString()}pp`;
</script>

<header class="px-4 pt-5 pb-3">
	<div class="flex items-center gap-1">
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
		<h1 class="text-2xl font-bold tracking-tight">Rankings</h1>
	</div>

	<div class="mt-3 flex gap-1 p-1 rounded-full bg-white/[0.06]" role="tablist" aria-label="Ranking">
		{#each BOARDS as [value, label] (value)}
			<button
				role="tab"
				aria-selected={board === value}
				class="flex-1 h-10 rounded-full text-sm font-semibold transition {board === value
					? 'bg-white text-black'
					: 'text-white/80'}"
				onclick={() => choose(() => (board = value))}
			>
				{label}
			</button>
		{/each}
	</div>

	<div
		class="-mx-4 mt-3 px-4 flex gap-2 overflow-x-auto [scrollbar-width:none]"
		data-no-swipe
		role="group"
		aria-label="Game mode and players"
	>
		{#each RANKING_MODES as option (option.id)}
			<button
				aria-pressed={mode === option.id}
				class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold transition {mode === option.id
					? 'bg-primary-300 text-white'
					: 'bg-white/[0.08] text-white/80'}"
				onclick={() => choose(() => (mode = option.id))}
			>
				{option.label}
			</button>
		{/each}
		{#if board !== 'country'}
			<span class="shrink-0 w-px my-2 bg-white/15"></span>
			<button
				aria-pressed={scope === 'global'}
				class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold transition {scope === 'global'
					? 'bg-white text-black'
					: 'bg-white/[0.08] text-white/80'}"
				onclick={() => choose(() => (scope = 'global'))}
			>
				Worldwide
			</button>
			{#if board === 'performance'}
				{#if me?.country && me.country.code !== country?.code}
					<button
						class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold bg-white/[0.08] text-white/80"
						onclick={() =>
							choose(() => {
								country = me.country;
								scope = 'country';
							})}
					>
						{flag(me.country.code)}
						{me.country.name}
					</button>
				{/if}
				{#if country}
					<button
						aria-pressed={scope === 'country'}
						class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold transition {scope ===
						'country'
							? 'bg-white text-black'
							: 'bg-white/[0.08] text-white/80'}"
						onclick={() => choose(() => (scope = 'country'))}
					>
						{flag(country.code)}
						{country.name || country.code}
					</button>
				{/if}
			{/if}
			<button
				aria-pressed={scope === 'friends'}
				class="shrink-0 h-10 px-4 rounded-full text-sm font-semibold transition {scope === 'friends'
					? 'bg-white text-black'
					: 'bg-white/[0.08] text-white/80'}"
				onclick={() => choose(() => (scope = 'friends'))}
			>
				Friends
			</button>
		{/if}
	</div>
</header>

{#if me && board !== 'country'}
	<div
		class="mx-3 mb-2 flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-primary-300/40 to-white/[0.04]"
	>
		<a href="{base}/profile/{me.id}" class="min-w-0 flex-1 flex items-center gap-3">
			<img
				src={me.avatarUrl ?? `https://a.ppy.sh/${me.id}`}
				alt=""
				class="size-11 shrink-0 rounded-full object-cover bg-secondary-300"
				onerror={handleImageError}
			/>
			<span class="min-w-0">
				<span class="block font-semibold truncate">You · {me.username}</span>
				<span class="block text-sm text-white/70 truncate">
					{#if me.globalRank}
						#{me.globalRank.toLocaleString()}{me.countryRank
							? ` · ${flag(me.country?.code)} #${me.countryRank.toLocaleString()}`
							: ''} · {Math.round(me.pp ?? 0).toLocaleString()}pp
					{:else}
						Not ranked in this mode yet
					{/if}
				</span>
			</span>
		</a>
		{#if canShowMe && !showsMe}
			<button
				class="shrink-0 h-10 px-4 rounded-full bg-white/15 text-sm font-semibold active:bg-white/25"
				onclick={showMe}
			>
				Show me
			</button>
		{/if}
	</div>
{/if}

{#if $offline}
	<p class="px-4 py-10 text-center text-secondary-600">
		The rankings show up once you're connected.
	</p>
{:else if error && !rows.length}
	<div class="px-8 py-12 flex flex-col items-center gap-3 text-center">
		<p class="text-red-400">Couldn't load the ranking: {error}</p>
		<button class="h-10 px-5 rounded-full bg-white/10 font-semibold" onclick={() => load(1)}>
			Try again
		</button>
	</div>
{:else if loading && !rows.length}
	<Skeleton rows={10} avatars />
{:else if !rows.length}
	<div class="px-8 py-12 flex flex-col items-center gap-2 text-center">
		<span class="icon-[mingcute--trophy-line] size-10 text-secondary-600"></span>
		<p class="font-semibold">
			{scope === 'friends' ? 'None of your friends are ranked in this mode' : 'Nobody here yet'}
		</p>
	</div>
{/if}

{#if firstPage > 1 && rows.length}
	<div class="px-4 pb-2">
		<button
			class="h-10 px-4 rounded-full bg-white/[0.08] text-sm font-semibold"
			onclick={() => load(1)}
		>
			<span class="icon-[mingcute--up-line] size-4 align-[-0.15em]"></span> From the top
		</button>
	</div>
{/if}

<ol class="px-2 pb-4" aria-label="Ranking">
	{#if rowsOf === 'country'}
		{#each rows as entry (entry.code)}
			<li>
				<button
					class="w-full flex items-center gap-2.5 p-2 rounded-lg text-start active:bg-white/[0.06]"
					onclick={() => openCountry(entry)}
				>
					<span class="min-w-9 shrink-0 text-end text-xs font-bold tabular-nums text-secondary-600">
						#{entry.place}
					</span>
					<span class="size-11 shrink-0 grid place-items-center text-3xl">{flag(entry.code)}</span>
					<span class="min-w-0 flex-1">
						<span class="block font-semibold truncate">{entry.name}</span>
						<span class="block text-sm text-secondary-600 truncate">
							{entry.players.toLocaleString()} players · {shortNumber(entry.playCount)} plays
						</span>
					</span>
					<span class="shrink-0 text-sm font-semibold tabular-nums">{shortNumber(entry.pp)}pp</span>
				</button>
			</li>
		{/each}
	{:else}
		{#each rows as player (player.id)}
			<PlayerRow
				{player}
				place={player.place}
				detail={detailOf(player)}
				value={valueOf(player)}
				mine={player.id === me?.id}
			/>
		{/each}
	{/if}
</ol>
{#if more && !loading}
	{#key rows.length}
		<div use:nearView={loadMore} class="h-20"></div>
	{/key}
{:else if loading && rows.length}
	<div class="py-6 grid place-items-center">
		<span class="icon-[svg-spinners--ring-resize] size-6 text-secondary-600"></span>
	</div>
{/if}
