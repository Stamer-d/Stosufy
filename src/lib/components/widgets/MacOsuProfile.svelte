<script>
	// Your osu! profile: rank, pp and accuracy, and how the rank moved since yesterday
	import { goto } from '$app/navigation';
	import Widget from './MacWidget.svelte';
	import { user } from '#lib/stores/user.ts';
	import { osuProfile } from '#lib/stores/profile.ts';

	let profile = $state(null);
	$effect(() => {
		const id = Number($user?.id);
		if (!(id > 0)) return;
		osuProfile(id)
			.then((result) => (profile = result))
			.catch(() => {});
	});

	let change = $derived.by(() => {
		const history = profile?.rankHistory ?? [];
		if (history.length < 2) return 0;
		// A smaller rank is better: positive means it went up
		return history[history.length - 2] - history[history.length - 1];
	});
	const number = (value) => (value == null ? '–' : Math.round(value).toLocaleString('en-US'));
</script>

<Widget size="medium" label="osu! profile" icon="icon-[mingcute--user-3-fill]">
	<button
		class="flex-1 flex items-center gap-4 text-start cursor-pointer"
		onclick={() => goto('/profile/me')}
	>
		<img
			src={profile?.avatarUrl ?? $user?.avatar_url ?? '/logo.png'}
			alt=""
			class="size-20 rounded-2xl object-cover shadow-lg shadow-black/30"
		/>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-lg font-extrabold"
				>{profile?.username ?? $user?.username}</span
			>
			<span class="flex items-baseline gap-2">
				<span class="text-2xl font-extrabold tabular-nums">#{number(profile?.globalRank)}</span>
				{#if change}
					<span
						class="flex items-center text-xs font-bold {change > 0
							? 'text-green-400'
							: 'text-red-400'}"
					>
						<span
							class="{change > 0
								? 'icon-[mingcute--arrow-up-fill]'
								: 'icon-[mingcute--arrow-down-fill]'} size-3.5"
						></span>
						{number(Math.abs(change))}
					</span>
				{/if}
			</span>
			<span class="block text-sm text-white/65 tabular-nums">
				{number(profile?.pp)}pp · {profile?.accuracy != null ? profile.accuracy.toFixed(2) : '–'}%
			</span>
		</span>
	</button>
</Widget>
