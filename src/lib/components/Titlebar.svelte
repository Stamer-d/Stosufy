<script>
	import ListenTogether from './ListenTogether.svelte';
	import SearchBar from './SearchBar.svelte';
	import { openSettings } from '#lib/stores/settings.ts';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import Button from './Button.svelte';
	import { user } from '#lib/stores/user.ts';
	import Dropdown from './Dropdown.svelte';
	import { refreshToken, keyStore } from '#lib/stores/auth.ts';
	import { goto, afterNavigate } from '$app/navigation';
	import Modal from './Modal.svelte';
	import { check } from '@tauri-apps/plugin-updater';
	import { relaunch } from '@tauri-apps/plugin-process';
	import { focusMode } from '#lib/stores/audio.ts';
	import { djOpen } from '#lib/dj/engine.ts';
	import { page } from '$app/state';
	import { friendsPanelOpen } from '#lib/stores/friends.ts';

	const appWindow = getCurrentWindow();
	// macOS has its own window buttons (top left, over the bar): room for them, no others
	const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

	/** Where a button leads, out of the focus and DJ modes (also to the page that's open) */
	function go(path) {
		focusMode.set(false);
		djOpen.set(false);
		goto(path);
	}
	// The focus and DJ modes are one at a time
	const toggleDj = () => {
		focusMode.set(false);
		djOpen.update((on) => !on);
	};
	const toggleFocus = () => {
		djOpen.set(false);
		focusMode.update((on) => !on);
	};
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

	// Back and forward like in a browser (also the mouse's side buttons and Alt+arrows)
	let canGoBack = $state(false);
	let canGoForward = $state(false);
	afterNavigate(() => {
		// The Navigation API knows the history; without it, allow going back after a navigation
		const navigation = /** @type {any} */ (window).navigation;
		canGoBack = navigation ? navigation.canGoBack : history.length > 1;
		canGoForward = navigation ? navigation.canGoForward : false;
	});

	let historyButtons = $derived([
		{
			label: 'Back',
			icon: 'icon-[mingcute--left-line]',
			enabled: canGoBack,
			go: () => history.back()
		},
		{
			label: 'Forward',
			icon: 'icon-[mingcute--right-line]',
			enabled: canGoForward,
			go: () => history.forward()
		}
	]);

	function handleHistoryInput(event) {
		if (event instanceof MouseEvent && (event.button === 3 || event.button === 4)) {
			event.preventDefault();
			event.button === 3 ? history.back() : history.forward();
		} else if (event instanceof KeyboardEvent && event.altKey) {
			if (event.key === 'ArrowLeft') history.back();
			if (event.key === 'ArrowRight') history.forward();
		}
	}
</script>

<svelte:window onmouseup={handleHistoryInput} onkeydown={handleHistoryInput} />

<header class="h-12 shrink-0 flex items-center" data-tauri-drag-region>
	<div class="flex items-center gap-1 {isMac ? 'pl-20' : 'pl-3'}" data-tauri-drag-region>
		<img src="/NoLetterLogo.png" alt="" class="beat-logo size-6 mr-2 pointer-events-none" />
		{#if $user?.username}
			{#each historyButtons as nav (nav.label)}
				<button
					title={nav.label}
					aria-label={nav.label}
					disabled={!nav.enabled}
					class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition disabled:opacity-30 disabled:pointer-events-none"
					onclick={nav.go}
				>
					<span class="{nav.icon} size-[18px]"></span>
				</button>
			{/each}
			<button
				title="Home"
				aria-label="Home"
				class="size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
				onclick={() => go('/home')}
			>
				<span class="icon-[mingcute--home-4-fill] size-[18px]"></span>
			</button>
			<button
				title={$djOpen ? 'Leave DJ mode' : 'DJ mode'}
				aria-label={$djOpen ? 'Leave DJ mode' : 'DJ mode'}
				aria-pressed={$djOpen}
				class="size-8 grid place-items-center rounded-full hover:bg-secondary-300 cursor-pointer transition {$djOpen
					? 'text-primary-500'
					: 'text-secondary-600 hover:text-white'}"
				onclick={toggleDj}
			>
				<span class="icon-[mingcute--disc-line] size-[18px]"></span>
			</button>
			<button
				title="World center"
				aria-label="World center"
				aria-pressed={page.url.pathname === '/world'}
				class="size-8 grid place-items-center rounded-full hover:bg-secondary-300 cursor-pointer transition {page
					.url.pathname === '/world'
					? 'text-primary-500'
					: 'text-secondary-600 hover:text-white'}"
				onclick={() => go('/world')}
			>
				<span class="icon-[mingcute--earth-2-line] size-[18px]"></span>
			</button>
			<button
				title={$focusMode ? 'Exit focus mode' : 'Focus mode'}
				aria-label={$focusMode ? 'Exit focus mode' : 'Focus mode'}
				aria-pressed={$focusMode}
				class="size-8 grid place-items-center rounded-full hover:bg-secondary-300 cursor-pointer transition {$focusMode
					? 'text-primary-500'
					: 'text-secondary-600 hover:text-white'}"
				onclick={toggleFocus}
			>
				<span
					class="{$focusMode
						? 'icon-[mingcute--fullscreen-exit-line]'
						: 'icon-[mingcute--fullscreen-line]'} size-[18px]"
				></span>
			</button>
		{/if}
	</div>

	<div class="flex-1 h-full flex items-center justify-center px-6" data-tauri-drag-region>
		{#if $user?.username}
			<SearchBar />
		{/if}
	</div>

	<div class="flex items-center h-full {isMac ? 'pr-3' : ''}">
		{#if $user?.username}
			<ListenTogether />
			<button
				title="Friend activity"
				aria-label="Friend activity"
				aria-pressed={$friendsPanelOpen}
				class="ml-1 size-8 grid place-items-center rounded-full cursor-pointer transition {$friendsPanelOpen
					? 'text-primary-500 bg-primary-300/20'
					: 'text-secondary-600 hover:text-white hover:bg-secondary-300'}"
				onclick={() => friendsPanelOpen.update((open) => !open)}
			>
				<span class="icon-[mingcute--user-heart-line] size-[18px]"></span>
			</button>
			<button
				title="Settings"
				aria-label="Settings"
				class="mr-2 size-8 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-secondary-300 cursor-pointer transition"
				onclick={() => openSettings()}
			>
				<span class="icon-[mingcute--settings-3-line] size-[18px]"></span>
			</button>
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
						icon="icon-[mingcute--user-3-line]"
						on:click={() => go('/profile/me')}
					>
						Profile
					</Button>
					<Button
						type="ghost"
						class="w-full rounded-md text-sm hover:bg-secondary-400"
						icon="icon-[mingcute--settings-3-line]"
						on:click={() => openSettings()}
					>
						Settings
					</Button>
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

		{#if !isMac}
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
		{/if}
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
