<script>
	const base = __WEB_BASE__;
	// Your playlists (the same as in the desktop app: from the Stosufy API)
	import { keyStore, logOut } from '../shims/auth';
	import { playlists, savedPlaylists } from '../../lib/stores/playlist';
	import { libraryState, loadLibrary } from '../library';

	let all = $derived([...$playlists, ...$savedPlaylists]);
</script>

<header class="px-5 pt-6 pb-3 flex items-end justify-between gap-3">
	<h1 class="text-3xl font-extrabold">Playlists</h1>
	<div class="flex items-center gap-1">
		<button
			aria-label="Reload"
			class="size-10 grid place-items-center text-secondary-600"
			disabled={$libraryState.loading}
			onclick={() => loadLibrary($keyStore.access_token, true)}
		>
			<span
				class="{$libraryState.loading
					? 'icon-[svg-spinners--ring-resize]'
					: 'icon-[mingcute--refresh-2-line]'} size-5"
			></span>
		</button>
		<button class="h-10 px-2 text-sm text-secondary-600" onclick={logOut}>Log out</button>
	</div>
</header>
{#if $libraryState.error}
	<p class="px-5 pb-2 text-sm text-red-400">
		Couldn't load the playlists: {$libraryState.error}{all.length ? ' (these are from before)' : ''}
	</p>
{/if}
{#if $libraryState.loading && !all.length}
	<p class="px-5 text-sm text-secondary-600">Loading…</p>
{/if}
<ul class="px-3">
	{#each all as playlist (playlist.id)}
		<li>
			<a
				href="{base}/playlist/{playlist.id}"
				class="flex items-center gap-3 p-2 rounded-lg active:bg-white/5"
			>
				{#if playlist.id == -2}
					<span
						class="size-14 shrink-0 grid place-items-center rounded-md bg-gradient-to-br from-primary-300 to-primary-700"
					>
						<span class="icon-[mingcute--heart-fill] size-6"></span>
					</span>
				{:else if playlist.image_url}
					<img src={playlist.image_url} alt="" class="size-14 shrink-0 rounded-md object-cover" />
				{:else}
					<span class="size-14 shrink-0 grid place-items-center rounded-md bg-secondary-300">
						<span class="icon-[mingcute--music-2-line] size-6 text-secondary-600"></span>
					</span>
				{/if}
				<span class="min-w-0">
					<span class="block font-semibold truncate">{playlist.title}</span>
					<span class="block text-sm text-secondary-600 truncate">
						{playlist.song_amount ?? 0} songs{playlist.creator?.username
							? ` · ${playlist.creator.username}`
							: ''}
					</span>
				</span>
			</a>
		</li>
	{/each}
</ul>
