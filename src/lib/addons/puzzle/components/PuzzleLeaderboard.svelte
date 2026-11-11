<script>
	import { goto } from '$app/navigation';

	/**
	 * @typedef {{ rank: number, osuId: number, username: string | null, avatarUrl: string | null, value: string, detail?: string, mods?: string[] }} LeaderboardPlace
	 */

	/**
	 * A leaderboard: places with the player, what they're ranked by (`value`, e.g. a time) and a
	 * line under it (`detail`); the user's own place stays below if it isn't among them.
	 * `board` is null while it loads.
	 * @type {{ board: { entries: LeaderboardPlace[], mine: LeaderboardPlace | null, players: number } | null, error?: string | null, empty?: string }}
	 */
	let { board, error = null, empty = 'No one yet. Be the first!' } = $props();

	let mineShown = $derived(
		!!board?.mine && board.entries.some((entry) => entry.osuId === board.mine?.osuId)
	);
	const medal = (rank) =>
		rank === 1
			? 'text-amber-300'
			: rank === 2
				? 'text-slate-200'
				: rank === 3
					? 'text-orange-400'
					: 'text-secondary-600';
</script>

{#snippet row(place, own)}
	<li>
		<button
			class="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-left cursor-pointer transition {own
				? 'bg-primary-300/20 ring-1 ring-primary-400/60'
				: 'hover:bg-white/5'}"
			title="Profile of {place.username ?? 'this player'}"
			onclick={() => goto(`/profile/${place.osuId}`)}
		>
			<span class="w-8 shrink-0 text-right font-extrabold tabular-nums {medal(place.rank)}"
				>#{place.rank}</span
			>
			{#if place.avatarUrl}
				<img src={place.avatarUrl} alt="" class="size-8 rounded-full object-cover shrink-0" />
			{:else}
				<span
					class="size-8 shrink-0 rounded-full grid place-items-center bg-secondary-300 text-sm font-bold"
					>{(place.username ?? '?')[0]}</span
				>
			{/if}
			<span class="min-w-0 flex-1">
				<span class="block font-semibold truncate">{place.username ?? `osu! ${place.osuId}`}</span>
				{#if place.detail}
					<span class="block text-xs text-secondary-600 truncate">{place.detail}</span>
				{/if}
			</span>
			{#each place.mods ?? [] as mod (mod)}
				<span class="px-1.5 rounded bg-white/90 text-black text-[11px] font-extrabold">{mod}</span>
			{/each}
			<span class="shrink-0 font-bold tabular-nums">{place.value}</span>
		</button>
	</li>
{/snippet}

{#if error}
	<p class="px-3 py-6 text-center text-sm text-secondary-600">{error}</p>
{:else if !board}
	<div class="px-3 py-8 grid place-items-center">
		<span class="icon-[line-md--loading-loop] size-6 text-secondary-600"></span>
	</div>
{:else if !board.entries.length}
	<p class="px-3 py-6 text-center text-sm text-secondary-600">{empty}</p>
{:else}
	<ol class="flex flex-col gap-0.5">
		{#each board.entries as place (place.osuId)}
			{@render row(place, place.osuId === board.mine?.osuId)}
		{/each}
	</ol>
	{#if board.mine && !mineShown}
		<div class="my-1 border-t border-dashed border-white/10"></div>
		<ol>{@render row(board.mine, true)}</ol>
	{/if}
	<p class="mt-2 px-3 text-xs text-secondary-600">
		{board.players}
		{board.players === 1 ? 'player' : 'players'}
	</p>
{/if}
