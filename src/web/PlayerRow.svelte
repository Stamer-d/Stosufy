<script>
	const base = __WEB_BASE__;
	// An osu! player in a list (the search, the friends, a ranking): their picture, name and
	// country, their rank and pp. Tap it for their profile.
	import { flag } from '../lib/stores/profile';
	import { handleImageError } from './shims/data';

	/** @type {{ player: import('../lib/stores/profile').OsuPlayer, place?: number | null, detail?: string, value?: string, mine?: boolean }} */
	let { player, place = null, detail = '', value = '', mine = false } = $props();

	const MEDALS = { 1: 'text-amber-300', 2: 'text-slate-300', 3: 'text-orange-400' };
</script>

<li data-me={mine ? '' : undefined}>
	<a
		href="{base}/profile/{player.id}"
		class="flex items-center gap-2.5 p-2 rounded-lg active:bg-white/[0.06] {mine
			? 'bg-primary-300/20 ring-1 ring-primary-400/40'
			: ''}"
	>
		{#if place != null}
			<span
				class="min-w-9 shrink-0 text-end text-xs font-bold tabular-nums {MEDALS[place] ??
					'text-secondary-600'}"
			>
				#{place.toLocaleString()}
			</span>
		{/if}
		<span class="relative shrink-0">
			<img
				src={player.avatarUrl ?? `https://a.ppy.sh/${player.id}`}
				alt=""
				loading="lazy"
				class="size-11 rounded-full object-cover bg-secondary-300"
				onerror={handleImageError}
			/>
			{#if player.online}
				<span class="absolute bottom-0 right-0 size-3 rounded-full bg-green-400 ring-2 ring-panel"
				></span>
			{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-1.5">
				<span class="font-semibold truncate">{player.username}</span>
				<span class="shrink-0">{flag(player.countryCode)}</span>
			</span>
			<span class="block text-sm text-secondary-600 truncate">
				{detail ||
					(player.globalRank ? `#${player.globalRank.toLocaleString()} worldwide` : 'osu! player')}
			</span>
		</span>
		{#if value}
			<span class="shrink-0 text-sm font-semibold tabular-nums">{value}</span>
		{/if}
	</a>
</li>
