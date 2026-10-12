<script>
	// Friends online and what they listen to; a click listens along
	import { onMount } from 'svelte';
	import Widget from './MacWidget.svelte';
	import {
		friendActivity,
		loadFriendActivity,
		listenAlong,
		connectFriends
	} from '#lib/stores/friends.ts';

	onMount(() => {
		loadFriendActivity();
		const timer = setInterval(loadFriendActivity, 30_000);
		return () => clearInterval(timer);
	});

	let online = $derived($friendActivity.friends.filter((friend) => friend.online));
</script>

<Widget size="medium" label="Friends" icon="icon-[mingcute--user-heart-fill]">
	{#if $friendActivity.status === 'needs-login'}
		<button
			class="mt-auto self-start h-8 px-3 rounded-full bg-white/15 text-sm font-semibold cursor-pointer hover:bg-white/25"
			onclick={() => connectFriends()}
		>
			Connect your osu! friends
		</button>
	{:else if !online.length}
		<p class="mt-auto text-sm text-white/60">
			{$friendActivity.status === 'ok' ? 'No friends online right now.' : 'Loading…'}
		</p>
	{:else}
		<div class="flex flex-col gap-1.5 min-h-0 overflow-hidden">
			{#each online.slice(0, 2) as friend (friend.osuId)}
				<button
					class="flex items-center gap-2.5 text-start rounded-lg -mx-1 px-1 py-0.5 hover:bg-white/10 cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
					disabled={!friend.playback}
					title={friend.playback ? 'Listen along' : undefined}
					onclick={() => listenAlong(friend)}
				>
					{#if friend.avatarUrl}
						<img src={friend.avatarUrl} alt="" class="size-7 rounded-full object-cover" />
					{:else}
						<span class="size-7 rounded-full grid place-items-center bg-white/15 text-xs font-bold"
							>{friend.username[0]}</span
						>
					{/if}
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-semibold">{friend.username}</span>
						<span class="block truncate text-xs text-white/60">
							{friend.playback
								? `${friend.playback.playing ? '♪ ' : '❚❚ '}${friend.playback.title}`
								: 'Online'}
						</span>
					</span>
				</button>
			{/each}
			{#if online.length > 2}
				<p class="text-xs text-white/50">and {online.length - 2} more online</p>
			{/if}
		</div>
	{/if}
</Widget>
