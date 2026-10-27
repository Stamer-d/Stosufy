<script>
	const base = __WEB_BASE__;
	import { goBack } from '../../navigation';
	// Friends: who's on, what they listen to (tap to listen along), and who sees you
	import { onMount } from 'svelte';
	import Bars from '../../Bars.svelte';
	import {
		friendActivity,
		watchFriends,
		listenAlong,
		visibility,
		setVisibility,
		VISIBILITY
	} from '../../friends';
	import { userSettings } from '../../shims/user';
	import { offline } from '../../../lib/stores/network';
	import { logOut } from '../../shims/auth';
	import { queue, playing } from '../../player';
	import { sameSong } from '../../../lib/tracks';
	import { handleImageError } from '../../shims/data';

	onMount(watchFriends);

	let shown = $derived.by(() => {
		void $userSettings;
		return visibility();
	});
	let friends = $derived(
		[...$friendActivity.friends].sort(
			(a, b) =>
				Number(b.online) - Number(a.online) ||
				Number(!!b.playback?.playing) - Number(!!a.playback?.playing) ||
				b.lastSeen - a.lastSeen
		)
	);
	let current = $derived($queue.songs[$queue.index] ?? null);

	function ago(at) {
		const minutes = Math.max(0, Math.round((Date.now() - $friendActivity.offset - at) / 60_000));
		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes} min ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours} h ago`;
		const days = Math.round(hours / 24);
		return days === 1 ? 'yesterday' : `${days} days ago`;
	}
	const cover = (setId) => `https://assets.ppy.sh/beatmaps/${setId}/covers/list@2x.jpg`;
</script>

<header class="px-4 pt-5 pb-2 flex items-center gap-1">
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
	<h1 class="text-2xl font-bold tracking-tight">Friends</h1>
</header>

{#if $offline}
	<p class="px-4 py-10 text-center text-secondary-600">
		Your friends show up once you're connected.
	</p>
{:else if $friendActivity.status === 'needs-login'}
	<div class="px-8 py-12 flex flex-col items-center text-center gap-3">
		<span class="icon-[mingcute--user-heart-line] size-12 text-secondary-600"></span>
		<p class="font-semibold">To see your friends, log in to osu! again</p>
		<p class="text-sm text-secondary-600">Stosufy needs to read your osu! friend list.</p>
		<button class="mt-2 h-10 px-5 rounded-full bg-primary-300 font-semibold" onclick={logOut}
			>Log in again</button
		>
	</div>
{:else if $friendActivity.status === 'error' && !friends.length}
	<p class="px-4 py-10 text-center text-red-400">
		Couldn't load your friends: {$friendActivity.message}
	</p>
{:else if $friendActivity.status === 'ok' && !friends.length}
	<div class="px-8 py-12 flex flex-col items-center text-center gap-2">
		<span class="icon-[mingcute--user-heart-line] size-12 text-secondary-600"></span>
		<p class="font-semibold">None of your osu! friends use Stosufy yet</p>
		<p class="text-sm text-secondary-600">Once they do, you see here what they listen to.</p>
	</div>
{:else if !friends.length}
	<div class="py-12 grid place-items-center">
		<span class="icon-[svg-spinners--ring-resize] size-7 text-secondary-600"></span>
	</div>
{/if}

<ul class="px-2">
	{#each friends as friend (friend.osuId)}
		{@const song = friend.playback}
		{@const along =
			!!song && sameSong(current, { id: song.setId, beatmaps: [{ id: song.mapId }] }) && $playing}
		<li>
			<button
				class="w-full flex items-center gap-3 p-2 rounded-lg text-start active:bg-white/[0.06] disabled:active:bg-transparent"
				disabled={!song}
				onclick={() => listenAlong(friend)}
			>
				<span class="relative shrink-0">
					<img
						src={friend.avatarUrl ?? `https://a.ppy.sh/${friend.osuId}`}
						alt=""
						class="size-12 rounded-full object-cover bg-secondary-300"
						onerror={handleImageError}
					/>
					<span
						class="absolute bottom-0 right-0 size-3.5 rounded-full ring-2 ring-panel {friend.online
							? 'bg-green-400'
							: 'bg-zinc-500'}"
					></span>
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex items-center gap-2">
						<span class="font-semibold truncate">{friend.username}</span>
						<span class="shrink-0 text-xs text-secondary-600">
							{friend.online ? (song?.playing ? '' : 'online') : ago(friend.lastSeen)}
						</span>
					</span>
					{#if song}
						<span class="flex items-center gap-1.5 text-sm text-secondary-600">
							{#if friend.online && song.playing}
								<Bars class="size-3.5 shrink-0" />
							{/if}
							<span class="truncate">{song.title} · {song.artist}</span>
						</span>
					{/if}
				</span>
				{#if song}
					<span class="relative shrink-0">
						<img
							src={cover(song.setId)}
							alt=""
							class="size-11 rounded object-cover bg-secondary-300"
						/>
						<span
							class="absolute inset-0 grid place-items-center rounded bg-black/40 {along
								? 'text-primary-400'
								: 'text-white'}"
						>
							<span
								class="{along
									? 'icon-[mingcute--headphone-fill]'
									: 'icon-[mingcute--play-fill]'} size-5"
							></span>
						</span>
					</span>
				{/if}
			</button>
		</li>
	{/each}
</ul>

<section class="mx-4 mt-6 mb-6 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
	<h2 class="font-bold">What your friends see</h2>
	<div class="mt-3 flex flex-col gap-1" role="radiogroup" aria-label="What your friends see">
		{#each Object.entries(VISIBILITY) as [value, { label, description }] (value)}
			<button
				role="radio"
				aria-checked={shown === value}
				class="flex items-center gap-3 py-2 text-start"
				onclick={() => setVisibility(value)}
			>
				<span
					class="size-5 shrink-0 rounded-full ring-2 grid place-items-center {shown === value
						? 'ring-primary-400'
						: 'ring-white/30'}"
				>
					{#if shown === value}<span class="size-2.5 rounded-full bg-primary-400"></span>{/if}
				</span>
				<span>
					<span class="block text-sm font-semibold">{label}</span>
					<span class="block text-xs text-secondary-600">{description}</span>
				</span>
			</button>
		{/each}
	</div>
</section>
