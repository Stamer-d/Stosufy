<script>
	import Button from './Button.svelte';
	import { userSettings } from '#lib/stores/user.ts';
	import { listen } from '#lib/stores/listen.ts';
	import {
		friendActivity,
		friendsPanelOpen,
		listenAlong,
		connectFriends,
		setSharing,
		LIVE_FOR
	} from '#lib/stores/friends.ts';

	// Re-render the "x min ago" texts
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 15_000);
		return () => clearInterval(timer);
	});

	let sharing = $derived($userSettings.settings?.shareActivity ?? true);
	let joining = $state(null);

	function ago(friend) {
		const minutes = Math.floor((now - $friendActivity.offset - friend.updatedAt) / 60_000);
		if (minutes < 1) return 'now';
		if (minutes < 60) return `${minutes} min`;
		return `${Math.floor(minutes / 60)} h`;
	}

	function isLive(friend) {
		return friend.playback.playing && now - $friendActivity.offset - friend.updatedAt < LIVE_FOR;
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
					Allow Stosufy to see your osu! friends to find out what they listen to.
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
					None of your osu! friends is listening in Stosufy right now. When they do, you'll see it
					here and can listen along.
				</p>
			</div>
		{:else}
			<ul class="flex flex-col">
				{#each $friendActivity.friends as friend (friend.osuId)}
					{@const live = isLive(friend)}
					{@const inRoom = friend.roomCode && friend.roomCode === $listen.code}
					<li>
						<button
							class="group w-full flex items-start gap-3 p-2 rounded-md text-start hover:bg-secondary-200 cursor-pointer transition disabled:cursor-default"
							title={friend.roomCode ? 'Join their listening session' : 'Listen along'}
							disabled={inRoom || joining !== null}
							onclick={() => join(friend)}
						>
							<span class="relative shrink-0">
								{#if friend.avatarUrl}
									<img src={friend.avatarUrl} alt="" class="size-10 rounded-full object-cover" />
								{:else}
									<span
										class="size-10 rounded-full grid place-items-center bg-secondary-300 font-bold"
									>
										{friend.username[0]}
									</span>
								{/if}
								{#if live}
									<span
										class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-green-500 ring-2 ring-secondary-100"
										title="Listening now"
									></span>
								{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class="flex items-center justify-between gap-2">
									<span class="font-semibold truncate">{friend.username}</span>
									<span class="text-xs text-secondary-600 shrink-0">
										{#if live}
											<span
												class="icon-[mingcute--volume-line] size-3.5 text-green-500 align-[-2px]"
											></span>
										{:else}
											{ago(friend)}
										{/if}
									</span>
								</span>
								<span class="block text-sm text-white/80 truncate">
									{friend.playback.title} · {friend.playback.artist}
								</span>
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
									{:else}
										<span
											class="{friend.playback.playing
												? 'icon-[mingcute--music-2-line]'
												: 'icon-[mingcute--pause-line]'} size-3.5"
										></span>
										{friend.playback.playing ? 'Playing' : 'Paused'}
									{/if}
									<span
										class="ml-auto font-semibold text-primary-500 opacity-0 group-hover:opacity-100 transition {inRoom
											? 'hidden'
											: ''}"
									>
										{friend.roomCode ? 'Join' : 'Listen along'}
									</span>
								</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
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
			<span class="text-white">Share what I listen to</span>
			<span class="block text-xs text-secondary-600">Your osu! friends see it here.</span>
		</span>
	</label>
</aside>
