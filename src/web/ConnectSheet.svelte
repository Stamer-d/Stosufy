<script>
	// Stosufy Connect on the phone: your devices with Stosufy open, to choose the one that
	// plays (as Spotify's "Connect to a device"), and the volume of the one that plays
	import { fade, fly } from 'svelte/transition';
	import { swipe } from './gestures';
	import { haptic } from './haptics';
	import { devicesOpen } from './connect';
	import { connect, remote, transferTo, DEVICE_ICONS } from '../lib/stores/connect';

	const close = () => devicesOpen.set(false);
	let others = $derived($connect.devices.filter((device) => device.id !== $connect.deviceId));
	let me = $derived($connect.devices.find((device) => device.id === $connect.deviceId));
	let away = $derived($connect.remote ? $connect.playback : null);

	function choose(id) {
		haptic();
		close();
		transferTo(id);
	}
</script>

{#if $devicesOpen}
	<div class="fixed inset-0 z-50 flex flex-col justify-end" data-no-swipe>
		<button
			class="absolute inset-0 bg-black/60"
			aria-label="Close"
			onclick={close}
			transition:fade={{ duration: 150 }}
		></button>
		<div
			class="relative max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-panel pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
			transition:fly={{ y: 400, duration: 220, opacity: 1 }}
			use:swipe={{ axis: 'y', only: 1, onswipe: close }}
		>
			<div class="pt-2 flex justify-center">
				<span class="w-10 h-1 rounded-full bg-white/20"></span>
			</div>
			<p class="px-5 pt-3 pb-2 text-lg font-bold">Connect to a device</p>

			<button
				class="w-full px-5 py-3 flex items-center gap-4 text-start active:bg-white/5 {$connect.remote
					? ''
					: 'text-primary-400'}"
				onclick={() => choose($connect.deviceId)}
			>
				<span class="{DEVICE_ICONS[me?.kind ?? 'phone']} size-7 shrink-0"></span>
				<span class="min-w-0 flex-1">
					<span class="block font-semibold truncate"
						>This {me?.kind === 'browser' ? 'browser' : (me?.kind ?? 'phone')}</span
					>
					<span class="block text-sm {$connect.remote ? 'text-white/60' : 'text-primary-400/80'}">
						{$connect.remote ? 'Tap to play here' : 'Playing here'}
					</span>
				</span>
				{#if !$connect.remote}<span class="icon-[mingcute--volume-line] size-5"></span>{/if}
			</button>

			{#each others as device (device.id)}
				<button
					class="w-full px-5 py-3 flex items-center gap-4 text-start active:bg-white/5 {device.isActive
						? 'text-primary-400'
						: ''}"
					onclick={() => choose(device.id)}
				>
					<span class="{DEVICE_ICONS[device.kind] ?? DEVICE_ICONS.computer} size-7 shrink-0"></span>
					<span class="min-w-0 flex-1">
						<span class="block font-semibold truncate">{device.name}</span>
						<span class="block text-sm {device.isActive ? 'text-primary-400/80' : 'text-white/60'}">
							{device.isActive ? 'Playing' : 'Stosufy'}
						</span>
					</span>
					{#if device.isActive}<span class="icon-[mingcute--volume-line] size-5"></span>{/if}
				</button>
			{/each}

			{#if away && away.volume != null}
				<p class="px-5 pt-4 text-sm font-semibold text-white/60">
					Volume on {$connect.remoteDevice?.name}
				</p>
				<label class="px-5 pt-2 pb-1 flex items-center gap-4">
					<span class="icon-[mingcute--volume-mute-line] size-5 text-white/60"></span>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={away.volume}
						oninput={(e) => remote.setVolume(Number(e.currentTarget.value))}
						class="flex-1 accent-[var(--color-primary-400)]"
						aria-label="Volume on {$connect.remoteDevice?.name}"
					/>
					<span class="icon-[mingcute--volume-line] size-5 text-white/60"></span>
				</label>
			{/if}

			{#if !others.length}
				<p class="px-5 pt-2 pb-2 text-sm text-white/60 leading-relaxed">
					{#if $connect.status === 'live'}
						Open Stosufy on your computer with the same osu! account: it shows up here, and you can
						play on it from here, control it and its volume, or take the song over to this phone.
					{:else if $connect.status === 'connecting'}
						Connecting…
					{:else}
						Not connected right now.
					{/if}
				</p>
			{/if}
		</div>
	</div>
{/if}
