<script>
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import Button from './Button.svelte';
	import { user } from '#lib/stores/user.ts';
	import Dropdown from './Dropdown.svelte';
	import { refreshToken, keyStore } from '#lib/stores/auth.ts';
	import { goto } from '$app/navigation';
	import Modal from './Modal.svelte';
	import { check } from '@tauri-apps/plugin-updater';
	import { relaunch } from '@tauri-apps/plugin-process';

	const appWindow = getCurrentWindow();
	let updating = $state(false);
	let updateModal = $state({
		show: false,
		open: async () => {
			updateModal.show = true;
			await checkForUpdates();
		},
		hasUpdate: null,
		update: null
	});

	async function checkForUpdates() {
		const update = await check();
		if (update?.available) {
			updateModal.hasUpdate = true;
		} else {
			updateModal.hasUpdate = false;
		}
	}

	async function updateApp() {
		const update = await check();

		if (update) {
			updating = true;
			await update.downloadAndInstall();
			await relaunch();
		}
	}

	async function refreshAuth() {
		const keys = $keyStore;
		const refreshed = await refreshToken(keys.refresh_token);
		if (refreshed === null) {
			goto('/login');
		} else {
			goto('/');
			setTimeout(() => {
				window.location.reload();
			}, 1000);
		}
	}
</script>

<header class="h-12 shrink-0 flex items-center bg-app" data-tauri-drag-region>
	<div class="flex items-center gap-1 pl-3" data-tauri-drag-region>
		<img src="/NoLetterLogo.png" alt="" class="size-6 mr-2 pointer-events-none" />
		{#if $user?.username}
			<button
				title="Home"
				aria-label="Home"
				class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
				onclick={() => goto('/home')}
			>
				<span class="icon-[mingcute--home-4-fill] size-[18px]"></span>
			</button>
		{/if}
	</div>

	<div class="flex-1 h-full" data-tauri-drag-region></div>

	<div class="flex items-center h-full">
		{#if $user?.username}
			<Dropdown>
				<svelte:fragment slot="trigger">
					<button
						class="mr-3 flex items-center gap-2 rounded-full p-0.5 pr-3 bg-secondary-200 hover:bg-secondary-300 cursor-pointer transition"
						aria-label="Account menu"
					>
						<img
							src={$user?.avatar_url ?? '/logo.png'}
							class="size-7 rounded-full object-cover"
							alt=""
						/>
						{#if $user?.username}
							<span class="text-sm font-semibold">{$user.username}</span>
						{/if}
					</button>
				</svelte:fragment>
				<svelte:fragment slot="menu">
					<Button
						type="ghost"
						class="w-full rounded-md text-sm hover:bg-secondary-400"
						icon="icon-[mingcute--refresh-2-line]"
						on:click={() => {
							updateModal.open();
						}}
					>
						Check for updates
					</Button>
					<Button
						on:click={() => {
							refreshAuth();
						}}
						type="ghost"
						class="w-full rounded-md text-sm hover:bg-secondary-400"
						icon="icon-[mingcute--user-3-line]"
					>
						Refresh login
					</Button>
				</svelte:fragment>
			</Dropdown>
		{/if}

		<button
			aria-label="Minimize"
			class="h-full w-12 grid place-items-center text-secondary-600 hover:text-white hover:bg-secondary-300 transition"
			onclick={() => appWindow.minimize()}
		>
			<span class="icon-[mingcute--minimize-line] size-4"></span>
		</button>
		<button
			aria-label="Maximize"
			class="h-full w-12 grid place-items-center text-secondary-600 hover:text-white hover:bg-secondary-300 transition"
			onclick={() => appWindow.toggleMaximize()}
		>
			<span class="icon-[mingcute--square-line] size-3.5"></span>
		</button>
		<button
			aria-label="Close"
			class="h-full w-12 grid place-items-center text-secondary-600 hover:text-white hover:bg-red-600 transition"
			onclick={() => appWindow.close()}
		>
			<span class="icon-[mingcute--close-line] size-4"></span>
		</button>
	</div>
</header>

<Modal bind:open={updateModal.show} title="Updates">
	{#if updateModal.hasUpdate === null}
		<div class="flex flex-col gap-2 items-center justify-center">
			<p class="text-lg">Checking for updates</p>
			<span class="icon-[line-md--loading-loop] text-center size-8"></span>
		</div>
	{:else if updateModal.hasUpdate && updating !== true}
		<p class="text-center text-lg">A new version is available!</p>
		<Button
			type="primary"
			class="w-full mt-4"
			on:click={async () => {
				await updateApp();
			}}>Update Now</Button
		>
	{:else if updating}
		<div class="flex flex-col gap-2 items-center justify-center">
			<p class="text-lg">Updating Stosufy</p>
			<span class="icon-[line-md--loading-loop] text-center size-8"></span>
		</div>
	{:else}
		<p class="text-center text-lg">You are on the latest version!</p>
	{/if}
</Modal>
