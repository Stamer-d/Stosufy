<script>
	// A profile: the osu! profile of a user, what they listen to now (friends), their public
	// playlists, and for the user themselves what their library is made of
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { open } from '@tauri-apps/plugin-shell';
	import { user } from '#lib/stores/user.ts';
	import { mapDataStore } from '#lib/stores/data.ts';
	import { playlists } from '#lib/stores/playlist.ts';
	import { favourites } from '#lib/stores/favourites.ts';
	import { friendActivity, listenAlong } from '#lib/stores/friends.ts';
	import { osuProfile, userPlaylists, flag, libraryStats } from '#lib/stores/profile.ts';
	import PlaylistCover from '#lib/components/PlaylistCover.svelte';

	let id = $derived(page.params.id === 'me' ? Number($user?.id) : Number(page.params.id));
	let mine = $derived(!!$user?.id && id === Number($user.id));

	let profile = $state(null);
	let error = $state('');
	let publicPlaylists = $state(null);

	$effect(() => {
		const osuId = id;
		profile = null;
		error = '';
		publicPlaylists = null;
		if (!(osuId > 0)) return;
		osuProfile(osuId)
			.then((result) => osuId === id && (profile = result))
			.catch((e) => osuId === id && (error = e.message ?? String(e)));
		userPlaylists(osuId)
			.then((result) => osuId === id && (publicPlaylists = result))
			.catch(() => osuId === id && (publicPlaylists = []));
	});

	let friend = $derived($friendActivity.friends.find((f) => f.osuId === id) ?? null);
	let stats = $derived(mine ? libraryStats($mapDataStore) : null);
	let ownPlaylists = $derived(mine ? $playlists.filter((p) => Number(p.id) > 0) : []);

	const hours = (seconds) =>
		seconds >= 3600 ? `${Math.round(seconds / 360) / 10} h` : `${Math.round(seconds / 60)} min`;
	const number = (value) => (value == null ? '–' : Math.round(value).toLocaleString());
	const since = (date) => (date ? new Date(date).getFullYear() : null);
	const widest = (list) => Math.max(1, ...list.map(([, n]) => n));
</script>

