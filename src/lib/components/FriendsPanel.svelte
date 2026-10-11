<script>
	import Button from './Button.svelte';
	import { userSettings } from '#lib/stores/user.ts';
	import { listen } from '#lib/stores/listen.ts';
	import {
		friendActivity,
		friendsPanelOpen,
		listenAlong,
		connectFriends,
		setSharing
	} from '#lib/stores/friends.ts';

	// Re-render the "x min ago" texts
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});

	let sharing = $derived($userSettings.settings?.shareActivity ?? true);
	let online = $derived($friendActivity.friends.filter((friend) => friend.online));
	let offline = $derived($friendActivity.friends.filter((friend) => !friend.online));
	let joining = $state(null);

	function ago(time) {
		const minutes = Math.floor((now - $friendActivity.offset - time) / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes} min`;
		if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h`;
		return `${Math.floor(minutes / (24 * 60))} d`;
	}

	async function join(friend) {
		joining = friend.osuId;
		try {
			await listenAlong(friend);
		} finally {
			joining = null;
		}
	}
</script>

{#snippet friendRow(friend)}
	{@const playback = friend.playback}
	{@const listening = friend.online && playback?.playing}
	{@const inRoom = friend.roomCode && friend.roomCode === $listen.code}
	<li>
		<button
			class="group w-full flex items-start gap-3 p-2 rounded-md text-start transition {playback &&
			!inRoom
				? 'hover:bg-secondary-200 cursor-pointer'
				: 'cursor-default'}"
			title={!playback || inRoom
				? undefined
				: friend.roomCode
					? 'Join their listening session'
					: friend.online
						? 'Listen along'
						: 'Play this song'}
			disabled={!playback || inRoom || joining !== null}
			onclick={() => join(friend)}
		>
			<span class="relative shrink-0 {friend.online ? '' : 'opacity-60'}">
				{#if friend.avatarUrl}
					<img src={friend.avatarUrl} alt="" class="size-10 rounded-full object-cover" />
				{:else}
					<span class="size-10 rounded-full grid place-items-center bg-secondary-300 font-bold">
						{friend.username[0]}
					</span>
				{/if}
				<span
					class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-secondary-100 {friend.online
						? 'bg-green-500'
						: 'bg-secondary-500'}"
					title={friend.online ? 'Online' : 'Offline'}
				></span>
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex items-center justify-between gap-2">
					<span class="font-semibold truncate {friend.online ? '' : 'text-white/70'}">
						{friend.username}
					</span>
					<span class="text-xs text-secondary-600 shrink-0">
						{#if listening}
							<span class="icon-[mingcute--volume-line] size-3.5 text-green-500 align-[-2px]"
							></span>
						{:else if !friend.online}
							{ago(friend.lastSeen)}
						{/if}
					</span>
				</span>
				<span
					class="block text-sm truncate {friend.online ? 'text-white/80' : 'text-secondary-600'}"
				>
					{#if playback}
						{playback.title} · {playback.artist}
					{:else}
						{friend.online ? 'Online' : 'Offline'}
					{/if}
				</span>
				{#if playback}
					<span class="mt-0.5 flex items-center gap-1 text-xs text-secondary-600">
						{#if inRoom}
							<span class="icon-[mingcute--headphone-line] size-3.5"></span>
							Listening together
						{:else if joining === friend.osuId}
							<span class="icon-[mingcute--loading-line] size-3.5 animate-spin"></span>
							Joining…
						{:else if friend.roomCode}
							<span class="icon-[mingcute--group-line] size-3.5"></span>
							In a listening session
						{:else if listening}
							<span class="icon-[mingcute--music-2-line] size-3.5"></span>
							Listening now
						{:else if friend.online}
							<span class="icon-[mingcute--pause-line] size-3.5"></span>
							Paused
						{:else}
							<span class="icon-[mingcute--time-line] size-3.5"></span>
							Last played
						{/if}
						<span
							class="ml-auto font-semibold text-primary-500 opacity-0 group-hover:opacity-100 transition {inRoom
								? 'hidden'
								: ''}"
						>
							{friend.roomCode ? 'Join' : friend.online ? 'Listen along' : 'Play'}
						</span>
					</span>
				{/if}
			</span>
		</button>
	</li>
{/snippet}

<aside class="h-full w-80 flex flex-col" aria-label="Friend activity">
	<div class="flex items-center justify-between pl-5 pr-3 h-14 shrink-0">
		<h2 class="font-bold">Friend activity</h2>
		<button
			aria-label="Close friend activity"
			class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
			onclick={() => friendsPanelOpen.set(false)}
		>
			<span class="icon-[mingcute--close-line] size-5"></span>
		</button>
	</div>

	<div class="flex-1 overflow-y-auto px-2 pb-4">
		{#if $friendActivity.status === 'needs-login'}
			<div class="px-3 py-6 text-center flex flex-col items-center gap-3">
				<span class="icon-[mingcute--user-heart-line] size-10 text-secondary-600"></span>
				<p class="text-sm text-secondary-600">
					Allow Stosufy to see your osu! friends to find out who's online and what they listen to.
				</p>
				<Button type="primary" on:click={connectFriends}>Connect friends</Button>
			</div>
		{:else if $friendActivity.status === 'error'}
			<p class="px-3 py-6 text-sm text-center text-red-400">{$friendActivity.message}</p>
		{:else if $friendActivity.status !== 'ok'}
			<div class="grid place-items-center py-10">
				<span class="icon-[mingcute--loading-line] size-6 animate-spin text-primary-500"></span>
			</div>
		{:else if !$friendActivity.friends.length}
			<div class="px-3 py-6 text-center flex flex-col items-center gap-3">
				<span class="icon-[mingcute--headphone-line] size-10 text-secondary-600"></span>
				<p class="text-sm text-secondary-600">
					None of your osu! friends uses Stosufy yet. When they do, you'll see here when they're
					online and can listen along.
				</p>
			</div>
		{:else}
			{#if online.length}
				<h3 class="px-2 pt-1 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
					Online · {online.length}
				</h3>
				<ul class="flex flex-col mb-3">
					{#each online as friend (friend.osuId)}
						{@render friendRow(friend)}
					{/each}
				</ul>
			{/if}
			{#if offline.length}
				<h3 class="px-2 pt-1 pb-1 text-xs font-bold uppercase tracking-wide text-secondary-600">
					Offline · {offline.length}
				</h3>
				<ul class="flex flex-col">
					{#each offline as friend (friend.osuId)}
						{@render friendRow(friend)}
					{/each}
				</ul>
			{/if}
		{/if}
	</div>

	<label
		class="m-2 p-3 flex items-center gap-3 rounded-lg bg-white/[0.04] text-sm cursor-pointer select-none"
	>
		<input
			type="checkbox"
			class="size-4 accent-primary-500 cursor-pointer"
			checked={sharing}
			onchange={(e) => setSharing(e.currentTarget.checked)}
		/>
		<span>
			<span class="text-white">Show me to my friends</span>
			<span class="block text-xs text-secondary-600">
				Whether you're online and what you listen to.
			</span>
		</span>
	</label>
</aside>
