<script>
	// The user's friends on osu!: all of them, not only those who use Stosufy (those are in the
	// friend activity), online first, each opening their profile
	import { goto } from '$app/navigation';
	import { keyStore } from '#lib/stores/auth.ts';
	import { offline } from '#lib/stores/network.ts';
	import { friendActivity, connectFriends } from '#lib/stores/friends.ts';
	import { osuFriends, flag } from '#lib/stores/profile.ts';
	import Button from '#lib/components/Button.svelte';

	/** @type {[string, string][]} */
	const SORTS = [
		['rank', 'Rank'],
		['name', 'Name']
	];

	let friends = $state(null);
	let error = $state('');
	let needsLogin = $state(false);
	let filter = $state('');
	let sort = $state('rank');
	let request = 0;

	async function load() {
		const id = ++request;
		error = '';
		needsLogin = false;
		try {
			const result = await osuFriends();
			if (id === request) friends = result;
		} catch (e) {
			if (id !== request) return;
			const message = e instanceof Error ? e.message : String(e);
			// Logins from before the friend list was asked for can't see it
			if (/HTTP 40[13]/.test(message)) needsLogin = true;
			else error = message;
		}
	}

	// Again after logging in with access to the friend list
	$effect(() => {
		if ($keyStore.access_token && !$offline) load();
	});

	let stosufy = $derived(new Set($friendActivity.friends.map((friend) => friend.osuId)));

	let shown = $derived.by(() => {
		const text = filter.trim().toLowerCase();
		const list = (friends ?? []).filter(
			(friend) => !text || friend.username.toLowerCase().includes(text)
		);
		const byName = (a, b) => a.username.localeCompare(b.username);
		const byRank = (a, b) =>
			(a.globalRank ?? Infinity) - (b.globalRank ?? Infinity) || byName(a, b);
		return list.sort(sort === 'name' ? byName : byRank);
	});
	let online = $derived(shown.filter((friend) => friend.online));
	let offlineFriends = $derived(shown.filter((friend) => !friend.online));
</script>

{#snippet friendCard(friend)}
	<button
		class="group flex items-center gap-3 p-3 rounded-lg text-start bg-white/[0.03] hover:bg-white/[0.08] cursor-pointer transition-colors min-w-0"
		title="Profile of {friend.username}"
		onclick={() => goto(`/profile/${friend.id}`)}
	>
		<span class="relative shrink-0 {friend.online ? '' : 'opacity-70'}">
			{#if friend.avatarUrl}
				<img src={friend.avatarUrl} alt="" class="size-12 rounded-full object-cover" />
			{:else}
				<span class="size-12 rounded-full grid place-items-center bg-secondary-300 font-bold">
					{friend.username[0]}
				</span>
			{/if}
			{#if friend.online}
				<span
					class="absolute bottom-0 right-0 size-3.5 rounded-full bg-green-500 ring-2 ring-secondary-100"
					title="Online"
				></span>
			{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span class="flex items-center gap-1.5 min-w-0">
				<span class="font-semibold truncate group-hover:underline">{friend.username}</span>
				{#if friend.mutual}
					<span
						class="icon-[mingcute--heart-fill] size-3.5 shrink-0 text-pink-400"
						title="Mutual friends"
					></span>
				{/if}
				{#if stosufy.has(friend.id)}
					<span
						class="icon-[mingcute--headphone-line] size-3.5 shrink-0 text-primary-400"
						title="Uses Stosufy"
					></span>
				{/if}
			</span>
			<span class="block text-sm text-secondary-600 truncate">
				{flag(friend.countryCode)}
				{friend.globalRank ? `#${friend.globalRank.toLocaleString()}` : 'Unranked'}
				{#if friend.pp}· {Math.round(friend.pp).toLocaleString()}pp{/if}
			</span>
		</span>
	</button>
{/snippet}

<div class="px-6 pt-6 pb-10 flex flex-col gap-6">
	<div class="flex flex-wrap items-center gap-3">
		<h1 class="flex-1 text-3xl font-extrabold tracking-tight">
			osu! friends
			{#if friends?.length}
				<span class="text-secondary-600 font-bold text-xl">{friends.length}</span>
			{/if}
		</h1>
		{#if friends?.length}
			<div class="relative">
				<span
					class="icon-[mingcute--search-line] size-4 absolute left-3 top-1/2 -translate-y-1/2 text-secondary-600"
				></span>
				<input
					type="search"
					placeholder="Find a friend"
					bind:value={filter}
					class="w-56 h-9 pl-9 pr-3 rounded-full bg-secondary-200 hover:bg-secondary-300 focus:bg-secondary-300 text-sm text-white placeholder:text-secondary-600 outline-none ring-1 ring-transparent focus:ring-white/20 transition"
				/>
			</div>
			<div class="flex gap-1 p-1 rounded-full bg-secondary-200">
				{#each SORTS as [value, label] (value)}
					<button
						class="h-7 px-3 rounded-full text-sm font-semibold cursor-pointer transition {sort ===
						value
							? 'bg-white text-black'
							: 'text-secondary-600 hover:text-white'}"
						onclick={() => (sort = value)}
					>
						{label}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if needsLogin}
		<div class="flex flex-col items-center gap-3 mt-16 text-center text-secondary-600">
			<span class="icon-[mingcute--user-heart-line] size-10"></span>
			<p class="max-w-sm">
				Allow Stosufy to see your osu! friends to list them here and find out who's online.
			</p>
			<Button type="primary" onclick={connectFriends}>Connect friends</Button>
		</div>
	{:else if $offline && !friends}
		<div class="flex flex-col items-center gap-2 mt-16 text-secondary-600">
			<span class="icon-[mingcute--wifi-off-line] size-10 text-amber-300"></span>
			<p class="text-xl">You're offline</p>
			<p class="text-sm">Your friends show up again once you're connected.</p>
		</div>
	{:else if error && !friends}
		<div class="flex flex-col items-center gap-3 mt-16 text-secondary-600">
			<span class="icon-[fa6-solid--triangle-exclamation] size-10 text-red-400"></span>
			<p class="text-xl">Couldn't load your osu! friends</p>
			<p class="text-sm">{error}</p>
			<Button type="primary" onclick={load}>Try again</Button>
		</div>
	{:else if !friends}
		<div class="grid place-items-center py-16">
			<span class="icon-[svg-spinners--ring-resize] size-10 text-primary-300"></span>
		</div>
	{:else if !friends.length}
		<div class="flex flex-col items-center gap-2 mt-16 text-center text-secondary-600">
			<span class="icon-[mingcute--user-add-line] size-10"></span>
			<p class="text-xl">No osu! friends yet</p>
			<p class="text-sm max-w-sm">
				Search for players in the search bar and add them as friends on the osu! website.
			</p>
		</div>
	{:else if !shown.length}
		<p class="mt-10 text-center text-secondary-600">No friend called "{filter}"</p>
	{:else}
		{#if online.length}
			<section>
				<h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-secondary-600">
					Online · {online.length}
				</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
					{#each online as friend (friend.id)}
						{@render friendCard(friend)}
					{/each}
				</div>
			</section>
		{/if}
		{#if offlineFriends.length}
			<section>
				<h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-secondary-600">
					Offline · {offlineFriends.length}
				</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
					{#each offlineFriends as friend (friend.id)}
						{@render friendCard(friend)}
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>
