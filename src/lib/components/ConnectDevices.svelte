<script>
	// Stosufy Connect: the user's devices with Stosufy open, to choose the one that plays (as
	// Spotify's "Connect to a device")
	import { fly } from 'svelte/transition';
	import { connect, transferTo, DEVICE_ICONS } from '#lib/stores/connect.ts';

	let open = $state(false);
	let root = $state(null);

	let others = $derived($connect.devices.filter((device) => device.id !== $connect.deviceId));
	let here = $derived($connect.activeDeviceId === $connect.deviceId || !$connect.remote);

	function choose(id) {
		open = false;
		transferTo(id);
	}
</script>

<svelte:window
	onclick={(e) => open && !root?.contains(e.target) && (open = false)}
	onkeydown={(e) => e.key === 'Escape' && (open = false)}
/>

<div class="relative" bind:this={root}>
	<button
		title={$connect.remote ? `Playing on ${$connect.remoteDevice?.name}` : 'Connect to a device'}
		aria-label="Connect to a device"
		aria-expanded={open}
		class="relative size-8 grid place-items-center rounded-full cursor-pointer transition {$connect.remote
			? 'text-primary-500'
			: 'text-white/60 hover:text-white'}"
		onclick={() => (open = !open)}
	>
		<span class="icon-[mingcute--device-line] size-5"></span>
		{#if others.length && !$connect.remote}
			<span class="absolute top-1 right-1 size-1.5 rounded-full bg-primary-500"></span>
		{/if}
	</button>

	{#if open}
		<div
			class="absolute bottom-full right-0 mb-3 w-72 p-1.5 rounded-xl bg-secondary-300 ring-1 ring-white/5 shadow-xl shadow-black/40 z-50"
			transition:fly={{ y: 6, duration: 150 }}
		>
			<h3 class="px-2.5 pt-1.5 pb-1 text-xs font-bold uppercase tracking-wider text-secondary-600">
				Connect to a device
			</h3>
			<button
				class="w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-start cursor-pointer hover:bg-white/[0.06] {here
					? 'text-primary-500'
					: 'text-white'}"
				onclick={() => choose($connect.deviceId)}
			>
				<span class="icon-[mingcute--computer-line] size-5 shrink-0"></span>
				<span class="min-w-0 flex-1">
					<span class="block text-sm font-semibold truncate">This computer</span>
					{#if here}<span class="block text-xs text-primary-500/80">Playing here</span>{/if}
				</span>
				{#if here}<span class="icon-[mingcute--volume-line] size-4"></span>{/if}
			</button>
			{#each others as device (device.id)}
				<button
					class="w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-start cursor-pointer hover:bg-white/[0.06] {device.isActive
						? 'text-primary-500'
						: 'text-white'}"
					onclick={() => choose(device.id)}
				>
					<span class="{DEVICE_ICONS[device.kind] ?? DEVICE_ICONS.browser} size-5 shrink-0"></span>
					<span class="min-w-0 flex-1">
						<span class="block text-sm font-semibold truncate">{device.name}</span>
						<span
							class="block text-xs {device.isActive ? 'text-primary-500/80' : 'text-secondary-600'}"
						>
							{device.isActive ? 'Playing' : 'Stosufy'}
						</span>
					</span>
					{#if device.isActive}<span class="icon-[mingcute--volume-line] size-4"></span>{/if}
				</button>
			{/each}
			{#if !others.length}
				<p class="px-2.5 pt-1 pb-2 text-xs text-secondary-600 leading-relaxed">
					{#if $connect.status === 'live'}
						Open Stosufy on your phone with the same osu! account: it shows up here, and each can
						play on or control the other.
					{:else if $connect.status === 'connecting'}
						Connecting…
					{:else}
						Not connected. Log in to see your other devices.
					{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>