<div class="pb-12">
	<!-- Header: the osu! cover, avatar and name -->
	<div class="relative h-72 max-md:h-auto max-md:min-h-80 overflow-hidden">
		{#if profile?.coverUrl}
			<img src={profile.coverUrl} alt="" class="absolute inset-0 size-full object-cover" />
		{:else}
			<div class="absolute inset-0 bg-gradient-to-br from-primary-700/60 to-secondary-200"></div>
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-panel via-panel/60 to-black/20"></div>
		<div
			class="absolute bottom-6 left-6 right-6 flex items-end gap-6 max-md:relative max-md:flex-col max-md:items-start max-md:gap-3 max-md:px-4 max-md:pt-10 max-md:pb-4"
		>
			<img
				src={profile?.avatarUrl ?? friend?.avatarUrl ?? '/logo.png'}
				alt=""
				class="size-36 max-md:size-24 rounded-full object-cover shadow-2xl shadow-black/50 ring-4 ring-white/10"
			/>
			<div class="min-w-0 flex-1 pb-2 max-md:pb-0 max-md:w-full">
				<p class="text-sm font-semibold text-white/70">{mine ? 'Your profile' : 'Profile'}</p>
				<h1 class="text-5xl max-md:text-3xl font-extrabold tracking-tight truncate">
					{profile?.username ?? friend?.username ?? (error ? 'Unknown user' : '…')}
				</h1>
				{#if profile}
					<p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75">
						{#if profile.country}
							<span>{flag(profile.country.code)} {profile.country.name}</span>
						{/if}
						{#if profile.globalRank}<span>#{number(profile.globalRank)} global</span>{/if}
						{#if profile.pp}<span>{number(profile.pp)}pp</span>{/if}
						{#if profile.playCount}<span>{number(profile.playCount)} plays</span>{/if}
						{#if since(profile.joined)}<span>osu! since {since(profile.joined)}</span>{/if}
					</p>
				{/if}
			</div>
			<button
				class="mb-2 flex items-center gap-2 h-9 px-4 rounded-full bg-black/40 backdrop-blur ring-1 ring-white/15 text-sm font-semibold hover:bg-black/60 cursor-pointer transition"
				onclick={() => open(`https://osu.ppy.sh/users/${id}`)}
			>
				<span class="icon-[mingcute--external-link-line] size-4"></span>
				osu! profile
			</button>
		</div>
	</div>

	<div class="px-6 max-md:px-4 flex flex-col gap-10">
		{#if error && !profile}
			<p class="text-secondary-600">Couldn't load the osu! profile: {error}</p>
		{/if}

		<!-- What a friend listens to now -->
		{#if friend?.playback}
			<section
				class="flex items-center gap-4 p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5 max-w-xl"
			>
				<span
					class="grid place-items-center size-11 rounded-full {friend.online
						? 'bg-green-500/15 text-green-400'
						: 'bg-white/5 text-secondary-600'}"
				>
					<span class="icon-[mingcute--headphone-line] size-6"></span>
				</span>
				<div class="min-w-0 flex-1">
					<p class="text-xs font-semibold uppercase tracking-wide text-secondary-600">
						{friend.online && friend.playback.playing ? 'Listening now' : 'Last played'}
					</p>
					<p class="font-semibold truncate">{friend.playback.title}</p>
					<p class="text-sm text-secondary-600 truncate">{friend.playback.artist}</p>
				</div>
				{#if friend.online}
					<button
						class="h-9 px-4 rounded-full bg-white text-black text-sm font-semibold hover:scale-[1.03] cursor-pointer transition"
						onclick={() => listenAlong(friend)}
					>
						Listen along
					</button>
				{/if}
			</section>
		{/if}

		<!-- The user's own library -->
		{#if stats}
			<section>
				<h2 class="text-xl font-bold tracking-tight mb-4">Your library</h2>
				<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
					{#each [['icon-[mingcute--download-2-line]', 'Downloaded songs', number(stats.songs)], ['icon-[mingcute--time-line]', 'Of music', hours(stats.seconds)], ['icon-[mingcute--heart-line]', 'Liked songs', number($favourites.length)], ['icon-[mingcute--playlist-line]', 'Playlists', number(ownPlaylists.length)]] as [icon, label, value] (label)}
						<div class="p-4 rounded-xl bg-white/[0.04] ring-1 ring-white/5">
							<span class="{icon} size-5 text-primary-400"></span>
							<p class="mt-2 text-2xl font-extrabold tabular-nums">{value}</p>
							<p class="text-sm text-secondary-600">{label}</p>
						</div>
					{/each}
				</div>
				<div class="mt-6 grid gap-6 lg:grid-cols-3">
					{#each [{ title: 'Top genres', list: stats.genres }, { title: 'Top artists', list: stats.artists }, { title: 'Top mappers', list: stats.mappers }] as { title, list } (title)}
						<div>
							<h3 class="text-sm font-bold uppercase tracking-wide text-secondary-600 mb-3">
								{title}
							</h3>
							{#if list.length}
								<div class="flex flex-col gap-2">
									{#each list as [name, count] (name)}
										<div class="flex items-center gap-3 text-sm">
											<span class="w-32 shrink-0 truncate" title={name}>{name}</span>
											<span class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
												<span
													class="block h-full rounded-full bg-primary-500"
													style="width: {(count / widest(list)) * 100}%"
												></span>
											</span>
											<span class="w-8 text-end tabular-nums text-secondary-600">{count}</span>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-sm text-secondary-600">
									{title === 'Top genres'
										? 'Genres show up once your songs are looked up (a few seconds each).'
										: 'Download songs to see this.'}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Public playlists -->
		<section>
			<h2 class="text-xl font-bold tracking-tight mb-4">Public playlists</h2>
			{#if publicPlaylists === null}
				<span class="size-6 icon-[svg-spinners--ring-resize] text-primary-400"></span>
			{:else if !publicPlaylists.length}
				<p class="text-sm text-secondary-600">
					{mine
						? 'None yet. Make a playlist public in its details to share it.'
						: 'No public playlists yet.'}
				</p>
			{:else}
				<div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
					{#each publicPlaylists as playlist (playlist.id)}
						<button
							class="p-3 rounded-lg hover:bg-white/[0.06] text-start cursor-pointer transition"
							onclick={() => goto(`/playlist/${playlist.id}`)}
						>
							<PlaylistCover
								{playlist}
								class="w-full aspect-square rounded-md shadow-lg shadow-black/40"
								iconClass="size-12"
							/>
							<h3 class="mt-3 font-semibold truncate">{playlist.title}</h3>
							<p class="text-sm text-secondary-600 truncate">
								{playlist.song_amount}
								{playlist.song_amount === 1 ? 'song' : 'songs'}{playlist.saves
									? ` · ${playlist.saves} ${playlist.saves === 1 ? 'save' : 'saves'}`
									: ''}
							</p>
						</button>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>
