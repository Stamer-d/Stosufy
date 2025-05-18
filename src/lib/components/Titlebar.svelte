<script>
	// @ts-nocheck

	import { getCurrentWindow } from '@tauri-apps/api/window';
	import Button from './Button.svelte';
	import { user } from '$lib/stores/auth';
	import Dropdown from './Dropdown.svelte';
	import { refreshToken, keyStore } from '$lib/stores/auth';
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
		if (update) {
			updateModal.hasUpdate = true;
			updateModal.update = update;
		} else {
			updateModal.hasUpdate = false;
		}
	}

	async function updateApp() {
		const update = updateModal.update;
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

<div class="h-16 px-1 bg-secondary-100 grid grid-cols-3" data-tauri-drag-region>
	<div data-tauri-drag-region class="flex items-center">
		{#if $user?.username}
			<Button
				type="ghost"
				icon="icon-[fa6-solid--house]"
				size="lg"
				on:click={() => {
					goto('/home');
				}}
			></Button>
		{/if}
	</div>
	<div data-tauri-drag-region></div>
	<div class="flex items-center justify-end group" data-tauri-drag-region>
		<Dropdown>
			<svelte:fragment slot="trigger" class="group">
				<button class="mr-4 cursor-pointer flex items-center hover:scale-[1.05] rounded-full">
					<img src={$user?.avatar_url ?? '/logo.png'} class=" size-11 rounded-full" alt="" />
				</button>
			</svelte:fragment>
			<svelte:fragment slot="menu">
				<Button
					type="ghost"
					disabled
					class="w-full py-3 rounded-sm hover:bg-secondary-300"
					icon="icon-[fa6-solid--user]"
				>
					Profile
				</Button>
				<Button
					type="ghost"
					class="w-full py-3 rounded-sm hover:bg-secondary-300"
					icon="icon-[fa6-solid--arrows-rotate]"
					on:click={() => {
						updateModal.open();
					}}
				>
					Check for Updates
				</Button>
				<Button
					on:click={() => {
						refreshAuth();
					}}
					type="ghost"
					class="w-full py-3 rounded-sm hover:bg-secondary-300"
					icon="icon-[fa6-solid--right-left]"
				>
					Refresh Auth
				</Button>
			</svelte:fragment>
		</Dropdown>
		<Button
			class="h-full hover:bg-secondary-200 rounded-none px-3"
			on:click={() => {
				appWindow.minimize();
			}}
			type="ghost"
			icon="icon-[fa6-solid--minus]"
		/>
		<Button
			class="h-full hover:bg-secondary-200 rounded-none px-3"
			on:click={() => {
				appWindow.toggleMaximize();
			}}
			type="ghost"
			icon="icon-[fa6-solid--window-maximize]"
		/>
		<Button
			class="h-full hover:bg-secondary-200 rounded-none px-3"
			on:click={() => {
				appWindow.close();
			}}
			type="ghost"
			icon="icon-[fa6-solid--xmark]"
		/>
	</div>
</div>

<Modal bind:open={updateModal.show} title="Stosufy Update">
	{#if updateModal.hasUpdate === null}
		<div class="flex flex-col gap-2 items-center justify-center">
			<p class="text-lg">Checking for updates</p>
			<span class="icon-[line-md--loading-loop] text-center size-8"></span>
		</div>
	{:else if updateModal.hasUpdate && updating !== true}
		<p class="text-center text-lg">A new version is available!</p>
		<Button type="primary" class="w-full mt-4" on:click={async () => {}}>Update Now</Button>
	{:else if updating}
		<div class="flex flex-col gap-2 items-center justify-center">
			<p class="text-lg">Updating Stosufy</p>
			<span class="icon-[line-md--loading-loop] text-center size-8"></span>
		</div>
	{:else}
		<p class="text-center text-lg">You are on the latest version!</p>
	{/if}
</Modal>
