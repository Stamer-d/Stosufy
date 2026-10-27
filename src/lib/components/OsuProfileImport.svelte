<script>
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import { user, userSettings, updateUserSettings } from '#lib/stores/user.ts';
	import { playlists } from '#lib/stores/playlist.ts';
	import { goto } from '$app/navigation';
	import {
		PROFILE_LISTS,
		profileImport,
		profileImportOpen,
		importProfileList
	} from '#lib/stores/osuProfile.ts';

	const lists = /** @type {const} */ (['favourite', 'most_played', 'best']);

	let download = $derived($userSettings.settings?.profileDownload ?? false);
	let busy = $derived(['loading', 'adding'].includes($profileImport.state));

	/** The playlist made for a list before, if it still exists */
	function existing(list) {
		const id = $userSettings.settings?.profilePlaylists?.[list];
		return $playlists.find((playlist) => playlist.id == id) ?? null;
	}
</script>

<Modal title="Playlists from your osu! profile" width="520px" bind:open={$profileImportOpen}>
	<p class="text-sm text-secondary-600 mb-4">
		One click turns a list from your osu! profile into a playlist. Click again later to add what's
		new.
	</p>
	<ul class="flex flex-col gap-2">
		{#each lists as list (list)}
			{@const info = PROFILE_LISTS[list]}
			{@const playlist = existing(list)}
			{@const running = $profileImport.list === list && busy}
			{@const finished = $profileImport.list === list && !busy ? $profileImport : null}
			<li class="flex items-center gap-3 p-3 rounded-lg bg-white/[0.04]">
				<span
					class="size-11 shrink-0 grid place-items-center rounded-md bg-primary-500/15 text-primary-500"
				>
					<span class="{info.icon} size-6"></span>
				</span>
				<span class="min-w-0 flex-1">
					<span class="block font-semibold text-white">{info.label}</span>
					<span class="block text-xs text-secondary-600 truncate" aria-live="polite">
						{#if running && $profileImport.state === 'loading'}
							Loading from osu!…
						{:else if running}
							Adding songs: {$profileImport.done} of {$profileImport.total}
						{:else if finished?.state === 'done'}
							{finished.added
								? `Added ${finished.added} ${finished.added === 1 ? 'song' : 'songs'}`
								: 'Already up to date'}
						{:else if finished?.state === 'error'}
							<span class="text-red-400">{finished.message}</span>
						{:else}
							{info.description} · {info.count($user)}
							{info.count($user) === 1 ? 'map' : 'maps'}
						{/if}
					</span>
				</span>
				{#if running}
					<span class="icon-[mingcute--loading-line] size-5 shrink-0 animate-spin text-primary-500"
					></span>
				{:else if playlist && finished?.state === 'done'}
					<Button
						type="ghost"
						onclick={() => {
							$profileImportOpen = false;
							goto(`/playlist/${playlist.id}`);
						}}
					>
						Open
					</Button>
				{:else}
					<Button
						type={playlist ? 'normal' : 'primary'}
						disabled={busy || !info.count($user)}
						onclick={() => importProfileList(list, download)}
					>
						{playlist ? 'Update' : 'Create playlist'}
					</Button>
				{/if}
			</li>
		{/each}
	</ul>
	<label class="mt-4 flex items-center gap-3 text-sm cursor-pointer select-none">
		<input
			type="checkbox"
			class="size-4 accent-primary-500 cursor-pointer"
			checked={download}
			onchange={(e) => updateUserSettings({ profileDownload: e.currentTarget.checked })}
		/>
		<span>
			<span class="text-white">Download the songs too</span>
			<span class="block text-xs text-secondary-600">
				One after another in the background; waits when osu! asks to slow down.
			</span>
		</span>
	</label>
	{#snippet footer()}
		<Button type="primary" onclick={() => ($profileImportOpen = false)}>Done</Button>
	{/snippet}
</Modal>
