<script>
	// osu! players whose name matches the search, each opening their profile
	import { goto } from '$app/navigation';
	import { offline } from '#lib/stores/network.ts';
	import { searchPlayers, flag } from '#lib/stores/profile.ts';

	/** @type {{ query: string }} */
	let { query } = $props();

	const SHOWN = 6;
	let players = $state([]);
	let total = $state(0);
	let all = $state(false);
	let request = 0;

	// A moment after the last key, like the beatmap search
	$effect(() => {
		const text = query.trim();
		const id = ++request;
		all = false;
		if (!text || $offline) {
			players = [];
			total = 0;
			return;
		}
		const timer = setTimeout(async () => {
			try {
				const result = await searchPlayers(text);
				if (id !== request) return;
				players = result.players;
				total = result.total;
			} catch (error) {
				console.error('Could not search osu! players:', error);
				if (id === request) players = [];
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	let shown = $derived(all ? players : players.slice(0, SHOWN));
</script>

{#if players.length}
	<section>
		<div class="flex items-center gap-2 mb-3">
			<h2 class="flex-1 text-xl font-bold tracking-tight">osu! players</h2>
			{#if players.length > SHOWN}
				<button
					class="text-sm font-semibold text-secondary-600 hover:text-white cursor-pointer transition"
					onclick={() => (all = !all)}
				>
					{all ? 'Show less' : `Show all ${players.length}`}
				</button>
			{/if}
		</div>
		<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
			{#each shown as player (player.id)}
				<button
					class="group flex items-center gap-3 p-2 rounded-lg text-start bg-white/[0.03] hover:bg-white/[0.08] cursor-pointer transition-colors min-w-0"
					title="Profile of {player.username}"
					onclick={() => goto(`/profile/${player.id}`)}
				>
					<span class="relative shrink-0">
						{#if player.avatarUrl}
							<img src={player.avatarUrl} alt="" class="size-11 rounded-full object-cover" />
						{:else}
							<span class="size-11 rounded-full grid place-items-center bg-secondary-300 font-bold">
								{player.username[0]}
							</span>
						{/if}
						{#if player.online}
							<span
								class="absolute bottom-0 right-0 size-3 rounded-full bg-green-500 ring-2 ring-secondary-100"
								title="Online"
							></span>
						{/if}
					</span>
					<span class="min-w-0">
						<span class="block font-semibold truncate group-hover:underline">{player.username}</span
						>
						<span class="block text-sm text-secondary-600 truncate">
							{flag(player.countryCode)}
							{player.globalRank ? `#${player.globalRank.toLocaleString()}` : 'osu! player'}
						</span>
					</span>
				</button>
			{/each}
		</div>
		{#if all && total > players.length}
			<p class="mt-2 text-sm text-secondary-600">
				{total.toLocaleString()} players found, the best {players.length} are shown.
			</p>
		{/if}
	</section>
{/if}
