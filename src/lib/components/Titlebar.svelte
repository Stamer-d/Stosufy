<script>
	// @ts-nocheck

	import { getCurrentWindow } from '@tauri-apps/api/window';
	import Button from './Button.svelte';
	import { user } from '$lib/stores/auth';
	import Dropdown from './Dropdown.svelte';
	import { refreshToken, keyStore } from '$lib/stores/auth';
	import { goto } from '$app/navigation';

	const appWindow = getCurrentWindow();

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
	<div data-tauri-drag-region></div>
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
