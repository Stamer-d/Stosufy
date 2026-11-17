<script>
	// The notifications: cards at the top right that slide in from the right, newest at the
	// bottom; they stay while the pointer is on them. Hidden while playing (over the playfield).
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import {
		notifications,
		notificationSettings,
		dismiss,
		pause,
		resume
	} from '#lib/stores/notifications.ts';
	import { userSettings } from '#lib/stores/user.ts';
	import { playingLive } from '#lib/gameplay/play.ts';

	$effect(() => notificationSettings.set($userSettings.settings?.notifications));
</script>

{#if !$playingLive}
	<div
		class="fixed top-14 right-3 z-[60] w-80 flex flex-col gap-2 pointer-events-none"
		aria-live="polite"
	>
		{#each $notifications as notification (notification.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group relative pointer-events-auto overflow-hidden rounded-xl bg-secondary-300/95 backdrop-blur-2xl ring-1 ring-white/10 shadow-2xl shadow-black/50"
				in:fly={{ x: 340, duration: 260, opacity: 1 }}
				out:fly={{ x: 340, duration: 200, opacity: 0.6 }}
				animate:flip={{ duration: 200 }}
				onpointerenter={() => pause(notification.id)}
				onpointerleave={() => resume(notification.id)}
			>
				<div class="flex items-start gap-3 p-3 pr-9">
					{#if notification.image}
						<img
							src={notification.image}
							alt=""
							class="size-10 shrink-0 object-cover {notification.round
								? 'rounded-full'
								: 'rounded-md'}"
						/>
					{:else if notification.icon}
						<span class="size-10 shrink-0 grid place-items-center rounded-full bg-white/[0.06]">
							<span class="{notification.icon} size-5 {notification.tone ?? 'text-primary-500'}"
							></span>
						</span>
					{/if}
					<div class="min-w-0 flex-1">
						{#if notification.open}
							<button
								class="block w-full text-start font-semibold text-sm text-white leading-snug hover:underline cursor-pointer"
								onclick={() => {
									notification.open();
									dismiss(notification.id);
								}}
							>
								{notification.title}
							</button>
						{:else}
							<p class="font-semibold text-sm text-white leading-snug">{notification.title}</p>
						{/if}
						{#if notification.body}
							<p class="text-sm text-secondary-600 leading-snug line-clamp-2 break-words">
								{notification.body}
							</p>
						{/if}
						{#if notification.action}
							<button
								class="mt-2 h-7 px-3 rounded-full bg-white text-black text-xs font-bold hover:scale-[1.03] cursor-pointer transition"
								onclick={() => {
									notification.action.run();
									dismiss(notification.id);
								}}
							>
								{notification.action.label}
							</button>
						{/if}
					</div>
				</div>
				<button
					class="absolute top-2 right-2 size-6 grid place-items-center rounded-full text-secondary-600 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer transition"
					aria-label="Close notification"
					onclick={() => dismiss(notification.id)}
				>
					<span class="icon-[mingcute--close-line] size-4"></span>
				</button>
				<!-- The time left; stops with the countdown while the pointer is on it -->
				<span
					class="countdown absolute left-0 bottom-0 h-0.5 w-full origin-left bg-primary-400/70 group-hover:[animation-play-state:paused]"
					style="animation-duration: {notification.duration}ms"
				></span>
			</div>
		{/each}
	</div>
{/if}

<style>
	.countdown {
		animation-name: countdown;
		animation-timing-function: linear;
		animation-fill-mode: forwards;
	}
	@keyframes countdown {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
</style>
